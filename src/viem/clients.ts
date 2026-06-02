import { http, type PublicClient, createPublicClient } from "viem";
import { type NetworkName, monadMainnet, monadTestnet } from "../chains/monad.js";
import type { Config } from "../config.js";

export interface ClientRegistry {
  publicClient: (network: NetworkName) => PublicClient;
}

export function createClientRegistry(config: Config): ClientRegistry {
  const mainnetChain = {
    ...monadMainnet,
    rpcUrls: { default: { http: [config.monadMainnetRpc] } },
  };
  const testnetChain = {
    ...monadTestnet,
    rpcUrls: { default: { http: [config.monadTestnetRpc] } },
  };

  const mainnet = createPublicClient({
    chain: mainnetChain,
    transport: http(config.monadMainnetRpc, { retryCount: 2, retryDelay: 250 }),
  }) as PublicClient;

  const testnet = createPublicClient({
    chain: testnetChain,
    transport: http(config.monadTestnetRpc, { retryCount: 2, retryDelay: 250 }),
  }) as PublicClient;

  return {
    publicClient: (network) => (network === "mainnet" ? mainnet : testnet),
  };
}
