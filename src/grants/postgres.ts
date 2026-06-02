import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { NetworkName } from "../chains/monad.js";
import type { CreateGrantInput, GrantStatus, GrantStore, SessionGrant } from "./types.js";

interface DbRow {
  id: string;
  user_id: string;
  wallet_address: string;
  network: NetworkName;
  label: string;
  spend_cap_wei: string;
  spent_wei: string;
  allowed_targets: string[];
  allowed_selectors: string[];
  status: GrantStatus;
  approval_request_id: string | null;
  privy_policy_id: string | null;
  created_at: string;
  approved_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  updated_at: string;
}

function rowToGrant(r: DbRow): SessionGrant {
  return {
    id: r.id,
    userId: r.user_id,
    walletAddress: r.wallet_address as `0x${string}`,
    network: r.network,
    label: r.label,
    spendCapWei: r.spend_cap_wei,
    spentWei: r.spent_wei,
    allowedTargets: r.allowed_targets as `0x${string}`[],
    allowedSelectors: r.allowed_selectors as `0x${string}`[],
    status: r.status,
    approvalRequestId: r.approval_request_id ?? undefined,
    privyPolicyId: r.privy_policy_id ?? undefined,
    createdAt: Number(r.created_at),
    approvedAt: r.approved_at ? Number(r.approved_at) : undefined,
    expiresAt: Number(r.expires_at),
    revokedAt: r.revoked_at ? Number(r.revoked_at) : undefined,
    updatedAt: Number(r.updated_at),
  };
}

