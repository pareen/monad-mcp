import type { NetworkName } from "../chains/monad.js";
import type { ToolKind } from "../tools/registry.js";

/**
 * One tool invocation, reduced to the dimensions worth counting publicly. We
 * deliberately keep NO per-user identity, arguments, addresses, or amounts —
 * the stats page is a privacy-safe, aggregate view of which tools get used.
 */
export interface UsageEvent {
  tool: string;
  kind: ToolKind;
  network: NetworkName;
  /** Whether the caller presented a valid bearer token (signed in). */
  authed: boolean;
  /** Whether the call returned a result rather than an error. */
  ok: boolean;
}

/**
 * A daily-aggregated counter row. Both the memory and Postgres stores keep
 * usage at this granularity (one row per day × dimension tuple), so the
 * shared aggregator in `aggregate.ts` can build a summary from either.
 */
export interface UsageRow {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  tool: string;
  kind: ToolKind;
  network: NetworkName;
  authed: boolean;
  ok: boolean;
  calls: number;
}

export interface UsageSummary {
  /** ms epoch the summary was generated. */
  generatedAt: number;
  /** Number of trailing days covered by `daily`. */
  windowDays: number;
  /** Lifetime totals across every recorded call. */
  totals: {
    calls: number;
    ok: number;
    errors: number;
    /** 0..1; 1 when there are no calls yet. */
    successRate: number;
    reads: number;
    writes: number;
    authed: number;
    anonymous: number;
    mainnet: number;
    testnet: number;
    distinctTools: number;
    /** First and last day we have data for (`YYYY-MM-DD`), or null when empty. */
    firstDay: string | null;
    lastDay: string | null;
  };
  /** Lifetime calls per tool, busiest first. */
  byTool: Array<{
    tool: string;
    kind: ToolKind;
    calls: number;
    ok: number;
    errors: number;
  }>;
  /** Lifetime calls per network. */
  byNetwork: Array<{ network: NetworkName; calls: number }>;
  /** One entry per day in the trailing window, ascending, gaps filled with zeros. */
  daily: Array<{ day: string; calls: number; ok: number; errors: number }>;
}

export interface UsageSummaryOptions {
  /** Trailing days for the `daily` time-series (default 30). */
  days?: number;
}

export interface UsageStore {
  /** Record a single tool invocation. Must never throw on the hot path. */
  record(event: UsageEvent): Promise<void>;
  /** Build an aggregate summary for the public stats page. */
  summary(options?: UsageSummaryOptions): Promise<UsageSummary>;
}
