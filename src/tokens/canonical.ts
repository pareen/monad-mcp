import type { NetworkName } from "../chains/monad.js";

/**
 * Canonical token registry — the ones agents reach for by name and never
 * change address. For everything else, use the DexScreener-backed resolver in
 * src/tokens/resolver.ts.
 *
 * Addresses verified against monad-crypto/protocols metadata + project docs.
 * `mon` is the native asset (no contract); listed for symmetry.
 */
export interface TokenInfo {
  symbol: string;
  name: string;
  address: `0x${string}` | "native";
  decimals: number;
  /** Comma-tagged hints used by `resolve_token` for fuzzy matching. */
  aliases?: string[];
}

const MAINNET: Record<string, TokenInfo> = {
  MON: { symbol: "MON", name: "Monad", address: "native", decimals: 18 },
  WMON: {
    symbol: "WMON",
    name: "Wrapped Monad",
    address: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701",
    decimals: 18,
    aliases: ["wrapped mon", "wmon"],
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea",
    decimals: 6,
    aliases: ["usd coin"],
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    address: "0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D",
    decimals: 6,
    aliases: ["tether"],
  },
  AUSD: {
    symbol: "AUSD",
    name: "Agora USD",
    address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    decimals: 6,
    aliases: ["agora usd"],
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37",
    decimals: 18,
    aliases: ["wrapped ether", "weth"],
  },
  sMON: {
    symbol: "sMON",
    name: "Staked Monad (Kintsu)",
    address: "0xA3227C5969757783154C60bF0bC1944180ed81B9",
    decimals: 18,
    aliases: ["staked mon", "smon", "kintsu"],
  },
  shMON: {
    symbol: "shMON",
    name: "FastLane Staked Monad (shMONAD)",
    address: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
    decimals: 18,
    aliases: ["fastlane mon", "shmon", "shmonad", "staked mon fastlane"],
  },
};

const TESTNET: Record<string, TokenInfo> = {
  MON: { symbol: "MON", name: "Monad", address: "native", decimals: 18 },
  // Add testnet tokens here as their addresses stabilize.
};

export function canonicalTokensFor(network: NetworkName): Record<string, TokenInfo> {
  return network === "mainnet" ? MAINNET : TESTNET;
}

export function findCanonicalToken(query: string, network: NetworkName): TokenInfo | null {
  const tokens = canonicalTokensFor(network);
  // Exact symbol match (case-insensitive)
  const upper = query.toUpperCase();
  for (const [sym, info] of Object.entries(tokens)) {
    if (sym.toUpperCase() === upper) return info;
  }
  // Alias / name substring
  const lower = query.toLowerCase();
  for (const info of Object.values(tokens)) {
    if (info.name.toLowerCase().includes(lower)) return info;
    if (info.aliases?.some((a) => a.toLowerCase().includes(lower))) return info;
  }
  // Raw address pass-through
  if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
    return { symbol: "?", name: "?", address: query as `0x${string}`, decimals: 18 };
  }
  return null;
}
