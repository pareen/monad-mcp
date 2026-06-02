import { AuthRequiredError, WalletNotFoundError } from "../errors.js";
import type { ToolDefinition } from "./registry.js";
import { addressExplorerUrl } from "./registry.js";

export const whoamiTool: ToolDefinition<Record<string, never>> = {
  name: "whoami",
  title: "Who am I",
  description:
    "Returns the authenticated user's id, Monad wallet address, and any active session-key grants. " +
    "Requires the user to be signed in.",
  kind: "read",
  inputSchema: {},
  handler: async (_args, ctx) => {
    if (!ctx.userId) throw new AuthRequiredError();
    if (!ctx.walletAddress) throw new WalletNotFoundError();
    const grants = await ctx.server.grants.listForUser(ctx.userId);
    const active = grants.filter((g) => g.status === "active");

    const lines = [
      `user_id: ${ctx.userId}`,
      `wallet:  ${ctx.walletAddress} (${ctx.network})`,
      `explorer: ${addressExplorerUrl(ctx.network, ctx.walletAddress)}`,
      `active session grants: ${active.length}`,
    ];
    for (const g of active) {
      lines.push(
        `  · ${g.label} — spent ${g.spentWei}/${g.spendCapWei} wei, expires ${new Date(g.expiresAt).toISOString()}`,
      );
    }

    return {
      text: lines.join("\n"),
      structured: {
        user_id: ctx.userId,
        wallet_address: ctx.walletAddress,
        network: ctx.network,
        explorer_url: addressExplorerUrl(ctx.network, ctx.walletAddress),
        active_grants: active.map((g) => ({
          id: g.id,
          label: g.label,
          spend_cap_wei: g.spendCapWei,
          spent_wei: g.spentWei,
          expires_at: g.expiresAt,
          allowed_targets: g.allowedTargets,
        })),
      },
    };
  },
};
