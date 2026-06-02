import type { PublicClient } from "viem";
import { vi } from "vitest";
import type { PrivyAuthBridge, ResolvedUser } from "../../src/auth/privy.js";
import { type Config, loadConfig } from "../../src/config.js";
import type { ServerContext } from "../../src/context.js";
import { MemoryGrantStore } from "../../src/grants/memory.js";
import { createLogger } from "../../src/logger.js";
import { NoopNotifier } from "../../src/notifications/webhook.js";
import { MemoryRequestStore } from "../../src/store/memory.js";
import type { ClientRegistry } from "../../src/viem/clients.js";

export interface TestContextOptions {
  config?: Partial<Config>;
  publicClient?: Partial<PublicClient>;
  auth?: Partial<PrivyAuthBridge> | null;
}

export function makeTestContext(options: TestContextOptions = {}): ServerContext {
  const baseConfig = loadConfig({});
  const config: Config = { ...baseConfig, ...options.config };

  const stubClient = {
    getBalance: vi.fn(async () => 0n),
    readContract: vi.fn(async () => 0n),
    getBlockNumber: vi.fn(async () => 100n),
    getLogs: vi.fn(async () => []),
    estimateGas: vi.fn(async () => 21_000n),
    simulateContract: vi.fn(async () => ({ result: [0n, 0n, 0, 0n] })),
    getTransactionReceipt: vi.fn(async () => {
      throw new Error("could not be found");
    }),
    ...options.publicClient,
  } as unknown as PublicClient;

  const clients: ClientRegistry = {
    publicClient: () => stubClient,
  };

  const auth =
    options.auth === null ? null : options.auth ? (options.auth as PrivyAuthBridge) : null;

  return {
    config,
    clients,
    store: new MemoryRequestStore(),
    grants: new MemoryGrantStore(),
    auth,
    logger: createLogger("error"),
    notifier: new NoopNotifier(),
  };
}

export function makeResolvedUser(overrides: Partial<ResolvedUser> = {}): ResolvedUser {
  return {
    userId: "did:privy:user1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletId: "wallet_1",
    ...overrides,
  };
}
