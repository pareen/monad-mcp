import { describe, expect, test, vi } from "vitest";
import { getTransactionHistoryTool } from "../../src/tools/get-transaction-history.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

const TARGET = "0x1111111111111111111111111111111111111111";

function transferLog(block: bigint) {
  return {
    transactionHash: "0xabc",
    blockNumber: block,
    address: "0x2222222222222222222222222222222222222222",
    args: { from: TARGET, to: "0x3333333333333333333333333333333333333333", value: 1n },
  };
}

describe("get_transaction_history tool", () => {
  test("scans in <=100-block windows (never exceeds the public-RPC eth_getLogs cap)", async () => {
    const calls: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const getLogs = vi.fn(
      async (params: { fromBlock: bigint; toBlock: bigint; args?: { from?: string } }) => {
        calls.push({ fromBlock: params.fromBlock, toBlock: params.toBlock });
        // one transfer in the first window, on the `from` side only
        return params.args?.from === TARGET && params.fromBlock === 750n ? [transferLog(760n)] : [];
      },
    );
    const ctx = makeTestContext({
      publicClient: {
        getBlockNumber: vi.fn(async () => 1000n) as never,
        getLogs: getLogs as never,
      },
    });

    const res = await runTool(
      getTransactionHistoryTool,
      { address: TARGET, lookback_blocks: 250 },
      ctx,
    );

    expect(res.isError).toBeFalsy();
    // 250 blocks (750..1000) → 3 windows of <=100 blocks, each scanned from+to = 6 getLogs calls.
    expect(calls.length).toBe(6);
    for (const c of calls) {
      expect(c.toBlock - c.fromBlock).toBeLessThanOrEqual(99n);
    }
    const s = res.structuredContent as {
      windows_scanned: number;
      windows_failed: number;
      events: unknown[];
    };
    expect(s.windows_scanned).toBe(3);
    expect(s.windows_failed).toBe(0);
    expect(s.events.length).toBe(1);
  });

  test("tolerates a failing window and flags partial results", async () => {
    const getLogs = vi.fn(async (params: { fromBlock: bigint }) => {
      if (params.fromBlock === 850n) throw new Error("query exceeds max block range");
      return [];
    });
    const ctx = makeTestContext({
      publicClient: {
        getBlockNumber: vi.fn(async () => 1000n) as never,
        getLogs: getLogs as never,
      },
    });

    const res = await runTool(
      getTransactionHistoryTool,
      { address: TARGET, lookback_blocks: 250 },
      ctx,
    );

    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toMatch(/windows failed to scan/);
    const s = res.structuredContent as { windows_failed: number };
    expect(s.windows_failed).toBeGreaterThan(0);
  });

  test("rejects a lookback beyond the bounded max at the schema layer", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      getTransactionHistoryTool,
      { address: TARGET, lookback_blocks: 50_000 },
      ctx,
    );
    expect(res.isError).toBe(true);
  });
});
