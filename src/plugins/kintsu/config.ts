import type { NetworkName } from "../../chains/monad.js";

const DEFAULT_MAINNET_VAULT = "0xA3227C5969757783154C60bF0bC1944180ed81B9" as `0x${string}`;

export interface KintsuAddresses {
  vault: `0x${string}` | null;
}

export function kintsuAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): KintsuAddresses {
  if (network === "mainnet") {
    return {
      vault: (env.KINTSU_MAINNET_VAULT as `0x${string}` | undefined) ?? DEFAULT_MAINNET_VAULT,
    };
  }
  return {
    vault: (env.KINTSU_TESTNET_VAULT as `0x${string}` | undefined) ?? null,
  };
}
