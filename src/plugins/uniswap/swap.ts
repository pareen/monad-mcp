import { encodeFunctionData, parseUnits } from "viem";
import { z } from "zod";
import { erc20Abi } from "../../tools/abi.js";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { quoterV2Abi, swapRouter02Abi } from "./abi.js";
import { FEE_TIERS, type FeeTier, uniswapAddressesFor } from "./config.js";

const shape = {
  token_in: addressSchema,
  token_out: addressSchema,
  amount_in: amountSchema,
  slippage_bps: z.coerce
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(50)
    .describe("Max slippage in basis points (1bps = 0.01%). Default 50 = 0.5%."),
  fee: z
    .union([z.literal(100), z.literal(500), z.literal(3000), z.literal(10000)])
    .optional()
    .describe("Uniswap v3 fee tier. If omitted, the best tier from a quote sweep is used."),
  network: optionalNetwork,
  ttl_seconds: z.coerce
    .number()
    .int()
    .positive()
    .max(3600)
    .default(300)
    .describe("How long the approval link stays valid. Defaults to 5 minutes."),
};

export const uniswapSwapTool: ToolDefinition<typeof shape> = {
  name: "uniswap_swap",
  title: "Swap tokens on Uniswap v3 (Monad)",
  description:
    "Builds an unsigned exactInputSingle swap on Uniswap v3 and returns an approval URL. " +
    "Automatically picks the best fee tier if not specified, applies slippage protection, " +
    "and instructs the user to also approve the ERC-20 if needed. The user reviews and " +
    "approves in the Privy wallet UI; poll the request with `poll_request` to get the tx hash.",
  kind: "write",
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) {
      throw new Error("unreachable: write-tool auth checked by registry");
    }
    const addresses = uniswapAddressesFor(ctx.network);
    if (!addresses.swapRouter02 || !addresses.quoterV2) {
      throw new Error(
        `Uniswap router/quoter not configured for Monad ${ctx.network}. ` +
          `Set UNISWAP_${ctx.network.toUpperCase()}_SWAP_ROUTER_02 and UNISWAP_${ctx.network.toUpperCase()}_QUOTER_V2.`,
      );
    }

    const client = ctx.server.clients.publicClient(ctx.network);

    const [decimalsIn, symbolIn, decimalsOut, symbolOut, currentAllowance] = await Promise.all([
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
      client.readContract({
        address: args.token_in,
        abi: erc20Abi,
        functionName: "allowance",
        args: [ctx.walletAddress, addresses.swapRouter02],
      }) as Promise<bigint>,
    ]);

    const amountIn = parseUnits(args.amount_in, decimalsIn);

    // Approval check: if the router doesn't have enough allowance, build an
    // approve() request first and tell the user to do both.
    const needsApproval = currentAllowance < amountIn;

    // Pick fee tier — use provided, else sweep quoter for the best one.
    let fee: FeeTier;
    let amountOut: bigint;
    if (args.fee) {
      fee = args.fee;
      const out = (await client.simulateContract({
        address: addresses.quoterV2,
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
      amountOut = out.result[0];
    } else {
      const candidates: Array<{ fee: FeeTier; out: bigint }> = [];
      await Promise.all(
        FEE_TIERS.map(async (f) => {
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
                  fee: f,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            })) as unknown as { result: [bigint, bigint, number, bigint] };
            if (out.result[0] > 0n) candidates.push({ fee: f, out: out.result[0] });
          } catch {
            // skip empty pools
          }
        }),
      );
      if (candidates.length === 0) {
        throw new Error(
          `No Uniswap v3 pool found for ${symbolIn} → ${symbolOut} on Monad ${ctx.network}.`,
        );
      }
      candidates.sort((a, b) => (b.out > a.out ? 1 : -1));
      fee = candidates[0]!.fee;
      amountOut = candidates[0]!.out;
    }

    const slippageDenom = 10_000n;
    const amountOutMinimum =
      (amountOut * (slippageDenom - BigInt(args.slippage_bps))) / slippageDenom;

    const data = encodeFunctionData({
      abi: swapRouter02Abi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: args.token_in,
          tokenOut: args.token_out,
          fee,
          recipient: ctx.walletAddress,
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const summary = `Swap ${args.amount_in} ${symbolIn} → ~${(Number(amountOut) / 10 ** decimalsOut).toFixed(6)} ${symbolOut} on Uniswap v3 (fee ${fee / 10_000}%, max slippage ${args.slippage_bps / 100}%)`;

    const call = {
      to: addresses.swapRouter02,
      value: "0",
      data,
    };

    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: {
        plugin: "uniswap",
        fee,
        quoted_amount_out: amountOut.toString(),
        amount_out_minimum: amountOutMinimum.toString(),
        router: addresses.swapRouter02,
      },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      simulation: {
        assetChanges: [
          {
            kind: "erc20",
            token: args.token_in,
            symbol: symbolIn,
            decimals: decimalsIn,
            delta: `-${amountIn.toString()}`,
          },
          {
            kind: "erc20",
            token: args.token_out,
            symbol: symbolOut,
            decimals: decimalsOut,
            delta: `+${amountOutMinimum.toString()}`, // minimum — actual may be higher
          },
        ],
      },
      pluginContext: {
        plugin: "uniswap",
        fee,
        quoted_amount_out: amountOut.toString(),
        amount_out_minimum: amountOutMinimum.toString(),
        slippage_bps: args.slippage_bps,
        needs_approval: needsApproval,
      },
      ttlMs: args.ttl_seconds * 1000,
    });

    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;

    const approvalNote = needsApproval
      ? `\n⚠ This swap requires an ERC-20 approval first. Call \`approve_erc20\` with token=${args.token_in} spender=${addresses.swapRouter02} amount=${args.amount_in}, approve that link, then return to this swap's link.`
      : "";

    return {
      text:
        `Swap prepared: ${summary}.\n` +
        `Open this link to review and approve:\n${approvalUrl}\n` +
        `Then poll \`poll_request\` with request_id=${stored.id}. Link expires in ${args.ttl_seconds}s.${approvalNote}`,
      structured: {
        request_id: stored.id,
        approval_url: approvalUrl,
        plugin: "uniswap",
        fee,
        quoted_amount_out: amountOut.toString(),
        amount_out_minimum: amountOutMinimum.toString(),
        needs_approval: needsApproval,
        router: addresses.swapRouter02,
      },
    };
  },
};
