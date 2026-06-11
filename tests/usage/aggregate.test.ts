import { describe, expect, test } from "vitest";
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  aggregateUsage,
  clampWindow,
  lastNDays,
  utcDay,
} from "../../src/usage/aggregate.js";
import type { UsageRow } from "../../src/usage/types.js";

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // 2026-06-11

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    day: "2026-06-11",
    tool: "get_balance",
    kind: "read",
    network: "testnet",
    authed: false,
    ok: true,
    calls: 1,
    ...over,
  };
}

describe("utcDay / lastNDays", () => {
  test("utcDay is a UTC YYYY-MM-DD string", () => {
    expect(utcDay(NOW)).toBe("2026-06-11");
    expect(utcDay(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
  });

  test("lastNDays returns n ascending days ending today", () => {
    const d = lastNDays(NOW, 3);
    expect(d).toEqual(["2026-06-09", "2026-06-10", "2026-06-11"]);
  });
});

describe("clampWindow", () => {
  test("defaults and clamps", () => {
    expect(clampWindow(undefined)).toBe(DEFAULT_WINDOW_DAYS);
    expect(clampWindow(Number.NaN)).toBe(DEFAULT_WINDOW_DAYS);
    expect(clampWindow(0)).toBe(1);
    expect(clampWindow(-5)).toBe(1);
    expect(clampWindow(99999)).toBe(MAX_WINDOW_DAYS);
    expect(clampWindow(45)).toBe(45);
    expect(clampWindow(7.9)).toBe(7);
  });
});

describe("aggregateUsage", () => {
  test("empty input yields zeroed totals and a full zero-filled window", () => {
    const s = aggregateUsage([], { days: 7, nowMs: NOW });
    expect(s.totals.calls).toBe(0);
    expect(s.totals.successRate).toBe(1);
    expect(s.totals.distinctTools).toBe(0);
    expect(s.totals.firstDay).toBeNull();
    expect(s.byTool).toEqual([]);
    expect(s.daily).toHaveLength(7);
    expect(s.daily.every((d) => d.calls === 0)).toBe(true);
    expect(s.daily[6]?.day).toBe("2026-06-11");
  });

  test("folds dimensions into lifetime totals", () => {
    const rows = [
      row({ tool: "get_balance", kind: "read", ok: true, calls: 10 }),
      row({ tool: "transfer", kind: "write", authed: true, ok: true, calls: 3 }),
      row({ tool: "transfer", kind: "write", authed: true, ok: false, calls: 1 }),
      row({
        tool: "uniswap_swap",
        kind: "write",
        network: "mainnet",
        authed: true,
        ok: true,
        calls: 2,
      }),
    ];
    const s = aggregateUsage(rows, { days: 30, nowMs: NOW });
    expect(s.totals.calls).toBe(16);
    expect(s.totals.ok).toBe(15);
    expect(s.totals.errors).toBe(1);
    expect(s.totals.reads).toBe(10);
    expect(s.totals.writes).toBe(6);
    expect(s.totals.authed).toBe(6);
    expect(s.totals.anonymous).toBe(10);
    expect(s.totals.mainnet).toBe(2);
    expect(s.totals.testnet).toBe(14);
    expect(s.totals.distinctTools).toBe(3);
    expect(s.totals.successRate).toBeCloseTo(15 / 16);
  });

  test("byTool is sorted by calls desc and merges ok/errors per tool", () => {
    const rows = [
      row({ tool: "transfer", kind: "write", ok: true, calls: 3 }),
      row({ tool: "transfer", kind: "write", ok: false, calls: 2 }),
      row({ tool: "get_balance", ok: true, calls: 10 }),
    ];
    const s = aggregateUsage(rows, { days: 30, nowMs: NOW });
    expect(s.byTool.map((t) => t.tool)).toEqual(["get_balance", "transfer"]);
    const transfer = s.byTool.find((t) => t.tool === "transfer");
    expect(transfer).toMatchObject({ calls: 5, ok: 3, errors: 2, kind: "write" });
  });

  test("daily window only includes the trailing N days, with gaps zero-filled", () => {
    const rows = [
      row({ day: "2026-06-11", calls: 5 }),
      row({ day: "2026-06-09", calls: 2 }),
      row({ day: "2026-01-01", calls: 100 }), // outside the window
    ];
    const s = aggregateUsage(rows, { days: 3, nowMs: NOW });
    expect(s.daily).toEqual([
      { day: "2026-06-09", calls: 2, ok: 2, errors: 0 },
      { day: "2026-06-10", calls: 0, ok: 0, errors: 0 },
      { day: "2026-06-11", calls: 5, ok: 5, errors: 0 },
    ]);
    // ...but lifetime totals still count the out-of-window day.
    expect(s.totals.calls).toBe(107);
    expect(s.totals.firstDay).toBe("2026-01-01");
    expect(s.totals.lastDay).toBe("2026-06-11");
  });
});
