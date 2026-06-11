import { http, type Hex, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type NetworkName, monadMainnet, monadTestnet } from "../chains/monad.js";
import type { Config } from "../config.js";
import type { StoredRequest } from "../store/types.js";

export interface LocalWallet {
  userId: string;
  address: `0x${string}`;
  sendTransaction(network: NetworkName, call: StoredRequest["call"]): Promise<`0x${string}`>;
}

export function localWalletUserId(address: `0x${string}`): string {
  return `local:${address.toLowerCase()}`;
}

export class LocalPrivateKeyWallet implements LocalWallet {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly config: Config;

  constructor(privateKey: Hex, config: Config) {
    this.account = privateKeyToAccount(privateKey);
    this.config = config;
  }

  get address(): `0x${string}` {
    return this.account.address;
  }

  get userId(): string {
    return localWalletUserId(this.address);
  }

  async sendTransaction(network: NetworkName, call: StoredRequest["call"]): Promise<`0x${string}`> {
    const rpcUrl =
      network === "mainnet" ? this.config.monadMainnetRpc : this.config.monadTestnetRpc;
    const baseChain = network === "mainnet" ? monadMainnet : monadTestnet;
    const chain = {
      ...baseChain,
      rpcUrls: { default: { http: [rpcUrl] } },
    };
    const wallet = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl, { retryCount: 2, retryDelay: 250 }),
    });
    const hash = await wallet.sendTransaction({
      account: this.account,
      to: call.to,
      value: BigInt(call.value),
      data: call.data,
    });
    return hash as `0x${string}`;
  }
}

export function localWalletFromConfig(config: Config): LocalWallet | null {
  if (!config.localPrivateKey) return null;
  return new LocalPrivateKeyWallet(config.localPrivateKey as Hex, config);
}
