import { formatUnits, parseUnits } from "viem";
import { z } from "zod";
import { erc20Abi } from "../../tools/abi.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { quoterV2Abi } from "./abi.js";
import { FEE_TIERS, type FeeTier, uniswapAddressesFor } from "./config.js";

const shape = {
  token_in: addressSchema.describe("Address of the token being sold."),
  token_out: addressSchema.describe("Address of the token being bought."),
  amount_in: amountSchema.describe('Amount of tokenIn to sell, e.g. "10".'),
  fee: z
    .union([z.literal(100), z.literal(500), z.literal(3000), z.literal(10000)])
    .optional()
    .describe(
      "Uniswap v3 fee tier in bps*100. If omitted, the tool tries each tier and returns the best quote.",
    ),
  network: optionalNetwork,
};

export const uniswapQuoteTool: ToolDefinition<typeof shape> = {
  name: "uniswap_quote",
  title: "Get a Uniswap v3 swap quote",
  description:
    "Quotes an exact-input swap on Uniswap v3 on Monad. Returns amount out, best fee tier, " +
    "and gas estimate. Read-only — calls QuoterV2 via eth_call.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const addresses = uniswapAddressesFor(ctx.network);
    if (!addresses.quoterV2) {
      return {
        text: `Uniswap quoter address not configured for Monad ${ctx.network}. Set UNISWAP_${ctx.network.toUpperCase()}_QUOTER_V2 in env.`,
        structured: { error: "quoter_not_configured", network: ctx.network },
      };
    }

    const client = ctx.server.clients.publicClient(ctx.network);

    const [decimalsIn, symbolIn, decimalsOut, symbolOut] = await Promise.all([
      client.readContract({
        address: args.token_in,
        abi: erc20Abi,
        functionName: "decimals",
      }) as Promise<number>,
      client
        .readContract({ address: args.token_in, abi: erc20Abi, functionName: "symbol" })
        .catch(() => "TOKEN_IN") as Promise<string>,
      client.readContract({
        address: args.token_out,
        abi: erc20Abi,
        functionName: "decimals",
      }) as Promise<number>,
      client
        .readContract({ address: args.token_out, abi: erc20Abi, functionName: "symbol" })
        .catch(() => "TOKEN_OUT") as Promise<string>,
    ]);

    const amountIn = parseUnits(args.amount_in, decimalsIn);
    const tiers: readonly FeeTier[] = args.fee ? [args.fee] : FEE_TIERS;

    type QuoteRow = { fee: FeeTier; amountOut: bigint; gasEstimate: bigint };
    const results: QuoteRow[] = [];

    await Promise.all(
      tiers.map(async (fee) => {
        try {
          const out = (await client.simulateContract({
            address: addresses.quoterV2!,
            abi: quoterV2Abi,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn: args.token_in,
                tokenOut: args.token_out,
                amountIn,
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          })) as unknown as { result: [bigint, bigint, number, bigint] };
          const [amountOut, , , gasEstimate] = out.result;
          if (amountOut > 0n) results.push({ fee, amountOut, gasEstimate });
        } catch {
          // pool doesn't exist at this fee tier — skip silently
        }
      }),
    );

    if (results.length === 0) {
      return {
        text: `No Uniswap v3 pool found for ${symbolIn} → ${symbolOut} on Monad ${ctx.network}.`,
        structured: {
          token_in: args.token_in,
          token_out: args.token_out,
          network: ctx.network,
          quotes: [],
        },
      };
    }

    results.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
    const best = results[0]!;

    return {
      text:
        `${args.amount_in} ${symbolIn} → ${formatUnits(best.amountOut, decimalsOut)} ${symbolOut} ` +
        `(fee ${best.fee / 10_000}%, gas est. ${best.gasEstimate.toString()})`,
      structured: {
        token_in: args.token_in,
        symbol_in: symbolIn,
        decimals_in: decimalsIn,
        token_out: args.token_out,
        symbol_out: symbolOut,
        decimals_out: decimalsOut,
        amount_in: amountIn.toString(),
        best: {
          fee: best.fee,
          amount_out: best.amountOut.toString(),
          amount_out_formatted: formatUnits(best.amountOut, decimalsOut),
          gas_estimate: best.gasEstimate.toString(),
        },
        all_quotes: results.map((r) => ({
          fee: r.fee,
          amount_out: r.amountOut.toString(),
          gas_estimate: r.gasEstimate.toString(),
        })),
      },
    };
  },
};
