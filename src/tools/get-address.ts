import { z } from "zod";
import { AuthRequiredError, WalletNotFoundError } from "../errors.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";

export const getAddressTool: ToolDefinition<Record<string, never>> = {
  name: "get_address",
  title: "Get connected wallet address",
  description:
    "Returns the Monad wallet address currently linked to the authenticated user via Privy. " +
    "Requires the user to be signed in.",
  kind: "read",
  inputSchema: {},
  handler: async (_args, ctx) => {
    if (!ctx.userId) throw new AuthRequiredError();
    if (!ctx.walletAddress) throw new WalletNotFoundError();
    return {
      text: `${ctx.walletAddress} (Monad ${ctx.network})\n${addressExplorerUrl(ctx.network, ctx.walletAddress)}`,
      structured: {
        address: ctx.walletAddress,
        network: ctx.network,
        explorer_url: addressExplorerUrl(ctx.network, ctx.walletAddress),
      },
    };
  },
};

// Forces the registry's generic to resolve cleanly even with an empty shape.
export const _emptyShape = z.object({}).shape;
