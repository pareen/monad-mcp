import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { StoredRequestExpiredError, StoredRequestNotFoundError } from "../errors.js";
import type {
  CreateStoredRequestInput,
  RequestStore,
  StoredRequest,
  StoredRequestStatus,
} from "./types.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface DbRow {
  id: string;
  user_id: string;
  network: "mainnet" | "testnet";
  wallet_address: string;
  summary: string;
  call_to: string;
  call_value: string;
  call_data: string;
  simulation: unknown;
  plugin_context: unknown;
  status: StoredRequestStatus;
  tx_hash: string | null;
  rejection_reason: string | null;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

function rowToRequest(r: DbRow): StoredRequest {
  return {
    id: r.id,
    userId: r.user_id,
    network: r.network,
    walletAddress: r.wallet_address as `0x${string}`,
    summary: r.summary,
    call: {
      to: r.call_to as `0x${string}`,
      value: r.call_value,
      data: r.call_data as `0x${string}`,
    },
    simulation: (r.simulation as StoredRequest["simulation"]) ?? undefined,
    pluginContext: (r.plugin_context as Record<string, unknown>) ?? undefined,
    status: r.status,
    txHash: (r.tx_hash as `0x${string}` | null) ?? undefined,
    rejectionReason: r.rejection_reason ?? undefined,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    updatedAt: Number(r.updated_at),
  };
}

export interface PgRequestStoreOptions {
  defaultTtlMs?: number;
  now?: () => number;
}

export class PgRequestStore implements RequestStore {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly pool: Pool,
    options: PgRequestStoreOptions = {},
  ) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async create(input: CreateStoredRequestInput): Promise<StoredRequest> {
    const id = randomUUID();
    const now = this.now();
    const expires = now + (input.ttlMs ?? this.defaultTtlMs);
    const res = await this.pool.query<DbRow>(
      `INSERT INTO stored_requests (
        id, user_id, network, wallet_address, summary,
        call_to, call_value, call_data, simulation, plugin_context,
        status, created_at, expires_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$11) RETURNING *`,
      [
        id,
        input.userId,
        input.network,
        input.walletAddress,
        input.summary,
        input.call.to,
        input.call.value,
        input.call.data,
        input.simulation ? JSON.stringify(input.simulation) : null,
        input.pluginContext ? JSON.stringify(input.pluginContext) : null,
        now,
        expires,
      ],
    );
    return rowToRequest(res.rows[0]!);
  }

  async get(id: string): Promise<StoredRequest | null> {
    return this.withTx(async (client) => {
      const r = await client.query<DbRow>(
        "SELECT * FROM stored_requests WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (r.rowCount === 0) return null;
      const row = r.rows[0]!;
      if (row.status === "pending" && Number(row.expires_at) < this.now()) {
        const now = this.now();
        const upd = await client.query<DbRow>(
          `UPDATE stored_requests SET status='expired', updated_at=$2 WHERE id=$1 RETURNING *`,
          [id, now],
        );
        return rowToRequest(upd.rows[0]!);
      }
      return rowToRequest(row);
    });
  }

  async markApproved(id: string, txHash: `0x${string}`): Promise<StoredRequest> {
    return this.withTx(async (client) => {
      const cur = await client.query<DbRow>(
        "SELECT * FROM stored_requests WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (cur.rowCount === 0) throw new StoredRequestNotFoundError(id);
      const row = cur.rows[0]!;
      if (row.status === "expired") throw new StoredRequestExpiredError(id);
      if (row.status === "approved" && row.tx_hash === txHash) return rowToRequest(row);
      const now = this.now();
      const upd = await client.query<DbRow>(
        `UPDATE stored_requests SET status='approved', tx_hash=$2, updated_at=$3 WHERE id=$1 RETURNING *`,
        [id, txHash, now],
      );
      return rowToRequest(upd.rows[0]!);
    });
  }

  async markRejected(id: string, reason?: string): Promise<StoredRequest> {
    return this.withTx(async (client) => {
      const cur = await client.query<DbRow>(
        "SELECT * FROM stored_requests WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (cur.rowCount === 0) throw new StoredRequestNotFoundError(id);
      const row = cur.rows[0]!;
      if (row.status === "approved") return rowToRequest(row);
      const upd = await client.query<DbRow>(
        `UPDATE stored_requests SET status='rejected', rejection_reason=$2, updated_at=$3 WHERE id=$1 RETURNING *`,
        [id, reason ?? null, this.now()],
      );
      return rowToRequest(upd.rows[0]!);
    });
  }

  async markExpired(id: string): Promise<StoredRequest> {
    const cur = await this.pool.query<DbRow>("SELECT * FROM stored_requests WHERE id=$1", [id]);
    if (cur.rowCount === 0) throw new StoredRequestNotFoundError(id);
    const row = cur.rows[0]!;
    if (row.status !== "pending") return rowToRequest(row);
    const upd = await this.pool.query<DbRow>(
      `UPDATE stored_requests SET status='expired', updated_at=$2 WHERE id=$1 RETURNING *`,
      [id, this.now()],
    );
    return rowToRequest(upd.rows[0]!);
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
