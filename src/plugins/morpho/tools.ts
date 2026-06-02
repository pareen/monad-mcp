import { encodeFunctionData } from "viem";
import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { morphoBlueAbi } from "./abi.js";
import { morphoAddressesFor } from "./config.js";
import { type MarketParams, marketId } from "./market.js";
import { type MarketParamsInputJson, marketParamsSchema } from "./schemas.js";

function toMarketParams(input: MarketParamsInputJson): MarketParams {
  return {
    loanToken: input.loan_token as `0x${string}`,
    collateralToken: input.collateral_token as `0x${string}`,
    oracle: input.oracle as `0x${string}`,
    irm: input.irm as `0x${string}`,
    lltv: BigInt(input.lltv),
  };
}

function abiTupleFromMarket(m: MarketParams) {
  return {
    loanToken: m.loanToken,
    collateralToken: m.collateralToken,
    oracle: m.oracle,
    irm: m.irm,
    lltv: m.lltv,
  } as const;
}

async function storeAndReturn(
  ctx: ToolContext,
  args: {
    summary: string;
    call: { to: `0x${string}`; value: string; data: `0x${string}` };
    plugin_context: Record<string, unknown>;
    ttl_seconds: number;
  },
) {
  const stored = await ctx.server.store.create({
    userId: ctx.userId!,
    network: ctx.network,
    walletAddress: ctx.walletAddress!,
    summary: args.summary,
    call: args.call,
    pluginContext: args.plugin_context,
    ttlMs: args.ttl_seconds * 1000,
  });
  const url = approvalUrlFor(ctx.server, stored);
  return {
    text: `${args.summary}\nApprove: ${url}`,
    structured: {
      request_id: stored.id,
      approval_url: url,
      plugin: "morpho",
    },
  };
}

// ───────── supply ─────────
const supplyShape = {
  market: marketParamsSchema,
  amount: amountSchema.describe("Amount of loan token to supply, raw decimal e.g. '100'."),
  decimals: z.coerce.number().int().min(0).max(36).default(18),
  on_behalf: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const morphoSupplyTool: ToolDefinition<typeof supplyShape> = {
  name: "morpho_supply",
  title: "Supply loan asset to a Morpho market",
  description:
    "Supplies the loan asset of a Morpho Blue market. Pass MarketParams inline. Returns an " +
    "approval URL, or auto-executes under an active session grant.",
  kind: "write",
  inputSchema: supplyShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const m = toMarketParams(args.market);
    const assets = BigInt(Math.round(Number(args.amount) * 10 ** args.decimals));
    const onBehalf = (args.on_behalf ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "supply",
      args: [abiTupleFromMarket(m), assets, 0n, onBehalf, "0x"],
    });
    const call = { to: blue, value: "0", data };
    const summary = `Morpho supply: ${args.amount} (loan token ${m.loanToken}) to market ${marketId(m)}`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;
    return storeAndReturn(ctx as never, {
      summary,
      call,
      plugin_context: { plugin: "morpho", action: "supply", market_id: marketId(m) },
      ttl_seconds: args.ttl_seconds,
    });
  },
};

// ───────── withdraw ─────────
const withdrawShape = {
  market: marketParamsSchema,
  amount: amountSchema,
  decimals: z.coerce.number().int().min(0).max(36).default(18),
  receiver: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const morphoWithdrawTool: ToolDefinition<typeof withdrawShape> = {
  name: "morpho_withdraw",
  title: "Withdraw loan asset from a Morpho market",
  description: "Withdraws supplied loan assets from a Morpho Blue market.",
  kind: "write",
  inputSchema: withdrawShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const m = toMarketParams(args.market);
    const assets = BigInt(Math.round(Number(args.amount) * 10 ** args.decimals));
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "withdraw",
      args: [abiTupleFromMarket(m), assets, 0n, ctx.walletAddress, receiver],
    });
    const call = { to: blue, value: "0", data };
    const summary = `Morpho withdraw: ${args.amount} from market ${marketId(m)}`;
    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;
    return storeAndReturn(ctx as never, {
      summary,
      call,
      plugin_context: { plugin: "morpho", action: "withdraw", market_id: marketId(m) },
      ttl_seconds: args.ttl_seconds,
    });
  },
};

// ───────── borrow ─────────
const borrowShape = {
  market: marketParamsSchema,
  amount: amountSchema,
  decimals: z.coerce.number().int().min(0).max(36).default(18),
  receiver: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const morphoBorrowTool: ToolDefinition<typeof borrowShape> = {
  name: "morpho_borrow",
  title: "Borrow loan asset from a Morpho market",
  description:
    "Borrows the loan asset against the user's collateral position in the specified market.",
  kind: "write",
  inputSchema: borrowShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const m = toMarketParams(args.market);
    const assets = BigInt(Math.round(Number(args.amount) * 10 ** args.decimals));
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "borrow",
      args: [abiTupleFromMarket(m), assets, 0n, ctx.walletAddress, receiver],
    });
    const call = { to: blue, value: "0", data };
    const summary = `Morpho borrow: ${args.amount} from market ${marketId(m)} → ${receiver}`;
    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;
    return storeAndReturn(ctx as never, {
      summary,
      call,
      plugin_context: { plugin: "morpho", action: "borrow", market_id: marketId(m) },
      ttl_seconds: args.ttl_seconds,
    });
  },
};

