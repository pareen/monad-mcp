import { defineChain } from "viem";

export const MONAD_MAINNET_ID = 143;
export const MONAD_TESTNET_ID = 10143;

const DEFAULT_MAINNET_RPC = "https://rpc.monad.xyz";
const DEFAULT_TESTNET_RPC = "https://testnet-rpc.monad.xyz";

export const monadMainnet = defineChain({
  id: MONAD_MAINNET_ID,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_MAINNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://monadexplorer.com" },
  },
  testnet: false,
});

export const monadTestnet = defineChain({
  id: MONAD_TESTNET_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_TESTNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Monad Testnet Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export type NetworkName = "mainnet" | "testnet";

export function chainFor(network: NetworkName) {
  return network === "mainnet" ? monadMainnet : monadTestnet;
}

export function isMonadChainId(
  id: number,
): id is typeof MONAD_MAINNET_ID | typeof MONAD_TESTNET_ID {
  return id === MONAD_MAINNET_ID || id === MONAD_TESTNET_ID;
}

export function networkForChainId(id: number): NetworkName {
  if (id === MONAD_MAINNET_ID) return "mainnet";
  if (id === MONAD_TESTNET_ID) return "testnet";
  throw new Error(`Unsupported chain id: ${id}`);
}
