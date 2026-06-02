import { z } from "zod";
import { canonicalTokensFor } from "../tokens/canonical.js";
import { getTokenPairs, pickBestPair } from "../tokens/dexscreener.js";
import { erc20Abi } from "./abi.js";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

interface Risk {
  code: string;
  severity: "info" | "warn" | "danger";
  message: string;
}

const shape = {
  token: addressSchema,
  network: optionalNetwork,
};

/**
 * Heuristic safety check for an unknown token: contract bytecode presence,
 * canonical-list membership, DexScreener liquidity + pair age. Not a
 * substitute for a real audit — surfaces "yellow flags" you'd want to know
 * before approving an ERC-20 swap.
 */
export const checkTokenTool: ToolDefinition<typeof shape> = {
  name: "check_token",
  title: "Risk check for an ERC-20 token",
  description:
    "Runs heuristic risk checks on a token address: is it a known canonical token, is it actually " +
    "a contract, does it have DexScreener liquidity, how old is the deepest pair. Returns a list " +
    "of flags from `info` → `danger`. Mainnet recommended (DexScreener doesn't index testnet).",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const client = ctx.server.clients.publicClient(ctx.network);
    const risks: Risk[] = [];

    // 1. Canonical list membership
    const canonical = canonicalTokensFor(ctx.network);
    const knownEntry = Object.values(canonical).find(
      (t) => t.address !== "native" && t.address.toLowerCase() === args.token.toLowerCase(),
    );
    if (knownEntry) {
      risks.push({
        code: "canonical_token",
        severity: "info",
        message: `Canonical token: ${knownEntry.symbol} (${knownEntry.name}).`,
      });
    }

    // 2. Contract bytecode present
    const code = await client.getCode({ address: args.token });
    if (!code || code === "0x") {
      risks.push({
        code: "no_bytecode",
        severity: "danger",
        message: "Address has no contract bytecode (EOA or self-destructed).",
      });
    }

    // 3. ERC-20 metadata reads (best-effort)
    let symbol = "?";
    let decimals: number | null = null;
    let totalSupply: bigint | null = null;
    try {
      symbol = (await client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "symbol",
      })) as string;
    } catch {
      risks.push({
        code: "no_symbol",
        severity: "warn",
        message: "symbol() reverted — may not be a standard ERC-20.",
      });
    }
    try {
      decimals = (await client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "decimals",
      })) as number;
    } catch {
      risks.push({
        code: "no_decimals",
        severity: "warn",
        message: "decimals() reverted — may not be a standard ERC-20.",
      });
    }
    try {
      totalSupply = (await client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "name",
      })) as never; // name() — we don't actually need supply, but exercising it surfaces broken contracts
    } catch {
      // ignore — non-standard contracts are fine sometimes
    }

    // 4. DexScreener liquidity + pair age
    let pairCount = 0;
    let bestLiquidityUsd: number | null = null;
    let oldestPairAgeDays: number | null = null;
    if (ctx.network === "mainnet") {
      try {
        const pairs = await getTokenPairs(args.token);
        pairCount = pairs.length;
        const best = pickBestPair(pairs);
        if (best?.liquidity?.usd !== undefined) bestLiquidityUsd = best.liquidity.usd;
        const ages = pairs
          .map((p) => (p.pairCreatedAt ? Date.now() - p.pairCreatedAt : null))
          .filter((n): n is number => n !== null);
        if (ages.length > 0) {
          oldestPairAgeDays = Math.floor(Math.max(...ages) / 86_400_000);
        }
      } catch {
        risks.push({
          code: "dexscreener_unreachable",
          severity: "info",
          message: "DexScreener API call failed — liquidity check skipped.",
        });
      }

      if (pairCount === 0 && !knownEntry) {
        risks.push({
          code: "no_dex_pairs",
          severity: "danger",
          message: "No DexScreener pairs on Monad — token is illiquid or fake.",
        });
      }
      if (bestLiquidityUsd !== null && bestLiquidityUsd < 10_000) {
        risks.push({
          code: "low_liquidity",
          severity: "warn",
          message: `Best pair has only $${bestLiquidityUsd.toFixed(0)} liquidity — high slippage risk.`,
        });
      }
      if (oldestPairAgeDays !== null && oldestPairAgeDays < 7) {
        risks.push({
          code: "new_pair",
          severity: "warn",
          message: `Newest token — oldest DEX pair is only ${oldestPairAgeDays}d old.`,
        });
      }
    }

    const severities = risks.map((r) => r.severity);
    const overall: "ok" | "warn" | "danger" = severities.includes("danger")
      ? "danger"
      : severities.includes("warn")
        ? "warn"
        : "ok";

    return {
      text: `Token ${args.token} on Monad ${ctx.network} — overall ${overall}\n  symbol: ${symbol}  decimals: ${decimals ?? "?"}  pairs: ${pairCount}${bestLiquidityUsd !== null ? `  best liquidity: $${bestLiquidityUsd.toFixed(0)}` : ""}${oldestPairAgeDays !== null ? `  oldest pair: ${oldestPairAgeDays}d` : ""}\n${
        risks.length
          ? risks.map((r) => `  [${r.severity.toUpperCase()}] ${r.message}`).join("\n")
          : "  (no flags)"
      }\nExplorer: ${addressExplorerUrl(ctx.network, args.token)}`,
      structured: {
        token: args.token,
        network: ctx.network,
        overall,
        symbol,
        decimals,
        is_canonical: Boolean(knownEntry),
        canonical_symbol: knownEntry?.symbol ?? null,
        dex_pair_count: pairCount,
        best_liquidity_usd: bestLiquidityUsd,
        oldest_pair_age_days: oldestPairAgeDays,
        risks,
        explorer_url: addressExplorerUrl(ctx.network, args.token),
      },
    };
  },
};

// Mark unused import as used.
void z;
