import type { LocalWallet } from "./auth/local-wallet.js";
import type { PrivyAuthBridge } from "./auth/privy.js";
import type { NetworkName } from "./chains/monad.js";
import type { Config } from "./config.js";
import type { GrantStore } from "./grants/types.js";
import type { Logger } from "./logger.js";
import type { Notifier } from "./notifications/types.js";
import type { RequestStore } from "./store/types.js";
import type { ClientRegistry } from "./viem/clients.js";

/**
 * Server-scoped context: shared across all tool calls.
 */
export interface ServerContext {
  config: Config;
  clients: ClientRegistry;
  store: RequestStore;
  grants: GrantStore;
  auth: PrivyAuthBridge | null;
  localWallet: LocalWallet | null;
  logger: Logger;
  notifier: Notifier;
}

/**
 * Per-request context: includes the calling user's identity (if authenticated)
 * and the network they're targeting (resolved from tool args or defaults).
 */
export interface ToolContext {
  server: ServerContext;
  network: NetworkName;
  userId: string | null;
  walletAddress: `0x${string}` | null;
}
