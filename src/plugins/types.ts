import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";

/**
 * A "skill plugin" — a self-contained module that adds tools to the server
 * for a specific protocol or app on Monad (e.g. Uniswap, Kuru, Kintsu).
 *
 * Plugins are kept inside this repo for v1, but the interface is designed so
 * they could be loaded out-of-process later (e.g. as external markdown specs).
 */
export interface SkillPlugin {
  id: string;
  name: string;
  description: string;
  /** Networks this plugin supports — pass through if it works on both. */
  networks: Array<"mainnet" | "testnet">;
  register(mcp: McpServer, server: ServerContext): void;
}