// ───────── repay ─────────
const repayShape = {
  market: marketParamsSchema,
  amount: amountSchema,
  decimals: z.coerce.number().int().min(0).max(36).default(18),
  on_behalf: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const morphoRepayTool: ToolDefinition<typeof repayShape> = {
  name: "morpho_repay",
  title: "Repay borrowed loan asset to a Morpho market",
  description: "Repays a borrowed position in a Morpho Blue market.",
  kind: "write",
  inputSchema: repayShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const m = toMarketParams(args.market);
    const assets = BigInt(Math.round(Number(args.amount) * 10 ** args.decimals));
    const onBehalf = (args.on_behalf ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "repay",
      args: [abiTupleFromMarket(m), assets, 0n, onBehalf, "0x"],
    });
    const call = { to: blue, value: "0", data };
    const summary = `Morpho repay: ${args.amount} to market ${marketId(m)}`;
    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;
    return storeAndReturn(ctx as never, {
      summary,
      call,
      plugin_context: { plugin: "morpho", action: "repay", market_id: marketId(m) },
      ttl_seconds: args.ttl_seconds,
    });
  },
};

// ───────── position read ─────────
const positionShape = {
  market: marketParamsSchema,
  user: addressSchema.optional(),
  network: optionalNetwork,
};

export const morphoPositionTool: ToolDefinition<typeof positionShape> = {
  name: "morpho_position",
  title: "Read a Morpho position",
  description:
    "Returns supplyShares, borrowShares, and collateral for `user` in the given market. " +
    "Health-factor derivation requires the oracle price — surface the raw position here and " +
    "let the agent compute health if needed.",
  kind: "read",
  inputSchema: positionShape,
  handler: async (args, ctx) => {
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const user = (args.user ?? ctx.walletAddress) as `0x${string}` | null;
    if (!user) {
      return { text: "No address provided.", structured: { error: "no_address" } };
    }
    const m = toMarketParams(args.market);
    const id = marketId(m);
    const client = ctx.server.clients.publicClient(ctx.network);
    const pos = (await client.readContract({
      address: blue,
      abi: morphoBlueAbi,
      functionName: "position",
      args: [id, user],
    })) as readonly [bigint, bigint, bigint];

    return {
      text:
        `Morpho position for ${user} in market ${id}:\n` +
        `  supplyShares: ${pos[0]}\n  borrowShares: ${pos[1]}\n  collateral: ${pos[2]}`,
      structured: {
        plugin: "morpho",
        user,
        market_id: id,
        supply_shares: pos[0].toString(),
        borrow_shares: pos[1].toString(),
        collateral: pos[2].toString(),
      },
    };
  },
};

// ───────── market read ─────────
const marketShape = { market: marketParamsSchema, network: optionalNetwork };

export const morphoMarketTool: ToolDefinition<typeof marketShape> = {
  name: "morpho_market",
  title: "Read Morpho market totals",
  description:
    "Returns total supply assets/shares, total borrow assets/shares, lastUpdate, and fee for a " +
    "Morpho Blue market.",
  kind: "read",
  inputSchema: marketShape,
  handler: async (args, ctx) => {
    const { blue } = morphoAddressesFor(ctx.network);
    if (!blue) {
      return {
        text: `Morpho Blue not configured for Monad ${ctx.network}.`,
        structured: { error: "morpho_not_configured" },
      };
    }
    const m = toMarketParams(args.market);
    const id = marketId(m);
    const client = ctx.server.clients.publicClient(ctx.network);
    const r = (await client.readContract({
      address: blue,
      abi: morphoBlueAbi,
      functionName: "market",
      args: [id],
    })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

    return {
      text:
        `Morpho market ${id}:\n` +
        `  totalSupplyAssets: ${r[0]}  totalSupplyShares: ${r[1]}\n` +
        `  totalBorrowAssets: ${r[2]}  totalBorrowShares: ${r[3]}\n` +
        `  lastUpdate: ${r[4]}  fee: ${r[5]}`,
      structured: {
        plugin: "morpho",
        market_id: id,
        total_supply_assets: r[0].toString(),
        total_supply_shares: r[1].toString(),
        total_borrow_assets: r[2].toString(),
        total_borrow_shares: r[3].toString(),
        last_update: r[4].toString(),
        fee: r[5].toString(),
      },
    };
  },
};
