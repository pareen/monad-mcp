import { encodeFunctionData } from "viem";
import { z } from "zod";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { optionalNetwork } from "../../tools/schemas.js";
import { kuruOrderBookAbi } from "./abi.js";
import { kuruAddressesFor, resolveKuruMarket } from "./config.js";

const marketIdentSchema = z
  .string()
  .min(1)
  .describe(
    "Market identifier: a known name (e.g. 'MON/USDC') or a raw 0x-prefixed OrderBook contract address.",
  );

// ───────── read: best bid/ask ─────────
const bestShape = { market: marketIdentSchema, network: optionalNetwork };

export const kuruBestBidAskTool: ToolDefinition<typeof bestShape> = {
  name: "kuru_best_bid_ask",
  title: "Best bid/ask on a Kuru market",
  description:
    "Reads the current best bid and best ask prices on a Kuru CLOB market. Prices are in the " +
    "market's price precision — call `kuru_market_params` to convert.",
  kind: "read",
  inputSchema: bestShape,
  handler: async (args, ctx) => {
    const addresses = kuruAddressesFor(ctx.network);
    const market = resolveKuruMarket(args.market, addresses);
    if (!market) {
      return {
        text: `Unknown Kuru market: ${args.market}`,
        structured: { error: "unknown_market" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const [bid, ask] = (await client.readContract({
      address: market,
      abi: kuruOrderBookAbi,
      functionName: "bestBidAsk",
    })) as readonly [number, number];
    return {
      text: `Kuru ${args.market}: best bid ${bid}, best ask ${ask} (raw, in market price precision)`,
      structured: { plugin: "kuru", market, best_bid: bid, best_ask: ask },
    };
  },
};

// ───────── read: market params ─────────
const paramsShape = { market: marketIdentSchema, network: optionalNetwork };

export const kuruMarketParamsTool: ToolDefinition<typeof paramsShape> = {
  name: "kuru_market_params",
  title: "Kuru market params (precision, fees, assets)",
  description:
    "Returns the per-market precision and fee config — required to convert price/size args to " +
    "raw integers before placing orders.",
  kind: "read",
  inputSchema: paramsShape,
  handler: async (args, ctx) => {
    const addresses = kuruAddressesFor(ctx.network);
    const market = resolveKuruMarket(args.market, addresses);
    if (!market) {
      return {
        text: `Unknown Kuru market: ${args.market}`,
        structured: { error: "unknown_market" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const p = (await client.readContract({
      address: market,
      abi: kuruOrderBookAbi,
      functionName: "getMarketParams",
    })) as {
      pricePrecision: number;
      sizePrecision: bigint;
      baseAssetAddress: `0x${string}`;
      baseAssetDecimals: number;
      quoteAssetAddress: `0x${string}`;
      quoteAssetDecimals: number;
      tickSize: number;
      minSize: bigint;
      maxSize: bigint;
      takerFeeBps: bigint;
      makerFeeBps: bigint;
    };
    return {
      text:
        `Kuru market ${market}\n` +
        `  base: ${p.baseAssetAddress} (${p.baseAssetDecimals} dec)\n` +
        `  quote: ${p.quoteAssetAddress} (${p.quoteAssetDecimals} dec)\n` +
        `  pricePrecision: ${p.pricePrecision}  sizePrecision: ${p.sizePrecision}  tickSize: ${p.tickSize}\n` +
        `  minSize: ${p.minSize}  maxSize: ${p.maxSize}\n` +
        `  takerFee: ${p.takerFeeBps} bps  makerFee: ${p.makerFeeBps} bps`,
      structured: {
        plugin: "kuru",
        market,
        base_asset: p.baseAssetAddress,
        base_decimals: p.baseAssetDecimals,
        quote_asset: p.quoteAssetAddress,
        quote_decimals: p.quoteAssetDecimals,
        price_precision: p.pricePrecision,
        size_precision: p.sizePrecision.toString(),
        tick_size: p.tickSize,
        min_size: p.minSize.toString(),
        max_size: p.maxSize.toString(),
        taker_fee_bps: p.takerFeeBps.toString(),
        maker_fee_bps: p.makerFeeBps.toString(),
      },
    };
  },
};

// ───────── write: limit order ─────────
function makeLimitShape() {
  return {
    market: marketIdentSchema,
    side: z.enum(["buy", "sell"]),
    price: z.coerce.number().int().nonnegative().describe("Raw price in market precision."),
    size: z.string().regex(/^\d+$/).describe("Raw size as decimal string (uint96)."),
    post_only: z.boolean().default(false),
    network: optionalNetwork,
    ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
  };
}

const limitShape = makeLimitShape();

export const kuruPlaceLimitTool: ToolDefinition<typeof limitShape> = {
  name: "kuru_place_limit",
  title: "Place a limit order on a Kuru market",
  description:
    "Places a limit order (buy or sell) on a Kuru CLOB market. Price and size are raw integers " +
    "in the market's precision — call `kuru_market_params` first to convert. `post_only` rejects " +
    "the order if it would cross the book.",
  kind: "write",
  inputSchema: limitShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const addresses = kuruAddressesFor(ctx.network);
    const market = resolveKuruMarket(args.market, addresses);
    if (!market) {
      return {
        text: `Unknown Kuru market: ${args.market}`,
        structured: { error: "unknown_market" },
      };
    }
    const fn = args.side === "buy" ? "addBuyOrder" : "addSellOrder";
    const data = encodeFunctionData({
      abi: kuruOrderBookAbi,
      functionName: fn,
      args: [args.price, BigInt(args.size), args.post_only],
    });
    const call = { to: market, value: "0", data };
    const summary = `Kuru limit ${args.side}: ${args.size} @ ${args.price} on ${args.market}${args.post_only ? " (post-only)" : ""}`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "kuru", action: "place_limit", market, side: args.side },
      ttlMs: args.ttl_seconds * 1000,
    });
    return {
      text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}`,
      structured: {
        request_id: stored.id,
        approval_url: `${approvalUrlFor(ctx.server, stored)}`,
        plugin: "kuru",
        market,
      },
    };
  },
};

// ───────── write: cancel ─────────
const cancelShape = {
  market: marketIdentSchema,
  order_ids: z.array(z.coerce.number().int().nonnegative()).min(1).max(100),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const kuruCancelOrdersTool: ToolDefinition<typeof cancelShape> = {
  name: "kuru_cancel_orders",
  title: "Cancel limit orders on a Kuru market",
  description: "Batch-cancels up to 100 open limit orders by id.",
  kind: "write",
  inputSchema: cancelShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const addresses = kuruAddressesFor(ctx.network);
    const market = resolveKuruMarket(args.market, addresses);
    if (!market) {
      return {
        text: `Unknown Kuru market: ${args.market}`,
        structured: { error: "unknown_market" },
      };
    }
    const data = encodeFunctionData({
      abi: kuruOrderBookAbi,
      functionName: "batchCancelOrders",
      args: [args.order_ids],
    });
    const call = { to: market, value: "0", data };
    const summary = `Kuru cancel ${args.order_ids.length} order(s) on ${args.market}`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "kuru", action: "cancel", market, ids: args.order_ids },
      ttlMs: args.ttl_seconds * 1000,
    });
    return {
      text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}`,
      structured: {
        request_id: stored.id,
        approval_url: `${approvalUrlFor(ctx.server, stored)}`,
      },
    };
  },
};

// ───────── write: market swap ─────────
const marketSwapShape = {
  market: marketIdentSchema,
  side: z.enum(["buy", "sell"]),
  amount: z
    .string()
    .regex(/^\d+$/)
    .describe(
      "For buy: quote-token amount to spend (raw). For sell: base-token amount to sell (raw).",
    ),
  min_out: z.string().regex(/^\d+$/).default("0").describe("Minimum tokens out (raw)."),
  fok: z.boolean().default(false).describe("Fill-or-kill — reverts if not fully filled."),
  value_wei: z
    .string()
    .regex(/^\d+$/)
    .default("0")
    .describe("Native value sent with the call (only when the market's quote/base is native MON)."),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const kuruMarketSwapTool: ToolDefinition<typeof marketSwapShape> = {
  name: "kuru_market_swap",
  title: "Execute a market buy/sell on a Kuru market",
  description:
    "Sweeps the resting book at market with a buy or sell. `amount` is raw quote (for buy) or " +
    "raw base (for sell). Set `value_wei` when the market involves native MON.",
  kind: "write",
  inputSchema: marketSwapShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const addresses = kuruAddressesFor(ctx.network);
    const market = resolveKuruMarket(args.market, addresses);
    if (!market) {
      return {
        text: `Unknown Kuru market: ${args.market}`,
        structured: { error: "unknown_market" },
      };
    }
    const fn = args.side === "buy" ? "placeAndExecuteMarketBuy" : "placeAndExecuteMarketSell";
    const data = encodeFunctionData({
      abi: kuruOrderBookAbi,
      functionName: fn,
      args: [BigInt(args.amount), BigInt(args.min_out), false, args.fok],
    });
    const call = { to: market, value: args.value_wei, data };
    const summary = `Kuru market ${args.side}: amount ${args.amount} on ${args.market} (minOut ${args.min_out}${args.fok ? ", FOK" : ""})`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "kuru", action: "market_swap", market, side: args.side },
      ttlMs: args.ttl_seconds * 1000,
    });
    return {
      text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}`,
      structured: {
        request_id: stored.id,
        approval_url: `${approvalUrlFor(ctx.server, stored)}`,
        plugin: "kuru",
        market,
      },
    };
  },
};
