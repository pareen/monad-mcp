import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PrivyAuthBridge } from "./auth/privy.js";
import { type Config, loadConfig, privyEnabled } from "./config.js";
import type { ServerContext } from "./context.js";
import { createLogger } from "./logger.js";
import { NoopNotifier, WebhookNotifier } from "./notifications/webhook.js";
import { registerPlugins } from "./plugins/index.js";
import { NotifyingRequestStore } from "./store/notifying.js";
import { selectStores } from "./store/select.js";
import { registerCoreTools } from "./tools/index.js";
import { createClientRegistry } from "./viem/clients.js";

const VERSION = "0.1.0";

export interface BuildServerOptions {
  config?: Config;
}

export interface BuiltServer {
  mcp: McpServer;
  context: ServerContext;
}

export function buildServerContext(config: Config = loadConfig()): ServerContext {
  const logger = createLogger(config.logLevel, { service: "monad-mcp" });

  if (!privyEnabled(config)) {
    logger.warn(
      "Privy is not configured (PRIVY_APP_ID / PRIVY_APP_SECRET unset). " +
        "Write tools will fail until you connect a Privy app.",
    );
  }

  const notifier = config.notificationWebhookUrl
    ? new WebhookNotifier(config.notificationWebhookUrl, logger.child({ component: "notifier" }))
    : new NoopNotifier();

  const { requestStore, grantStore } = selectStores(config, logger);
  const store = new NotifyingRequestStore(requestStore, notifier, config);
  logger.info("stores configured", { backend: config.storeBackend });

  return {
    config,
    clients: createClientRegistry(config),
    store,
    grants: grantStore,
    auth: PrivyAuthBridge.fromConfig(config),
    logger,
    notifier,
  };
}

/**
 * Build a fresh McpServer bound to an existing context. The context (stores,
 * clients, auth) is shared; the McpServer is not. The Streamable-HTTP transport
 * keeps single-session state per instance, so a stateless multi-client server
 * must mint a new McpServer + transport per request (see server-http.ts) rather
 * than reuse one — otherwise every client after the first hits "already
 * initialized". Tool handlers read shared state through `context`.
 */
export function buildMcpServer(context: ServerContext): McpServer {
  const mcp = new McpServer(
    {
      name: "monad-mcp",
      version: VERSION,
    },
    {
      instructions:
        "MCP server for the Monad blockchain. Read tools (balances, history) work without auth. " +
        "Write tools (transfer, swap, stake) require the user to be signed in via Privy and return an " +
        "approval URL the user must open to confirm the transaction. After approval, poll the request " +
        "with `poll_request` to retrieve the resulting tx hash.",
    },
  );

  registerCoreTools(mcp, context);
  registerPlugins(mcp, context);

  return mcp;
}

export function buildServer(options: BuildServerOptions = {}): BuiltServer {
  const config = options.config ?? loadConfig();
  const context = buildServerContext(config);
  const mcp = buildMcpServer(context);
  return { mcp, context };
}

export { type Config, loadConfig } from "./config.js";
export type { ServerContext } from "./context.js";
