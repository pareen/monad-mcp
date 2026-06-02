import type { NetworkName } from "../../chains/monad.js";

// shMONAD vault (also the shMON ERC-4626 share token). Verified mainnet address
// from monad-crypto/protocols/mainnet/fastlane.jsonc.
const DEFAULT_MAINNET_VAULT = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c" as `0x${string}`;

export interface FastlaneAddresses {
  vault: `0x${string}` | null;
}

export function fastlaneAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): FastlaneAddresses {
  if (network === "mainnet") {
    return {
      vault: (env.FASTLANE_MAINNET_VAULT as `0x${string}` | undefined) ?? DEFAULT_MAINNET_VAULT,
    };
  }
  return {
    vault: (env.FASTLANE_TESTNET_VAULT as `0x${string}` | undefined) ?? null,
  };
}
