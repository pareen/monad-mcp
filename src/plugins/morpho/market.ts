import { encodeAbiParameters, keccak256 } from "viem";

/**
 * Morpho Blue MarketParams — the immutable struct that uniquely identifies a
 * market. `id = keccak256(abi.encode(MarketParams))`.
 */
export interface MarketParams {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}

const MARKET_PARAMS_TYPE = {
  components: [
    { name: "loanToken", type: "address" },
    { name: "collateralToken", type: "address" },
    { name: "oracle", type: "address" },
    { name: "irm", type: "address" },
    { name: "lltv", type: "uint256" },
  ],
  type: "tuple",
} as const;

export function marketId(params: MarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [MARKET_PARAMS_TYPE],
      [
        {
          loanToken: params.loanToken,
          collateralToken: params.collateralToken,
          oracle: params.oracle,
          irm: params.irm,
          lltv: params.lltv,
        },
      ],
    ),
  );
}

export type MarketParamsInput = MarketParams;
