import type { SessionGrant } from "../grants/types.js";
import type { Logger } from "../logger.js";
import type { PrivyAuthBridge } from "./privy.js";

/**
 * Mirrors a session-key grant as a Privy wallet policy. Why: the MCP server
 * is the authoritative enforcer of the grant, but a compromised server could
 * bypass its own checks. Layering a Privy policy at the wallet level means
 * Privy itself refuses to sign txs outside the grant envelope — defense-in-depth.
 *
 * v1 mirrors a practical subset of the grant:
 *   - method restricted to eth_sendTransaction
 *   - recipient allowlist (EthereumTransactionCondition, field='to')
 *   - TTL guardrail via SystemCondition (current_unix_timestamp < expires_at)
 *
 * Out of scope for v1 (documented in implementation-notes.html):
 *   - native spend cap (Privy aggregations are bounded to 72h and the
 *     Aggregations class is a stub in @privy-io/node v0.19 — server stays
 *     authoritative for the long-horizon cap)
 *   - 4-byte selector allowlist (requires per-allowed-function ABI)
 */
export class PolicyMirror {
  constructor(
    private readonly bridge: PrivyAuthBridge,
    private readonly logger: Logger,
  ) {}

  /**
   * Best-effort. If anything fails, logs a warning and returns null so the
   * caller can keep the grant active (MCP-layer enforcement still applies).
   */
  async mirror(grant: SessionGrant, walletId: string): Promise<string | null> {
    try {
      const rules: unknown[] = [];

      // 1. Deny anything not eth_sendTransaction.
      rules.push({
        action: "DENY",
        method: "*",
        name: "deny-non-send",
        conditions: [],
      });

      // 2. TTL guardrail — current unix seconds must be < expiry.
      rules.push({
        action: "DENY",
        method: "eth_sendTransaction",
        name: "deny-after-ttl",
        conditions: [
          {
            field: "current_unix_timestamp",
            field_source: "system",
            operator: "gte",
            value: Math.floor(grant.expiresAt / 1000).toString(),
          },
        ],
      });

      // 3. Recipient allowlist (only when the grant specifies one).
      if (grant.allowedTargets.length > 0) {
        rules.push({
          action: "DENY",
          method: "eth_sendTransaction",
          name: "deny-bad-recipient",
          conditions: [
            {
              field: "to",
              field_source: "ethereum_transaction",
              operator: "not_in",
              value: grant.allowedTargets,
            },
          ],
        });
      }

      const policy = await this.bridge.createPolicy({
        chain_type: "ethereum",
        name: `mcp-grant-${grant.id}`,
        version: "1.0",
        rules,
      });

      await this.bridge.setWalletPolicyIds(walletId, [policy.id]);
      this.logger.info("grant policy mirror attached", {
        grant_id: grant.id,
        policy_id: policy.id,
        wallet_id: walletId,
      });
      return policy.id;
    } catch (err) {
      this.logger.warn("grant policy mirror failed — server-layer enforcement only", {
        grant_id: grant.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async unmirror(grant: SessionGrant, walletId: string): Promise<void> {
    if (!grant.privyPolicyId) return;
    try {
      await this.bridge.setWalletPolicyIds(walletId, []);
      await this.bridge.deletePolicy(grant.privyPolicyId);
      this.logger.info("grant policy mirror detached + deleted", {
        grant_id: grant.id,
        policy_id: grant.privyPolicyId,
      });
    } catch (err) {
      this.logger.warn("grant policy unmirror failed", {
        grant_id: grant.id,
        policy_id: grant.privyPolicyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
