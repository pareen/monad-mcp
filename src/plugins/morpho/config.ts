import type { NetworkName } from "../../chains/monad.js";

const DEFAULT_MAINNET = {
  blue: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee" as `0x${string}`,
  adaptiveCurveIrm: "0x09475a3D6eA8c314c592b1a3799bDE044E2F400F" as `0x${string}`,
  metaMorphoFactory: "0x33f20973275B2F574488b18929cd7DCBf1AbF275" as `0x${string}`,
};

export interface MorphoAddresses {
  blue: `0x${string}` | null;
  adaptiveCurveIrm: `0x${string}` | null;
  metaMorphoFactory: `0x${string}` | null;
}

export function morphoAddressesFor(
  network: NetworkName,
  env: NodeJS.ProcessEnv = process.env,
): MorphoAddresses {
  if (network === "mainnet") {
    return {
      blue: (env.MORPHO_MAINNET_BLUE as `0x${string}` | undefined) ?? DEFAULT_MAINNET.blue,
      adaptiveCurveIrm:
        (env.MORPHO_MAINNET_ADAPTIVE_IRM as `0x${string}` | undefined) ??
        DEFAULT_MAINNET.adaptiveCurveIrm,
      metaMorphoFactory:
        (env.MORPHO_MAINNET_METAMORPHO_FACTORY as `0x${string}` | undefined) ??
        DEFAULT_MAINNET.metaMorphoFactory,
    };
  }
  return {
    blue: (env.MORPHO_TESTNET_BLUE as `0x${string}` | undefined) ?? null,
    adaptiveCurveIrm: (env.MORPHO_TESTNET_ADAPTIVE_IRM as `0x${string}` | undefined) ?? null,
    metaMorphoFactory: (env.MORPHO_TESTNET_METAMORPHO_FACTORY as `0x${string}` | undefined) ?? null,
  };
}

/**
 * Active markets churn weekly; for reliability we recommend fetching from
 * Morpho's GraphQL API (https://api.morpho.org/graphql, chainId 143) at startup
 * rather than hardcoding here. This config slot exists for tests + dev where
 * a stable known market is more convenient.
 */
export const MORPHO_GRAPHQL_URL = "https://api.morpho.org/graphql";
