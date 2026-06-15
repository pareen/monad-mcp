import { z } from "zod";

const ConfigSchema = z.object({
  monadMainnetRpc: z.string().url().default("https://rpc.monad.xyz"),
  monadTestnetRpc: z.string().url().default("https://testnet-rpc.monad.xyz"),
  defaultNetwork: z.enum(["mainnet", "testnet"]).default("testnet"),
  privyAppId: z.string().optional(),
  privyAppSecret: z.string().optional(),
  publicBaseUrl: z.string().url().default("http://localhost:8787"),
  port: z.coerce.number().int().positive().default(8787),
  allowedRedirectUris: z.array(z.string()).default([]),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  notificationWebhookUrl: z.string().url().optional(),
  storeBackend: z.enum(["memory", "postgres"]).default("memory"),
  databaseUrl: z.string().optional(),
  approvalSecret: z.string().min(32, "approval secret must be ≥32 chars").optional(),
  e2eBearerToken: z.string().min(32).optional(),
  e2eUserId: z.string().optional(),
  e2eAllowedRecipient: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x000000000000000000000000000000000000dEaD"),
  e2eMaxTransferWei: z.string().regex(/^\d+$/).default("1000000000000"),
  // When Privy is configured, /mcp gates WRITE tools behind a bearer token but
  // leaves READ tools public by default. Set MONAD_MCP_REQUIRE_AUTH=true to
  // require a token for every call (the stricter pre-split behavior).
  requireAuth: z.boolean().default(false),
});

/** Parse a boolean env var: true only for "1"/"true"/"yes"/"on" (case-insensitive). */
function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowed = env.ALLOWED_REDIRECT_URIS
    ? env.ALLOWED_REDIRECT_URIS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return ConfigSchema.parse({
    monadMainnetRpc: env.MONAD_MAINNET_RPC,
    monadTestnetRpc: env.MONAD_TESTNET_RPC,
    defaultNetwork: env.MONAD_DEFAULT_NETWORK,
    privyAppId: env.PRIVY_APP_ID || undefined,
    privyAppSecret: env.PRIVY_APP_SECRET || undefined,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    port: env.PORT,
    allowedRedirectUris: allowed,
    logLevel: env.LOG_LEVEL,
    notificationWebhookUrl: env.NOTIFICATION_WEBHOOK_URL || undefined,
    storeBackend: env.STORE_BACKEND,
    databaseUrl: env.DATABASE_URL || undefined,
    approvalSecret: env.MONAD_MCP_APPROVAL_SECRET || undefined,
    e2eBearerToken: env.MONAD_MCP_E2E_BEARER_TOKEN || undefined,
    e2eUserId: env.MONAD_MCP_E2E_USER_ID || undefined,
    e2eAllowedRecipient: env.MONAD_MCP_E2E_ALLOWED_RECIPIENT,
    e2eMaxTransferWei: env.MONAD_MCP_E2E_MAX_TRANSFER_WEI,
    requireAuth: envFlag(env.MONAD_MCP_REQUIRE_AUTH),
  });
}

export function privyEnabled(config: Config): boolean {
  return Boolean(config.privyAppId && config.privyAppSecret);
}
