import type { NetworkName } from "../../chains/monad.js";

const DEFAULT_MAINNET_VAULT = "0x0c65A0BC65a5D819235B71F554D210D3F80E0852" as `0x${string}`;

export interface AprioriAddresses {
  vault: `0x${string}` | null;
}

export function aprioriAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): AprioriAddresses {
  if (network === "mainnet") {
    return {
      vault: (env.APRIORI_MAINNET_VAULT as `0x${string}` | undefined) ?? DEFAULT_MAINNET_VAULT,
    };
  }
  return {
    vault: (env.APRIORI_TESTNET_VAULT as `0x${string}` | undefined) ?? null,
  };
}
