import { z } from "zod";
import { canonicalTokensFor, findCanonicalToken } from "../tokens/canonical.js";
import { getTokenPairs, pickBestPair, searchPairs } from "../tokens/dexscreener.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

// ───────── resolve_token ─────────
const resolveShape = {
  query: z.string().min(1).describe("Symbol, name, alias, or 0x address."),
  network: optionalNetwork,
};

export const resolveTokenTool: ToolDefinition<typeof resolveShape> = {
  name: "resolve_token",
  title: "Resolve a token symbol/name to its Monad address",
  description:
    "Looks up a canonical Monad token by symbol (e.g. 'USDC'), name ('Tether'), or returns " +
    "an 0x address unchanged. Falls back to DexScreener search for non-canonical tokens.",
  kind: "read",
  inputSchema: resolveShape,
  handler: async (args, ctx) => {
    const canonical = findCanonicalToken(args.query, ctx.network);
    if (canonical && canonical.address !== "native") {
      return {
        text:
          `${canonical.symbol} (${canonical.name}) on Monad ${ctx.network}:\n` +
          `${canonical.address}  decimals=${canonical.decimals}`,
        structured: {
          source: "canonical",
          symbol: canonical.symbol,
          name: canonical.name,
          address: canonical.address,
          decimals: canonical.decimals,
          network: ctx.network,
          explorer_url: addressExplorerUrl(ctx.network, canonical.address),
        },
      };
    }
    if (canonical?.address === "native") {
      return {
        text: `${canonical.symbol} is the native asset on Monad — no contract address.`,
        structured: {
          source: "canonical",
          symbol: canonical.symbol,
          name: canonical.name,
          address: "native",
          decimals: canonical.decimals,
        },
      };
    }

    // Fall back to DexScreener search on mainnet (Monad coverage there).
    if (ctx.network !== "mainnet") {
      return {
        text: `No canonical token matches '${args.query}' on Monad ${ctx.network}.`,
        structured: { source: "miss", query: args.query, network: ctx.network },
      };
    }

    const hits = await searchPairs(args.query);
    if (hits.length === 0) {
      return {
        text: `No DexScreener pairs match '${args.query}' on Monad mainnet.`,
        structured: { source: "miss", query: args.query },
      };
    }
    const top = hits.slice(0, 5).map((p) => ({
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      address: p.baseToken.address,
      pair: p.pairAddress,
      dex: p.dexId,
      liquidity_usd: p.liquidity?.usd,
    }));
    return {
      text: `DexScreener matches (top ${top.length}):\n${top
        .map((t) => `  ${t.symbol}  ${t.address}  ${t.dex}  liq=$${t.liquidity_usd ?? 0}`)
        .join("\n")}`,
      structured: { source: "dexscreener", matches: top },
    };
  },
};

// ───────── get_token_price ─────────
const priceShape = {
  token: addressSchema.describe("ERC-20 token address (or use resolve_token to look it up)."),
  network: optionalNetwork,
};

export const getTokenPriceTool: ToolDefinition<typeof priceShape> = {
  name: "get_token_price",
  title: "Get token USD price (DexScreener)",
  description:
    "Returns the current USD price for a token on Monad, sourced from the deepest-liquidity pair " +
    "found on DexScreener. Mainnet only — testnet has no price feed.",
  kind: "read",
  inputSchema: priceShape,
  handler: async (args, ctx) => {
    if (ctx.network !== "mainnet") {
      return {
        text: "Token pricing is only available on mainnet — DexScreener does not index testnet.",
        structured: { error: "testnet_unsupported", network: ctx.network },
      };
    }
    const pairs = await getTokenPairs(args.token);
    const best = pickBestPair(pairs);
    if (!best) {
      return {
        text: `No DexScreener pairs found for ${args.token} on Monad mainnet.`,
        structured: { error: "no_pairs", token: args.token },
      };
    }
    return {
      text:
        `${best.baseToken.symbol} (${args.token}):\n` +
        `  price: $${best.priceUsd ?? "?"} (vs ${best.quoteToken.symbol})\n` +
        `  liquidity: $${best.liquidity?.usd ?? 0}  24h vol: $${best.volume?.h24 ?? 0}\n` +
        `  via ${best.dexId} (pair ${best.pairAddress})`,
      structured: {
        token: args.token,
        symbol: best.baseToken.symbol,
        name: best.baseToken.name,
        price_usd: best.priceUsd,
        price_native: best.priceNative,
        liquidity_usd: best.liquidity?.usd,
        volume_24h_usd: best.volume?.h24,
        fdv: best.fdv,
        market_cap: best.marketCap,
        dex: best.dexId,
        pair_address: best.pairAddress,
        quote_symbol: best.quoteToken.symbol,
      },
    };
  },
};

// ───────── list_canonical_tokens ─────────
const listShape = { network: optionalNetwork };

export const listCanonicalTokensTool: ToolDefinition<typeof listShape> = {
  name: "list_canonical_tokens",
  title: "List canonical Monad tokens",
  description:
    "Returns the well-known tokens on Monad (MON, WMON, USDC, USDT, AUSD, WETH, sMON, aprMON). " +
    "For dynamic discovery (new tokens, memes), use `resolve_token` with a name/symbol query.",
  kind: "read",
  inputSchema: listShape,
  handler: async (_args, ctx) => {
    const tokens = canonicalTokensFor(ctx.network);
    const rows = Object.values(tokens);
    return {
      text: `Canonical tokens on Monad ${ctx.network}:\n${rows
        .map((t) => `  ${t.symbol.padEnd(8)} ${t.address}  (${t.decimals} dec, ${t.name})`)
        .join("\n")}`,
      structured: {
        network: ctx.network,
        tokens: rows,
      },
    };
  },
};
