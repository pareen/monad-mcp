import type { NetworkName } from "../chains/monad.js";

export type StoredRequestStatus = "pending" | "approved" | "rejected" | "expired";

/**
 * An unsigned transaction the agent has built and is asking the user to approve.
 * The "stored request" primitive: the agent stashes the payload, the user
 * follows an approval URL that surfaces it in a wallet UI, and the agent polls
 * for the resulting tx hash.
 */
export interface StoredRequest {
  id: string;
  userId: string;
  network: NetworkName;
  walletAddress: `0x${string}`;
  /** Human-readable summary for the approval page header. */
  summary: string;
  /** EIP-1193-style call payload. We only need `to`, `value`, `data`. */
  call: {
    to: `0x${string}`;
    value: string; // wei as decimal string
    data: `0x${string}`;
  };
  /** Pre-decoded simulation hints for the approval UI. */
  simulation?: {
    assetChanges?: Array<{
      kind: "native" | "erc20";
      token?: `0x${string}`;
      symbol?: string;
      decimals?: number;
      delta: string; // signed decimal string in smallest unit
    }>;
    estimatedGas?: string;
  };
  /** Free-form metadata a plugin can stash for its own reference. */
  pluginContext?: Record<string, unknown>;
  status: StoredRequestStatus;
  /** Set when status transitions to "approved". */
  txHash?: `0x${string}`;
  /** Set when status transitions to "rejected" — reason from the wallet UI. */
  rejectionReason?: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

export interface CreateStoredRequestInput {
  userId: string;
  network: NetworkName;
  walletAddress: `0x${string}`;
  summary: string;
  call: StoredRequest["call"];
  simulation?: StoredRequest["simulation"];
  pluginContext?: Record<string, unknown>;
  ttlMs?: number;
}

export interface RequestStore {
  create(input: CreateStoredRequestInput): Promise<StoredRequest>;
  get(id: string): Promise<StoredRequest | null>;
  /** Marks the request approved and records the tx hash. Idempotent. */
  markApproved(id: string, txHash: `0x${string}`): Promise<StoredRequest>;
  markRejected(id: string, reason?: string): Promise<StoredRequest>;
  /** Force expire — invoked by the GC sweep when expiresAt passes. */
  markExpired(id: string): Promise<StoredRequest>;
}
