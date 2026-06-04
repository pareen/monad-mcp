import { formatNative, shortAddr } from "./format.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { resolveOptionalAccount } from "./resolve-account.js";
import { accountSchema, optionalNetwork } from "./schemas.js";

const shape = {
  address: accountSchema
    .optional()
    .describe("Address or '.nad' name to query. Defaults to the authenticated user's wallet."),
  network: optionalNetwork,
};

export const getBalanceTool: ToolDefinition<typeof shape> = {
  name: "get_balance",
  title: "Get native MON balance",
  description:
    "Returns the native MON balance for an address on Monad. Accepts a 0x address or a '.nad' " +
    "name (resolved via nad.domains). If no address is provided, uses the authenticated user's wallet.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const resolved = await resolveOptionalAccount(ctx, args.address);
    const target = (resolved?.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return {
        text: "No address provided and no authenticated wallet. Pass `address` or sign in.",
        structured: { error: "no_address" },
      };
    }

    const client = ctx.server.clients.publicClient(ctx.network);
    const wei = await client.getBalance({ address: target });

    const label = resolved?.name ? `${resolved.name} (${shortAddr(target)})` : shortAddr(target);
    return {
      text: `${label} on Monad ${ctx.network}: ${formatNative(wei)}`,
      structured: {
        address: target,
        ...(resolved?.name ? { name: resolved.name } : {}),
        network: ctx.network,
        balance_wei: wei.toString(),
        balance_formatted: formatNative(wei),
        explorer_url: addressExplorerUrl(ctx.network, target),
      },
    };
  },
};
