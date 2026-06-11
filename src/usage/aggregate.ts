import type { NetworkName } from "../chains/monad.js";
import type { UsageRow, UsageSummary } from "./types.js";

export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day (`YYYY-MM-DD`) for a ms timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The trailing `n` UTC day strings ending today, ascending. */
export function lastNDays(nowMs: number, n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(utcDay(nowMs - i * DAY_MS));
  }
  return days;
}

/** Clamp a requested window to a sane range. */
export function clampWindow(days: number | undefined): number {
  if (!Number.isFinite(days) || days === undefined) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(days)));
}

/**
 * Reduce daily-aggregated rows into the public summary. Totals/byTool/byNetwork
 * are lifetime (every row); `daily` is the trailing window with zero-filled gaps
 * so the activity chart is continuous. Shared by the memory and Postgres stores
 * so both produce byte-identical summaries.
 */
export function aggregateUsage(
  rows: UsageRow[],
  opts: { days: number; nowMs: number },
): UsageSummary {
  const totals = {
    calls: 0,
    ok: 0,
    errors: 0,
    successRate: 1,
    reads: 0,
    writes: 0,
    authed: 0,
    anonymous: 0,
    mainnet: 0,
    testnet: 0,
    distinctTools: 0,
    firstDay: null as string | null,
    lastDay: null as string | null,
  };

  const toolMap = new Map<
    string,
    { tool: string; kind: UsageRow["kind"]; calls: number; ok: number; errors: number }
  >();
  const networkMap = new Map<NetworkName, number>();
  const dayMap = new Map<string, { calls: number; ok: number; errors: number }>();

  for (const r of rows) {
    const n = r.calls;
    totals.calls += n;
    totals.ok += r.ok ? n : 0;
    totals.errors += r.ok ? 0 : n;
    totals[r.kind === "read" ? "reads" : "writes"] += n;
    totals[r.authed ? "authed" : "anonymous"] += n;
    totals[r.network] += n;
    if (totals.firstDay === null || r.day < totals.firstDay) totals.firstDay = r.day;
    if (totals.lastDay === null || r.day > totals.lastDay) totals.lastDay = r.day;

    const t = toolMap.get(r.tool) ?? { tool: r.tool, kind: r.kind, calls: 0, ok: 0, errors: 0 };
    t.calls += n;
    t.ok += r.ok ? n : 0;
    t.errors += r.ok ? 0 : n;
    toolMap.set(r.tool, t);

    networkMap.set(r.network, (networkMap.get(r.network) ?? 0) + n);

    const d = dayMap.get(r.day) ?? { calls: 0, ok: 0, errors: 0 };
    d.calls += n;
    d.ok += r.ok ? n : 0;
    d.errors += r.ok ? 0 : n;
    dayMap.set(r.day, d);
  }

  totals.distinctTools = toolMap.size;
  totals.successRate = totals.calls > 0 ? totals.ok / totals.calls : 1;

  const byTool = [...toolMap.values()].sort(
    (a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool),
  );
  const byNetwork = [...networkMap.entries()]
    .map(([network, calls]) => ({ network, calls }))
    .sort((a, b) => b.calls - a.calls);

  const daily = lastNDays(opts.nowMs, opts.days).map((day) => {
    const d = dayMap.get(day) ?? { calls: 0, ok: 0, errors: 0 };
    return { day, calls: d.calls, ok: d.ok, errors: d.errors };
  });

  return {
    generatedAt: opts.nowMs,
    windowDays: opts.days,
    totals,
    byTool,
    byNetwork,
    daily,
  };
}
