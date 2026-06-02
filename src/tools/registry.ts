import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape, z } from "zod";
import { readAuthExtra } from "../auth/verifier.js";
import { type NetworkName, chainFor } from "../chains/monad.js";
import type { ServerContext, ToolContext } from "../context.js";
import { AuthRequiredError, WalletNotFoundError, isMonadMcpError } from "../errors.js";

export type ToolKind = "read" | "write";

export interface ToolDefinition<Shape extends ZodRawShape> {
  name: string;
  title?: string;
  description: string;
  kind: ToolKind;
  inputSchema: Shape;
  resolveNetwork?: (args: z.infer<z.ZodObject<Shape>>) => NetworkName | undefined;
  handler: (
    args: z.infer<z.ZodObject<Shape>>,
    ctx: ToolContext,
  ) => Promise<ToolResult> | ToolResult;
}

export interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
}

/** Wire format the MCP SDK expects from a tool callback. */
export interface ToolCallbackResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function formatErrorResult(err: unknown): ToolCallbackResult {
  if (isMonadMcpError(err)) {
    return {
      content: [{ type: "text", text: `${err.code}: ${err.message}` }],
      structuredContent: { error: { code: err.code, message: err.message, details: err.details } },
      isError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `error: ${msg}` }],
    structuredContent: { error: { code: "internal", message: msg } },
    isError: true,
  };
}

/**
 * Executes a tool definition with the same gating + error handling as the
 * production MCP wrapper, but as a plain function. Exists so we can unit-test
 * tool behavior without spinning up an MCP transport.
 */
export async function runTool<Shape extends ZodRawShape>(
  def: ToolDefinition<Shape>,
  rawArgs: unknown,
  server: ServerContext,
  authInfo?: AuthInfo,
): Promise<ToolCallbackResult> {
  try {
    // Validate input through the zod schema so unknown args are rejected.
    const { z } = await import("zod");
    const parsed = z.object(def.inputSchema).parse(rawArgs ?? {}) as z.infer<z.ZodObject<Shape>>;

    const network =
      def.resolveNetwork?.(parsed) ??
      (parsed as { network?: NetworkName }).network ??
      server.config.defaultNetwork;

    const auth = readAuthExtra(authInfo);
    if (def.kind === "write" && !auth) {
      throw new AuthRequiredError(
        "This tool requires a connected Monad wallet — sign in via Privy and retry.",
      );
    }
    if (def.kind === "write" && auth && !auth.walletAddress) {
      throw new WalletNotFoundError();
    }

    const ctx: ToolContext = {
      server,
      network: network as NetworkName,
      userId: auth?.userId ?? null,
      walletAddress: auth?.walletAddress ?? null,
    };

    const result = await def.handler(parsed, ctx);

    return {
      content: [{ type: "text", text: result.text }],
      ...(result.structured ? { structuredContent: result.structured } : {}),
    };
  } catch (err) {
    server.logger.error("tool failed", {
      tool: def.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return formatErrorResult(err);
  }
}

export function registerTool<Shape extends ZodRawShape>(
  mcp: McpServer,
  server: ServerContext,
  def: ToolDefinition<Shape>,
): void {
  // The SDK's overload resolution can't widen our generic `Shape` to its own
  // ZodRawShapeCompat constraint, so cast just at this boundary. Runtime
  // validation still uses our zod schema.
  // biome-ignore lint/suspicious/noExplicitAny: SDK generic boundary
  (mcp as any).registerTool(
    def.name,
    {
      title: def.title ?? def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: { readOnlyHint: def.kind === "read" },
    },
    async (args: unknown, extra: { authInfo?: AuthInfo }) =>
      runTool(def, args, server, extra.authInfo),
  );
}

export function txExplorerUrl(network: NetworkName, txHash: string): string {
  const chain = chainFor(network);
  return `${chain.blockExplorers.default.url}/tx/${txHash}`;
}

export function addressExplorerUrl(network: NetworkName, address: string): string {
  const chain = chainFor(network);
  return `${chain.blockExplorers.default.url}/address/${address}`;
}
