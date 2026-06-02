import { describe, expect, test, vi } from "vitest";
import { getBalanceTool } from "../../src/tools/get-balance.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

describe("get_balance tool", () => {
  test("returns formatted MON balance for an explicit address", async () => {
    const ctx = makeTestContext({
      publicClient: { getBalance: vi.fn(async () => 1_500_000_000_000_000_000n) as never },
    });
    const res = await runTool(
      getBalanceTool,
      {
        address: "0x1111111111111111111111111111111111111111",
      },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toMatch(/1\.5 MON/);
    const structured = res.structuredContent as { balance_wei: string };
    expect(structured.balance_wei).toBe("1500000000000000000");
  });

  test("errors when no address and no auth", async () => {
    const ctx = makeTestContext();
    const res = await runTool(getBalanceTool, {}, ctx);
    expect(res.content[0]?.text).toMatch(/No address provided/);
  });

  test("rejects malformed address at the schema layer", async () => {
    const ctx = makeTestContext();
    const res = await runTool(getBalanceTool, { address: "not-an-address" }, ctx);
    expect(res.isError).toBe(true);
  });
});
