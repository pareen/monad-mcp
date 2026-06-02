import { type PublicClient, formatUnits } from "viem";
import { type TokenInfo, canonicalTokensFor } from "../tokens/canonical.js";
import { getTokenPairs, pickBestPair } from "../tokens/dexscreener.js";
import { erc20Abi } from "./abi.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

interface Holding {
  symbol: string;
  name: string;
  address: `0x${string}` | "native";
  decimals: number;
  balance_raw: string;
  balance_formatted: string;
  price_usd: number | null;
  value_usd: number | null;
}

async function readBalance(
  client: PublicClient,
  token: TokenInfo,
  holder: `0x${string}`,
): Promise<bigint> {
  if (token.address === "native") {
    return client.getBalance({ address: holder });
  }
  const balance = (await client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  })) as bigint;
  return balance;
}

async function readPriceUsd(
  token: TokenInfo,
  network: "mainnet" | "testnet",
): Promise<number | null> {
  if (network !== "mainnet") return null;
  // Native MON is priced via WMON pairs on DexScreener.
  const queryAddr =
    token.address === "native" ? canonicalTokensFor("mainnet").WMON?.address : token.address;
  if (!queryAddr || queryAddr === "native") return null;
  try {
    const pairs = await getTokenPairs(queryAddr);
    const best = pickBestPair(pairs);
    if (!best?.priceUsd) return null;
    return Number(best.priceUsd);
  } catch {
    return null;
  }
}

const shape = {
  address: addressSchema
    .optional()
    .describe("Holder address. Defaults to the authenticated user's wallet."),
  include_zero: z
    .boolean()
    .default(false)
    .describe("Include canonical tokens with zero balance in the response."),
  network: optionalNetwork,
};

import { z } from "zod";

export const getPortfolioTool: ToolDefinition<typeof shape> = {
  name: "get_portfolio",
  title: "Get portfolio (balances + USD values)",
  description:
    "Returns native MON + canonical-token balances for an address, priced in USD via DexScreener. " +
    "Skips tokens with zero balance unless `include_zero` is set. USD totals are best-effort — " +
    "tokens without a Monad pair on DexScreener are reported with null prices.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return {
        text: "No address provided and no authenticated wallet.",
        structured: { error: "no_address" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const tokens = Object.values(canonicalTokensFor(ctx.network));

    // Read balances in parallel; prices serially-but-parallel (DexScreener
    // doesn't love bursts but a handful is fine).
    const balances = await Promise.all(tokens.map((t) => readBalance(client, t, target)));
    const prices = await Promise.all(tokens.map((t) => readPriceUsd(t, ctx.network)));

    const holdings: Holding[] = tokens
      .map((t, i): Holding => {
        const raw = balances[i] ?? 0n;
        const fmt = formatUnits(raw, t.decimals);
        const price = prices[i] ?? null;
        const value = price !== null ? Number(fmt) * price : null;
        return {
          symbol: t.symbol,
          name: t.name,
          address: t.address,
          decimals: t.decimals,
          balance_raw: raw.toString(),
          balance_formatted: fmt,
          price_usd: price,
          value_usd: value,
        };
      })
      .filter((h) => args.include_zero || h.balance_raw !== "0");

    const total = holdings.reduce((acc, h) => acc + (h.value_usd ?? 0), 0);

    const lines = [
      `Portfolio for ${target} on Monad ${ctx.network}:`,
      ...holdings.map(
        (h) =>
          `  ${h.symbol.padEnd(8)} ${h.balance_formatted.padStart(20)}  ` +
          `${h.price_usd !== null ? `$${h.price_usd.toFixed(4)}/tok` : "?".padStart(12)}  ` +
          `${h.value_usd !== null ? `$${h.value_usd.toFixed(2)}` : "?"}`,
      ),
      "  ──",
      `  TOTAL${" ".repeat(40)} $${total.toFixed(2)}`,
      `Explorer: ${addressExplorerUrl(ctx.network, target)}`,
    ];

    return {
      text: lines.join("\n"),
      structured: {
        address: target,
        network: ctx.network,
        total_value_usd: total,
        holdings,
        explorer_url: addressExplorerUrl(ctx.network, target),
      },
    };
  },
};
