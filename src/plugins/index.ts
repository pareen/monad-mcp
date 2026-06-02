import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";
import { fastlanePlugin } from "./fastlane/index.js";
import { kintsuPlugin } from "./kintsu/index.js";
import { kuruPlugin } from "./kuru/index.js";
import { morphoPlugin } from "./morpho/index.js";
import type { SkillPlugin } from "./types.js";
import { uniswapPlugin } from "./uniswap/index.js";

export const builtinPlugins: SkillPlugin[] = [
  uniswapPlugin,
  kintsuPlugin,
  fastlanePlugin,
  morphoPlugin,
  kuruPlugin,
];

export function registerPlugins(
  mcp: McpServer,
  server: ServerContext,
  plugins: SkillPlugin[] = builtinPlugins,
): void {
  for (const plugin of plugins) {
    if (!plugin.networks.includes(server.config.defaultNetwork)) {
      server.logger.warn("plugin not enabled on default network — skipping registration", {
        plugin: plugin.id,
        default_network: server.config.defaultNetwork,
        supported: plugin.networks,
      });
      continue;
    }
    plugin.register(mcp, server);
    server.logger.info("registered plugin", { plugin: plugin.id });
  }
}

export type { SkillPlugin } from "./types.js";
