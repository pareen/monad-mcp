import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";

describe("buildServer", () => {
  test("constructs the MCP server with all expected tools registered", async () => {
    const { mcp, context } = buildServer();
    expect(mcp).toBeDefined();
    expect(context.config.defaultNetwork).toBe("testnet");
    expect(context.store).toBeDefined();
    await mcp.close();
  });
});
