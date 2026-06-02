import { z } from "zod";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";

const shape = {
  email: z
    .string()
    .email()
    .optional()
    .describe(
      "Email to attach as the user's linked account. If omitted, a placeholder is generated.",
    ),
};

/**
 * Self-serve onboarding: create a Privy user with a Monad-ready embedded
 * wallet in one call. This is unauthenticated by design — the caller (agent)
 * may not yet have a user to authenticate as.
 *
 * After creation, the user can be referenced by `user_id`. Surface
 * `MONAD_MCP_DEV_USER_ID=<user_id>` in env (dev) or have the user log in via
 * Privy's web SDK to mint an access token for production use.
 */
export const createUserTool: ToolDefinition<typeof shape> = {
  name: "create_user",
  title: "Create a Privy user with a Monad-ready wallet",
  description:
    "Provisions a new Privy user and an Ethereum embedded wallet that works on Monad mainnet (143) " +
    "and testnet (10143). Returns the user_id and wallet address. Server requires PRIVY_APP_ID + " +
    "PRIVY_APP_SECRET to be configured.",
  kind: "read", // unauthenticated by design
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (!ctx.server.auth) {
      return {
        text: "Privy is not configured on this server. Set PRIVY_APP_ID and PRIVY_APP_SECRET.",
        structured: { error: "privy_not_configured" },
      };
    }
    const resolved = await ctx.server.auth.createUserWithWallet({ email: args.email });
    return {
      text: `Created Privy user ${resolved.userId}\nMonad wallet: ${resolved.walletAddress}\nExplorer: ${addressExplorerUrl(ctx.network, resolved.walletAddress)}\nEmail: ${resolved.email ?? "(placeholder)"}\nFund the wallet from a Monad testnet faucet, then sign in with this user via Privy to start sending txs.`,
      structured: {
        user_id: resolved.userId,
        wallet_address: resolved.walletAddress,
        wallet_id: resolved.walletId,
        email: resolved.email,
        explorer_url: addressExplorerUrl(ctx.network, resolved.walletAddress),
      },
    };
  },
};