export class PgGrantStore implements GrantStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async create(input: CreateGrantInput): Promise<SessionGrant> {
    const id = randomUUID();
    const now = this.now();
    const res = await this.pool.query<DbRow>(
      `INSERT INTO session_grants (
        id, user_id, wallet_address, network, label,
        spend_cap_wei, spent_wei, allowed_targets, allowed_selectors,
        status, created_at, expires_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'0',$7::jsonb,$8::jsonb,'pending',$9,$10,$9) RETURNING *`,
      [
        id,
        input.userId,
        input.walletAddress,
        input.network,
        input.label,
        input.spendCapWei,
        JSON.stringify(input.allowedTargets ?? []),
        JSON.stringify(input.allowedSelectors ?? []),
        now,
        now + input.ttlMs,
      ],
    );
    return rowToGrant(res.rows[0]!);
  }

  async get(id: string): Promise<SessionGrant | null> {
    return this.withTx(async (client) => {
      const r = await client.query<DbRow>("SELECT * FROM session_grants WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (r.rowCount === 0) return null;
      return this.maybeExpire(client, r.rows[0]!);
    });
  }

  async listForUser(userId: string): Promise<SessionGrant[]> {
    return this.withTx(async (client) => {
      const res = await client.query<DbRow>(
        "SELECT * FROM session_grants WHERE user_id=$1 ORDER BY created_at DESC FOR UPDATE",
        [userId],
      );
      const out: SessionGrant[] = [];
      for (const row of res.rows) {
        out.push(await this.maybeExpire(client, row));
      }
      return out;
    });
  }

  async activate(id: string): Promise<SessionGrant> {
    return this.withTx(async (client) => {
      const cur = await client.query<DbRow>("SELECT * FROM session_grants WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (cur.rowCount === 0) throw new Error(`grant not found: ${id}`);
      const row = cur.rows[0]!;
      if (row.status !== "pending") return rowToGrant(row);
      const now = this.now();
      const upd = await client.query<DbRow>(
        `UPDATE session_grants SET status='active', approved_at=$2, updated_at=$2 WHERE id=$1 RETURNING *`,
        [id, now],
      );
      return rowToGrant(upd.rows[0]!);
    });
  }

  async revoke(id: string): Promise<SessionGrant> {
    const now = this.now();
    const r = await this.pool.query<DbRow>(
      `UPDATE session_grants SET status='revoked', revoked_at=$2, updated_at=$2 WHERE id=$1 RETURNING *`,
      [id, now],
    );
    if (r.rowCount === 0) throw new Error(`grant not found: ${id}`);
    return rowToGrant(r.rows[0]!);
  }

  async recordSpend(id: string, valueWei: bigint): Promise<SessionGrant> {
    return this.withTx(async (client) => {
      const cur = await client.query<DbRow>("SELECT * FROM session_grants WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (cur.rowCount === 0) throw new Error(`grant not found: ${id}`);
      const row = cur.rows[0]!;
      if (row.status !== "active") throw new Error(`grant not active: ${row.status}`);
      const newSpent = BigInt(row.spent_wei) + valueWei;
      if (newSpent > BigInt(row.spend_cap_wei)) {
        throw new Error(
          `charge ${valueWei} would exceed grant cap ${row.spend_cap_wei} (currently spent ${row.spent_wei})`,
        );
      }
      const depleted = newSpent === BigInt(row.spend_cap_wei);
      const now = this.now();
      const upd = await client.query<DbRow>(
        "UPDATE session_grants SET spent_wei=$2, status=$3, updated_at=$4 WHERE id=$1 RETURNING *",
        [id, newSpent.toString(), depleted ? "depleted" : "active", now],
      );
      return rowToGrant(upd.rows[0]!);
    });
  }

  async refundSpend(id: string, valueWei: bigint): Promise<SessionGrant> {
    return this.withTx(async (client) => {
      const cur = await client.query<DbRow>("SELECT * FROM session_grants WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (cur.rowCount === 0) throw new Error(`grant not found: ${id}`);
      const row = cur.rows[0]!;
      const spent = BigInt(row.spent_wei);
      const refund = valueWei > spent ? spent : valueWei;
      const newSpent = spent - refund;
      const wasDepleted = row.status === "depleted";
      const newStatus = wasDepleted && newSpent < BigInt(row.spend_cap_wei) ? "active" : row.status;
      const now = this.now();
      const upd = await client.query<DbRow>(
        "UPDATE session_grants SET spent_wei=$2, status=$3, updated_at=$4 WHERE id=$1 RETURNING *",
        [id, newSpent.toString(), newStatus, now],
      );
      return rowToGrant(upd.rows[0]!);
    });
  }

  async setPrivyPolicyId(id: string, policyId: string | null): Promise<SessionGrant> {
    const now = this.now();
    const r = await this.pool.query<DbRow>(
      "UPDATE session_grants SET privy_policy_id=$2, updated_at=$3 WHERE id=$1 RETURNING *",
      [id, policyId, now],
    );
    if (r.rowCount === 0) throw new Error(`grant not found: ${id}`);
    return rowToGrant(r.rows[0]!);
  }

  async markExpired(id: string): Promise<SessionGrant> {
    const now = this.now();
    const r = await this.pool.query<DbRow>(
      `UPDATE session_grants SET status='expired', updated_at=$2 WHERE id=$1 AND status NOT IN ('revoked','expired') RETURNING *`,
      [id, now],
    );
    if (r.rowCount === 0) {
      const fallback = await this.pool.query<DbRow>("SELECT * FROM session_grants WHERE id=$1", [
        id,
      ]);
      if (fallback.rowCount === 0) throw new Error(`grant not found: ${id}`);
      return rowToGrant(fallback.rows[0]!);
    }
    return rowToGrant(r.rows[0]!);
  }

  async findCovering(
    userId: string,
    call: { to: `0x${string}`; value: string; data: `0x${string}` },
    network: NetworkName,
  ): Promise<SessionGrant | null> {
    return this.withTx(async (client) => {
      const res = await client.query<DbRow>(
        `SELECT * FROM session_grants
         WHERE user_id=$1 AND network=$2 AND status='active'
         ORDER BY created_at DESC FOR UPDATE`,
        [userId, network],
      );
      const value = BigInt(call.value);
      const selector =
        call.data.length >= 10 ? (call.data.slice(0, 10).toLowerCase() as `0x${string}`) : null;
      for (const row of res.rows) {
        const refreshed = await this.maybeExpire(client, row);
        if (refreshed.status !== "active") continue;
        const targets = refreshed.allowedTargets.map((t) => t.toLowerCase());
        if (targets.length > 0 && !targets.includes(call.to.toLowerCase() as `0x${string}`)) {
          continue;
        }
        const selectors = refreshed.allowedSelectors.map((s) => s.toLowerCase());
        if (selectors.length > 0 && selector && !selectors.includes(selector)) continue;
        if (BigInt(refreshed.spentWei) + value > BigInt(refreshed.spendCapWei)) continue;
        return refreshed;
      }
      return null;
    });
  }

  private async maybeExpire(client: PoolClient, row: DbRow): Promise<SessionGrant> {
    if (
      (row.status === "active" || row.status === "pending") &&
      Number(row.expires_at) < this.now()
    ) {
      const now = this.now();
      const upd = await client.query<DbRow>(
        `UPDATE session_grants SET status='expired', updated_at=$2 WHERE id=$1 RETURNING *`,
        [row.id, now],
      );
      return rowToGrant(upd.rows[0]!);
    }
    return rowToGrant(row);
  }

  private async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
