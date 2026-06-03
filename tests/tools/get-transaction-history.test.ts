import { describe, expect, test, vi } from "vitest";
import { getTransactionHistoryTool } from "../../src/tools/get-transaction-history.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

const ADDR = "0x000000000000000000000000000000000000dEaD";

// Regression: ISSUE-002 — get_transaction_history issued a single eth_getLogs
// over the entire lookback (default 5000 blocks), but Monad's RPC rejects any
// getLogs request spanning more than 100 blocks ("eth_getLogs is limited to a
// 100 range"). Every default call therefore errored. The tool must now scan in
// <=100-block windows. Found by /qa on 2026-06-03.
describe("get_transaction_history windowing (ISSUE-002)", () => {
  test("never requests an eth_getLogs range wider than 100 blocks", async () => {
    const head = 1_000_000n;
    const calls: Array<{ from: bigint; to: bigint }> = [];
    // Mimic Monad's RPC: reject any window wider than 100 blocks.
    const getLogs = vi.fn(async (params: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push({ from: params.fromBlock, to: params.toBlock });
      if (params.toBlock - params.fromBlock > 100n) {
        throw new Error("eth_getLogs is limited to a 100 range");
      }
      return [];
    });

    const ctx = makeTestContext({
      publicClient: {
        getBlockNumber: vi.fn(async () => head) as never,
        getLogs: getLogs as never,
      },
    });

    const res = await runTool(getTransactionHistoryTool, { address: ADDR, lookback_blocks: 5_000 }, ctx);
    const s = res.structuredContent as { from_block: string; to_block: string; events: unknown[] };

    // Did not throw, and covered the full requested range.
    expect(s.from_block).toBe("995000");
    expect(s.to_block).toBe("1000000");
    expect(s.events).toEqual([]);

    // No single request exceeded the 100-block limit.
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c.to - c.from).toBeLessThanOrEqual(100n);
    }
  });

  test("a single failing window is skipped, not fatal", async () => {
    const head = 500n;
    let failedOnce = false;
    const getLogs = vi.fn(async (params: { fromBlock: bigint; toBlock: bigint }) => {
      // Fail exactly one window (simulate a transient rate-limit hiccup).
      if (!failedOnce && params.fromBlock > 100n) {
        failedOnce = true;
        throw new Error("429 rate limited");
      }
      return [];
    });

    const ctx = makeTestContext({
      publicClient: {
        getBlockNumber: vi.fn(async () => head) as never,
        getLogs: getLogs as never,
      },
    });

    const res = await runTool(getTransactionHistoryTool, { address: ADDR, lookback_blocks: 400 }, ctx);
    const s = res.structuredContent as { skipped_block_windows?: number; events: unknown[] };
    expect(s.skipped_block_windows).toBe(1);
    expect(Array.isArray(s.events)).toBe(true);
  });
});
