import { describe, expect, test, vi } from "vitest";
import { getTokenBalanceTool } from "../../src/tools/get-token-balance.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

describe("get_token_balance tool", () => {
  test("formats balance using on-chain decimals and symbol", async () => {
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "balanceOf") return 12_345_678n;
      if (args.functionName === "decimals") return 6;
      if (args.functionName === "symbol") return "USDC";
      return 0n;
    });
    const ctx = makeTestContext({
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      getTokenBalanceTool,
      {
        token: "0xcccccccccccccccccccccccccccccccccccccccc",
        address: "0x1111111111111111111111111111111111111111",
      },
      ctx,
    );
    expect(res.content[0]?.text).toMatch(/12\.345678 USDC/);
    const structured = res.structuredContent as { balance_raw: string; symbol: string };
    expect(structured.balance_raw).toBe("12345678");
    expect(structured.symbol).toBe("USDC");
  });

  test("falls back to TOKEN if symbol read reverts", async () => {
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "balanceOf") return 5n;
      if (args.functionName === "decimals") return 0;
      if (args.functionName === "symbol") throw new Error("revert");
      return 0n;
    });
    const ctx = makeTestContext({ publicClient: { readContract: readContract as never } });
    const res = await runTool(
      getTokenBalanceTool,
      {
        token: "0xcccccccccccccccccccccccccccccccccccccccc",
        address: "0x1111111111111111111111111111111111111111",
      },
      ctx,
    );
    expect(res.content[0]?.text).toMatch(/5 TOKEN/);
  });
});
