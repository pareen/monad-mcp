import { formatNative, shortAddr } from "./format.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const shape = {
  address: addressSchema
    .optional()
    .describe("Address to query. Defaults to the authenticated user's wallet."),
  network: optionalNetwork,
};

export const getBalanceTool: ToolDefinition<typeof shape> = {
  name: "get_balance",
  title: "Get native MON balance",
  description:
    "Returns the native MON balance for an address on Monad. " +
    "If no address is provided, uses the authenticated user's wallet.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return {
        text: "No address provided and no authenticated wallet. Pass `address` or sign in.",
        structured: { error: "no_address" },
      };
    }

    const client = ctx.server.clients.publicClient(ctx.network);
    const wei = await client.getBalance({ address: target });

    return {
      text: `${shortAddr(target)} on Monad ${ctx.network}: ${formatNative(wei)}`,
      structured: {
        address: target,
        network: ctx.network,
        balance_wei: wei.toString(),
        balance_formatted: formatNative(wei),
        explorer_url: addressExplorerUrl(ctx.network, target),
      },
    };
  },
};
