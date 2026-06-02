import { describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import { simulateTransactionTool } from "../../src/tools/simulate.js";
import { makeTestContext } from "../helpers/context.js";

describe("simulate_transaction tool", () => {
  test("returns return_data + ok=true when call succeeds", async () => {
    const call = vi.fn(async () => ({ data: "0x01" as `0x${string}` }));
    const ctx = makeTestContext({ publicClient: { call: call as never } });
    const res = await runTool(
      simulateTransactionTool,
      { to: "0xabababababababababababababababababababab", data: "0x" },
      ctx,
    );
    const s = res.structuredContent as { ok: boolean; return_data: string };
    expect(s.ok).toBe(true);
    expect(s.return_data).toBe("0x01");
  });

  test("returns revert reason when call throws", async () => {
    const call = vi.fn(async () => {
      throw new Error("execution reverted: insufficient balance");
    });
    const ctx = makeTestContext({ publicClient: { call: call as never } });
    const res = await runTool(
      simulateTransactionTool,
      { to: "0xabababababababababababababababababababab", data: "0x" },
      ctx,
    );
    const s = res.structuredContent as { ok: boolean; revert_reason: string };
    expect(s.ok).toBe(false);
    expect(s.revert_reason).toMatch(/insufficient balance/);
  });
});
