import type { NetworkName } from "../../chains/monad.js";

/**
 * Known Kuru markets on Monad mainnet. Verified addresses from
 * monad-crypto/protocols/mainnet/kuru.jsonc. Add more here as Kuru lists them.
 */
export const KURU_MAINNET_MARKETS = {
  "MON/USDC": "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  "MON/AUSD": "0x131a2e70a5b31a517a74b8c567149bc294470da9",
  "WETH/USDC": "0xa6aFD386135B7D41A6C40C525abC4A1019b0D132",
} as const satisfies Record<string, `0x${string}`>;

export type KuruMarketName = keyof typeof KURU_MAINNET_MARKETS;

export interface KuruAddresses {
  router: `0x${string}` | null;
  markets: Record<string, `0x${string}`>;
}

export function kuruAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): KuruAddresses {
  if (network === "mainnet") {
    return {
      router:
        (env.KURU_MAINNET_ROUTER as `0x${string}` | undefined) ??
        "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
      markets: { ...KURU_MAINNET_MARKETS },
    };
  }
  return { router: null, markets: {} };
}

/** Resolve a market name (e.g. "MON/USDC") or raw address to a market address. */
export function resolveKuruMarket(
  marketIdent: string,
  addresses: KuruAddresses,
): `0x${string}` | null {
  if (/^0x[a-fA-F0-9]{40}$/.test(marketIdent)) return marketIdent as `0x${string}`;
  return addresses.markets[marketIdent] ?? null;
}
