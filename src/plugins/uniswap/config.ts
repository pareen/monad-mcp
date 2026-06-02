import type { NetworkName } from "../../chains/monad.js";

/**
 * Uniswap v3 contract addresses on Monad.
 *
 * IMPORTANT: Verify these against the Uniswap docs / on-chain bytecode before
 * using in production. They can be overridden via environment variables:
 *   - UNISWAP_MAINNET_QUOTER_V2
 *   - UNISWAP_MAINNET_SWAP_ROUTER_02
 *   - UNISWAP_TESTNET_QUOTER_V2
 *   - UNISWAP_TESTNET_SWAP_ROUTER_02
 *
 * Left as `null` by default to fail loud rather than route swaps to the wrong
 * address. See README "Uniswap plugin setup".
 */
export interface UniswapAddresses {
  quoterV2: `0x${string}` | null;
  swapRouter02: `0x${string}` | null;
  wmon: `0x${string}` | null;
}

const ENV_KEYS: Record<NetworkName, { quoter: string; router: string; wmon: string }> = {
  mainnet: {
    quoter: "UNISWAP_MAINNET_QUOTER_V2",
    router: "UNISWAP_MAINNET_SWAP_ROUTER_02",
    wmon: "MONAD_MAINNET_WMON",
  },
  testnet: {
    quoter: "UNISWAP_TESTNET_QUOTER_V2",
    router: "UNISWAP_TESTNET_SWAP_ROUTER_02",
    wmon: "MONAD_TESTNET_WMON",
  },
};

export function uniswapAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): UniswapAddresses {
  const keys = ENV_KEYS[network];
  return {
    quoterV2: (env[keys.quoter] as `0x${string}` | undefined) ?? null,
    swapRouter02: (env[keys.router] as `0x${string}` | undefined) ?? null,
    wmon: (env[keys.wmon] as `0x${string}` | undefined) ?? null,
  };
}

/** Common Uniswap v3 fee tiers (in basis points * 100, i.e. 3000 = 0.30%). */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];
