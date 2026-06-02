/**
 * DexScreener API client — used for token pricing + search on Monad.
 * Public, no auth. Documented at https://docs.dexscreener.com/api/reference.
 *
 * Chain identifier on DexScreener is "monad".
 */

const BASE_URL = "https://api.dexscreener.com/latest/dex";

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

interface PairsResponse {
  pairs: DexScreenerPair[] | null;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "monad-mcp/0.1" },
    signal,
  });
  if (!res.ok) {
    throw new Error(`DexScreener ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as T;
}

/** Fetch all pairs for a token address (any chain). Filter to Monad client-side. */
export async function getTokenPairs(
  tokenAddress: string,
  opts: { signal?: AbortSignal; chain?: string } = {},
): Promise<DexScreenerPair[]> {
  const data = await fetchJson<PairsResponse>(`${BASE_URL}/tokens/${tokenAddress}`, opts.signal);
  const pairs = data.pairs ?? [];
  const chain = opts.chain ?? "monad";
  return pairs.filter((p) => p.chainId === chain);
}

/** Best price = pair with highest USD liquidity on Monad. */
export function pickBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
  if (pairs.length === 0) return null;
  return [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;
}

/** Search across chains; filter to Monad. */
export async function searchPairs(
  query: string,
  opts: { signal?: AbortSignal; chain?: string } = {},
): Promise<DexScreenerPair[]> {
  const data = await fetchJson<PairsResponse>(
    `${BASE_URL}/search?q=${encodeURIComponent(query)}`,
    opts.signal,
  );
  const pairs = data.pairs ?? [];
  const chain = opts.chain ?? "monad";
  return pairs.filter((p) => p.chainId === chain);
}
