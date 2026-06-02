import { randomUUID } from "node:crypto";
import { StoredRequestExpiredError, StoredRequestNotFoundError } from "../errors.js";
import type { CreateStoredRequestInput, RequestStore, StoredRequest } from "./types.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface MemoryStoreOptions {
  defaultTtlMs?: number;
  /** Override the clock for tests. */
  now?: () => number;
}

/**
 * Process-local store. Fine for single-instance dev. For production with
 * multiple replicas, swap in a Postgres/Redis adapter that satisfies the same
 * RequestStore interface.
 */
export class MemoryRequestStore implements RequestStore {
  private readonly requests = new Map<string, StoredRequest>();
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryStoreOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async create(input: CreateStoredRequestInput): Promise<StoredRequest> {
    const now = this.now();
    const ttl = input.ttlMs ?? this.defaultTtlMs;
    const req: StoredRequest = {
      id: randomUUID(),
      userId: input.userId,
      network: input.network,
      walletAddress: input.walletAddress,
      summary: input.summary,
      call: input.call,
      simulation: input.simulation,
      pluginContext: input.pluginContext,
      status: "pending",
      createdAt: now,
      expiresAt: now + ttl,
      updatedAt: now,
    };
    this.requests.set(req.id, req);
    return req;
  }

  async get(id: string): Promise<StoredRequest | null> {
    const req = this.requests.get(id) ?? null;
    if (!req) return null;
    if (req.status === "pending" && req.expiresAt < this.now()) {
      const expired = { ...req, status: "expired" as const, updatedAt: this.now() };
      this.requests.set(id, expired);
      return expired;
    }
    return req;
  }

  async markApproved(id: string, txHash: `0x${string}`): Promise<StoredRequest> {
    const req = await this.get(id);
    if (!req) throw new StoredRequestNotFoundError(id);
    if (req.status === "expired") throw new StoredRequestExpiredError(id);
    if (req.status === "approved" && req.txHash === txHash) return req; // idempotent
    const next: StoredRequest = {
      ...req,
      status: "approved",
      txHash,
      updatedAt: this.now(),
    };
    this.requests.set(id, next);
    return next;
  }

  async markRejected(id: string, reason?: string): Promise<StoredRequest> {
    const req = await this.get(id);
    if (!req) throw new StoredRequestNotFoundError(id);
    if (req.status === "approved") return req; // can't reverse an approval
    const next: StoredRequest = {
      ...req,
      status: "rejected",
      rejectionReason: reason,
      updatedAt: this.now(),
    };
    this.requests.set(id, next);
    return next;
  }

  async markExpired(id: string): Promise<StoredRequest> {
    const req = await this.get(id);
    if (!req) throw new StoredRequestNotFoundError(id);
    if (req.status !== "pending") return req;
    const next: StoredRequest = { ...req, status: "expired", updatedAt: this.now() };
    this.requests.set(id, next);
    return next;
  }
}
