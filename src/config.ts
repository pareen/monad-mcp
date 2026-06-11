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
  localPrivateKey: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "local private key must be 0x + 64 hex chars")
    .optional(),
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
    localPrivateKey: env.MONAD_MCP_LOCAL_PRIVATE_KEY || undefined,
    requireAuth: envFlag(env.MONAD_MCP_REQUIRE_AUTH),
  });
}

export function privyEnabled(config: Config): boolean {
  return Boolean(config.privyAppId && config.privyAppSecret);
}
