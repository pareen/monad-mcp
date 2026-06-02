import { randomUUID } from "node:crypto";
import type { NetworkName } from "../chains/monad.js";
import type { CreateGrantInput, GrantStore, SessionGrant } from "./types.js";

export interface MemoryGrantStoreOptions {
  now?: () => number;
}

export class MemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, SessionGrant>();
  private readonly now: () => number;

  constructor(options: MemoryGrantStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async create(input: CreateGrantInput): Promise<SessionGrant> {
    const now = this.now();
    const grant: SessionGrant = {
      id: randomUUID(),
      userId: input.userId,
      walletAddress: input.walletAddress,
      network: input.network,
      label: input.label,
      spendCapWei: input.spendCapWei,
      spentWei: "0",
      allowedTargets: input.allowedTargets ?? [],
      allowedSelectors: input.allowedSelectors ?? [],
      status: "pending",
      createdAt: now,
      expiresAt: now + input.ttlMs,
      updatedAt: now,
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async get(id: string): Promise<SessionGrant | null> {
    const grant = this.grants.get(id) ?? null;
    if (!grant) return null;
    return this.maybeExpire(grant);
  }

  async listForUser(userId: string): Promise<SessionGrant[]> {
    const all: SessionGrant[] = [];
    for (const g of this.grants.values()) {
      if (g.userId === userId) all.push(this.maybeExpire(g));
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async activate(id: string): Promise<SessionGrant> {
    const grant = await this.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    if (grant.status !== "pending") return grant;
    const next: SessionGrant = {
      ...grant,
      status: "active",
      approvedAt: this.now(),
      updatedAt: this.now(),
    };
    this.grants.set(id, next);
    return next;
  }

  async revoke(id: string): Promise<SessionGrant> {
    const grant = await this.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    const next: SessionGrant = {
      ...grant,
      status: "revoked",
      revokedAt: this.now(),
      updatedAt: this.now(),
    };
    this.grants.set(id, next);
    return next;
  }

  async recordSpend(id: string, valueWei: bigint): Promise<SessionGrant> {
    const grant = await this.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    if (grant.status !== "active") throw new Error(`grant not active: ${grant.status}`);
    const newSpent = BigInt(grant.spentWei) + valueWei;
    if (newSpent > BigInt(grant.spendCapWei)) {
      throw new Error(
        `charge ${valueWei} would exceed grant cap ${grant.spendCapWei} (currently spent ${grant.spentWei})`,
      );
    }
    const depleted = newSpent === BigInt(grant.spendCapWei);
    const next: SessionGrant = {
      ...grant,
      spentWei: newSpent.toString(),
      status: depleted ? "depleted" : "active",
      updatedAt: this.now(),
    };
    this.grants.set(id, next);
    return next;
  }

  async refundSpend(id: string, valueWei: bigint): Promise<SessionGrant> {
    const grant = this.grants.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    const current = BigInt(grant.spentWei);
    const refundClamped = valueWei > current ? current : valueWei;
    const newSpent = current - refundClamped;
    const wasDepleted = grant.status === "depleted";
    const next: SessionGrant = {
      ...grant,
      spentWei: newSpent.toString(),
      status: wasDepleted && newSpent < BigInt(grant.spendCapWei) ? "active" : grant.status,
      updatedAt: this.now(),
    };
    this.grants.set(id, next);
    return next;
  }

  async setPrivyPolicyId(id: string, policyId: string | null): Promise<SessionGrant> {
    const grant = this.grants.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    const next: SessionGrant = {
      ...grant,
      privyPolicyId: policyId ?? undefined,
      updatedAt: this.now(),
    };
    this.grants.set(id, next);
    return next;
  }

  async markExpired(id: string): Promise<SessionGrant> {
    const grant = this.grants.get(id);
    if (!grant) throw new Error(`grant not found: ${id}`);
    if (grant.status === "expired" || grant.status === "revoked") return grant;
    const next: SessionGrant = { ...grant, status: "expired", updatedAt: this.now() };
    this.grants.set(id, next);
    return next;
  }

  async findCovering(
    userId: string,
    call: { to: `0x${string}`; value: string; data: `0x${string}` },
    network: NetworkName,
  ): Promise<SessionGrant | null> {
    const value = BigInt(call.value);
    const selector =
      call.data.length >= 10 ? (call.data.slice(0, 10).toLowerCase() as `0x${string}`) : null;

    for (const g of this.grants.values()) {
      const refreshed = this.maybeExpire(g);
      if (refreshed.userId !== userId) continue;
      if (refreshed.network !== network) continue;
      if (refreshed.status !== "active") continue;
      // Target allowlist (case-insensitive)
      if (refreshed.allowedTargets.length > 0) {
        const tos = refreshed.allowedTargets.map((t) => t.toLowerCase());
        if (!tos.includes(call.to.toLowerCase() as `0x${string}`)) continue;
      }
      // Selector allowlist — applies only when call has calldata
      if (refreshed.allowedSelectors.length > 0 && selector) {
        const sels = refreshed.allowedSelectors.map((s) => s.toLowerCase());
        if (!sels.includes(selector)) continue;
      }
      // Cap check (native-MON only; ERC-20 token-amount tracking is v2)
      if (BigInt(refreshed.spentWei) + value > BigInt(refreshed.spendCapWei)) continue;
      return refreshed;
    }
    return null;
  }

  /** Lazily transitions to "expired" when read past expiresAt. */
  private maybeExpire(grant: SessionGrant): SessionGrant {
    if ((grant.status === "active" || grant.status === "pending") && grant.expiresAt < this.now()) {
      const next: SessionGrant = { ...grant, status: "expired", updatedAt: this.now() };
      this.grants.set(grant.id, next);
      return next;
    }
    return grant;
  }
}
