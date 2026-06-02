/**
 * End-to-end protocol test: drive the built server (dist/index.js) over a real
 * stdio MCP connection — not runTool in-process. Confirms the full path an MCP
 * client (Claude Desktop, Cursor) takes: initialize → tools/list → tools/call.
 *
 *   1. spawn dist/index.js as an MCP server over stdio
 *   2. list tools, assert the expected count + a few names
 *   3. call get_balance (read, no auth) against a real address → assert it hits chain
 *   4. call list_canonical_tokens → assert shMON present, aprMON absent
 *
 * Run: node --env-file=.env --import tsx scripts/e2e-stdio.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function log(m: string, x?: unknown) {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log(`[stdio] ${m}${x !== undefined ? ` ${JSON.stringify(x)}` : ""}`);
}

async function main() {
  // Default to mainnet so every plugin registers (mainnet-only plugins like
  // FastLane are gated off on a testnet-default server). Read calls below still
  // target testnet via the per-call `network` arg.
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, MONAD_DEFAULT_NETWORK: "mainnet" } as Record<string, string>,
  });
  const client = new Client({ name: "e2e-stdio", version: "0.0.0" });
  await client.connect(transport);
  log("connected to dist/index.js over stdio");

  // 1. tools/list
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  log("tools registered", { count: names.length });
  for (const must of ["get_balance", "transfer", "grant_session_key", "fastlane_stake", "read_contract"]) {
    if (!names.includes(must)) throw new Error(`missing expected tool: ${must}`);
  }
  if (names.includes("apriori_stake")) throw new Error("apriori_stake still present — should be removed!");
  log("expected tools present, apriori absent ✓");

  // 2. get_balance (read, unauthenticated) against the funded e2e wallet
  const balRes = await client.callTool({
    name: "get_balance",
    arguments: { address: "0x7E274bCA90eEfa81761080e074AFb1D354a0c552", network: "testnet" },
  });
  const balText = (balRes.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  if (!/MON/.test(balText)) throw new Error(`get_balance unexpected: ${balText}`);
  log("get_balance via protocol", { text: balText.split("\n")[0] });

  // 3. list_canonical_tokens — shMON in, aprMON out
  const tokRes = await client.callTool({
    name: "list_canonical_tokens",
    arguments: { network: "mainnet" },
  });
  const tokStruct = tokRes.structuredContent as { tokens: Array<{ symbol: string }> };
  const syms = tokStruct.tokens.map((t) => t.symbol);
  if (!syms.includes("shMON")) throw new Error("shMON missing from canonical tokens");
  if (syms.includes("aprMON")) throw new Error("aprMON still in canonical tokens!");
  log("canonical tokens correct", { has_shMON: true, has_aprMON: false, symbols: syms });

  await client.close();
  log("DONE — full MCP protocol path verified over stdio ✅");
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("[stdio] FAILED:", err);
  process.exit(1);
});
