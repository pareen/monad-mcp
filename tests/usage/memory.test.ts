import { describe, expect, test } from "vitest";
import { MemoryUsageStore } from "../../src/usage/memory.js";
import type { UsageEvent } from "../../src/usage/types.js";

const DAY1 = Date.UTC(2026, 5, 10, 9, 0, 0); // 2026-06-10
const DAY2 = Date.UTC(2026, 5, 11, 9, 0, 0); // 2026-06-11

function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    tool: "get_balance",
    kind: "read",
    network: "testnet",
    authed: false,
    ok: true,
    ...over,
  };
}

describe("MemoryUsageStore", () => {
  test("collapses identical events into a single day bucket", async () => {
    const clock = DAY2;
    const store = new MemoryUsageStore({ now: () => clock });
    await store.record(ev());
    await store.record(ev());
    await store.record(ev());
    const s = await store.summary();
    expect(s.totals.calls).toBe(3);
    expect(s.byTool).toHaveLength(1);
    expect(s.byTool[0]).toMatchObject({ tool: "get_balance", calls: 3 });
  });

  test("separates distinct dimensions and counts them", async () => {
    const store = new MemoryUsageStore({ now: () => DAY2 });
    await store.record(ev({ tool: "get_balance", kind: "read", ok: true }));
    await store.record(ev({ tool: "transfer", kind: "write", authed: true, ok: true }));
    await store.record(ev({ tool: "transfer", kind: "write", authed: true, ok: false }));
    await store.record(
      ev({ tool: "uniswap_swap", kind: "write", network: "mainnet", authed: true, ok: true }),
    );
    const s = await store.summary();
    expect(s.totals.calls).toBe(4);
    expect(s.totals.reads).toBe(1);
    expect(s.totals.writes).toBe(3);
    expect(s.totals.errors).toBe(1);
    expect(s.totals.mainnet).toBe(1);
    expect(s.totals.distinctTools).toBe(3);
  });

  test("buckets by UTC day across the clock advancing", async () => {
    let clock = DAY1;
    const store = new MemoryUsageStore({ now: () => clock });
    await store.record(ev());
    clock = DAY2;
    await store.record(ev());
    await store.record(ev());
    const s = await store.summary({ days: 2 });
    expect(s.daily).toEqual([
      { day: "2026-06-10", calls: 1, ok: 1, errors: 0 },
      { day: "2026-06-11", calls: 2, ok: 2, errors: 0 },
    ]);
  });
});
