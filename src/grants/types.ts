import type { NetworkName } from "../chains/monad.js";

export type GrantStatus = "pending" | "active" | "revoked" | "expired" | "depleted";

/**
 * A session-key grant: a scoped, pre-authorized spend window that lets the
 * agent execute write tools without a per-tx approval URL.
 *
 * Why this exists: the basic stored-request flow ("agent builds tx → user
 * clicks approval URL") is fine for one-shots but unusable for agentic loops
 * (DCA, rebalancers). A grant flips the default: user authorizes ONCE within
 * a bounded envelope, agent proceeds inside it.
 *
 * v1 enforces grants at the MCP server layer. The wallet itself is still
 * unrestricted at the Privy layer — combining the two (mirror the grant as a
 * Privy policy) is defense-in-depth for a later iteration.
 *
 * Coverage rules:
 *   - The grant must be `active` (post-approval) and not expired.
 *   - Call `to` must be in `allowedTargets`, or the list must be empty.
 *   - First 4 bytes of `data` must be in `allowedSelectors`, or unset.
 *   - For native-MON calls: spentWei + value <= spendCapWei.
 *   - For ERC-20 calls: v1 grants do NOT track token spend; the agent can
 *     still move tokens within a grant if `allowed_targets` includes the
 *     token's address. Tighten by listing only specific tokens.
 */
export interface SessionGrant {
  id: string;
  userId: string;
  walletAddress: `0x${string}`;
  network: NetworkName;
  label: string;
  spendCapWei: string; // total cap, native MON, decimal string
  spentWei: string; // running total spent under this grant
  allowedTargets: `0x${string}`[]; // empty = any
  allowedSelectors: `0x${string}`[]; // 4-byte selectors; empty = any
  status: GrantStatus;
  /** Pending grants need a click-approval; this is the approval URL token. */
  approvalRequestId?: string;
  /**
   * Privy policy id mirroring this grant. Set on activation if the policy
   * mirror succeeds; null if the mirror failed (server-layer enforcement still
   * applies). Used on revoke to detach + delete.
   */
  privyPolicyId?: string;
  createdAt: number;
  approvedAt?: number;
  expiresAt: number; // grant TTL window (not the same as request TTL)
  revokedAt?: number;
  updatedAt: number;
}

export interface CreateGrantInput {
  userId: string;
  walletAddress: `0x${string}`;
  network: NetworkName;
  label: string;
  spendCapWei: string;
  allowedTargets?: `0x${string}`[];
  allowedSelectors?: `0x${string}`[];
  ttlMs: number;
}

export interface GrantStore {
  create(input: CreateGrantInput): Promise<SessionGrant>;
  get(id: string): Promise<SessionGrant | null>;
  listForUser(userId: string): Promise<SessionGrant[]>;
  /** Marks a pending grant active. Sets approvedAt. */
  activate(id: string): Promise<SessionGrant>;
  revoke(id: string): Promise<SessionGrant>;
  /**
   * Atomically charge `valueWei` against the grant. Throws if the grant is no
   * longer active or the charge would exceed the cap.
   */
  recordSpend(id: string, valueWei: bigint): Promise<SessionGrant>;
  /**
   * Refund a previously-charged amount (e.g. when the downstream tx fails).
   * Clamps at zero — never goes negative. If the grant was marked `depleted`,
   * it returns to `active`.
   */
  refundSpend(id: string, valueWei: bigint): Promise<SessionGrant>;
  markExpired(id: string): Promise<SessionGrant>;
  /** Set/clear the Privy policy id mirroring this grant. */
  setPrivyPolicyId(id: string, policyId: string | null): Promise<SessionGrant>;
  /**
   * Find an active grant for this user that covers the given call. Returns
   * the first match. Caller must still atomically `recordSpend` to claim it.
   */
  findCovering(
    userId: string,
    call: { to: `0x${string}`; value: string; data: `0x${string}` },
    network: NetworkName,
  ): Promise<SessionGrant | null>;
}
