#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

async function main() {
  const { mcp, context } = buildServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  context.logger.info("monad-mcp running on stdio", {
    default_network: context.config.defaultNetwork,
    privy_enabled: Boolean(context.auth),
  });
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: top-level fatal
  console.error("fatal:", err);
  process.exit(1);
});
