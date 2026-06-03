import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "vitest";
import { guideDocs, registerGuideResources } from "../src/resources/guide.js";

describe("monad guide resources", () => {
  test("exposes the index plus the four topic guides under monad://guide", () => {
    const uris = guideDocs.map((g) => g.uri);
    expect(uris).toContain("monad://guide");
    expect(uris).toContain("monad://guide/contracts-and-gas");
    expect(uris).toContain("monad://guide/realtime-events");
    expect(uris).toContain("monad://guide/rpc-quirks");
    expect(uris).toContain("monad://guide/mev-and-fastlane");
    // URIs and names are unique and namespaced.
    expect(new Set(uris).size).toBe(uris.length);
    expect(new Set(guideDocs.map((g) => g.name)).size).toBe(guideDocs.length);
    for (const g of guideDocs) expect(g.uri.startsWith("monad://guide")).toBe(true);
  });

  test("content carries the load-bearing Monad facts (guards against regressions)", () => {
    const byUri = Object.fromEntries(guideDocs.map((g) => [g.uri, g.text]));
    expect(byUri["monad://guide/contracts-and-gas"]).toMatch(/128 KB/);
    expect(byUri["monad://guide/contracts-and-gas"]).toMatch(/gas_limit/);
    expect(byUri["monad://guide/realtime-events"]).toMatch(/monadLogs/);
    expect(byUri["monad://guide/realtime-events"]).toMatch(/commitState|Finalized/);
    expect(byUri["monad://guide/rpc-quirks"]).toMatch(/100[- ]block|100 blocks/);
    expect(byUri["monad://guide/rpc-quirks"]).toMatch(/finalized/);
    expect(byUri["monad://guide/mev-and-fastlane"]).toMatch(/shMON/);
    expect(byUri["monad://guide/mev-and-fastlane"]).toMatch(/Atlas/);
  });

  test("registers all guides on an McpServer without error", async () => {
    const mcp = new McpServer({ name: "test", version: "0" });
    expect(() => registerGuideResources(mcp)).not.toThrow();
    await mcp.close();
  });
});
