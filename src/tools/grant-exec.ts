import { type Hex, toHex } from "viem";
import { MONAD_MAINNET_ID, MONAD_TESTNET_ID } from "../chains/monad.js";
import type { ToolContext } from "../context.js";
import type { SessionGrant } from "../grants/types.js";
import { txExplorerUrl } from "./registry.js";
import type { ToolResult } from "./registry.js";

function caip2For(network: "mainnet" | "testnet"): string {
  return network === "mainnet" ? `eip155:${MONAD_MAINNET_ID}` : `eip155:${MONAD_TESTNET_ID}`;
}

export interface GrantExecOptions {
  ctx: ToolContext;
  call: { to: `0x${string}`; value: string; data: `0x${string}` };
  summary: string;
  /** What to add to the structured payload on the grant-routed branch. */
  extraStructured?: Record<string, unknown>;
}

/**
 * Tries to execute `call` under an active session-key grant for the user.
 * Returns:
 *   - a ToolResult if a grant covered the call and the tx was submitted;
 *   - `null` if no grant covers it (caller falls back to approval-URL flow).
 *
 * Successful grant execution atomically charges the spend cap and submits
 * the tx via Privy in one step — the user sees nothing.
 */
export async function tryExecuteViaGrant(opts: GrantExecOptions): Promise<ToolResult | null> {
  const { ctx, call, summary, extraStructured } = opts;
  if (!ctx.userId || !ctx.walletAddress) return null;
  if (!ctx.server.auth) return null;

  const grant = await ctx.server.grants.findCovering(ctx.userId, call, ctx.network);
  if (!grant) return null;

  // Atomically charge first. If this throws (race / cap exceeded), fall back.
  let updated: SessionGrant;
  try {
    updated = await ctx.server.grants.recordSpend(grant.id, BigInt(call.value));
  } catch (err) {
    ctx.server.logger.warn("grant charge failed — falling back to approval", {
      grant_id: grant.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // Resolve wallet — we may not have a walletId on ToolContext.
  const resolved = await ctx.server.auth.resolveUser(ctx.userId);

  try {
    const valueHex = toHex(BigInt(call.value));
    const txHash = await ctx.server.auth.sendTransaction(resolved.walletId, {
      caip2: caip2For(ctx.network),
      to: call.to,
      value: valueHex as Hex,
      data: call.data,
    });

    ctx.server.logger.info("executed via grant", {
      grant_id: grant.id,
      user_id: ctx.userId,
      tx_hash: txHash,
    });

    return {
      text:
        `${summary}\n` +
        `Executed under session grant "${grant.label}" — no approval needed.\n` +
        `tx_hash: ${txHash}\n${txExplorerUrl(ctx.network, txHash)}\n` +
        `Grant remaining: ${BigInt(updated.spendCapWei) - BigInt(updated.spentWei)} wei`,
      structured: {
        ...(extraStructured ?? {}),
        executed_via_grant: true,
        grant_id: grant.id,
        tx_hash: txHash,
        explorer_url: txExplorerUrl(ctx.network, txHash),
        grant_spent_wei: updated.spentWei,
        grant_remaining_wei: (BigInt(updated.spendCapWei) - BigInt(updated.spentWei)).toString(),
      },
    };
  } catch (err) {
    await ctx.server.grants.refundSpend(grant.id, BigInt(call.value));
    ctx.server.logger.warn("grant charge refunded after Privy failure", {
      grant_id: grant.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
