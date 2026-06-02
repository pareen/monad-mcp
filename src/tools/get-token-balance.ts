import { erc20Abi } from "./abi.js";
import { formatToken, shortAddr } from "./format.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const shape = {
  token: addressSchema.describe("ERC-20 contract address."),
  address: addressSchema
    .optional()
    .describe("Holder address. Defaults to the authenticated user's wallet."),
  network: optionalNetwork,
};

export const getTokenBalanceTool: ToolDefinition<typeof shape> = {
  name: "get_token_balance",
  title: "Get ERC-20 token balance",
  description:
    "Returns the balance of an ERC-20 token for an address on Monad. " +
    "Also reads the token's symbol and decimals so the output is human-readable.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const holder = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!holder) {
      return {
        text: "No address provided and no authenticated wallet. Pass `address` or sign in.",
        structured: { error: "no_address" },
      };
    }

    const client = ctx.server.clients.publicClient(ctx.network);

    const [balance, decimals, symbol] = await Promise.all([
      client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [holder],
      }) as Promise<bigint>,
      client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "decimals",
      }) as Promise<number>,
      client
        .readContract({
          address: args.token,
          abi: erc20Abi,
          functionName: "symbol",
        })
        .catch(() => "TOKEN") as Promise<string>,
    ]);

    return {
      text: `${shortAddr(holder)} on Monad ${ctx.network}: ${formatToken(balance, decimals, symbol)} (${args.token})`,
      structured: {
        holder,
        token: args.token,
        symbol,
        decimals,
        balance_raw: balance.toString(),
        balance_formatted: formatToken(balance, decimals, symbol),
        network: ctx.network,
        explorer_url: addressExplorerUrl(ctx.network, args.token),
      },
    };
  },
};
