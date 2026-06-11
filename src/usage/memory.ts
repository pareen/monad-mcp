import { aggregateUsage, clampWindow, utcDay } from "./aggregate.js";
import type {
  UsageEvent,
  UsageRow,
  UsageStore,
  UsageSummary,
  UsageSummaryOptions,
} from "./types.js";

export interface MemoryUsageStoreOptions {
  /** Override the clock for tests. */
  now?: () => number;
}

/**
 * Process-local usage counters, keyed by day × dimension tuple — the same
 * granularity the Postgres store persists. Fine for single-instance dev; resets
 * on restart, so production should run STORE_BACKEND=postgres for durable stats.
 */
export class MemoryUsageStore implements UsageStore {
  private readonly buckets = new Map<string, UsageRow>();
  private readonly now: () => number;

  constructor(options: MemoryUsageStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async record(event: UsageEvent): Promise<void> {
    const day = utcDay(this.now());
    const key = `${day}|${event.tool}|${event.kind}|${event.network}|${event.authed ? 1 : 0}|${event.ok ? 1 : 0}`;
    const existing = this.buckets.get(key);
    if (existing) {
      existing.calls += 1;
      return;
    }
    this.buckets.set(key, {
      day,
      tool: event.tool,
      kind: event.kind,
      network: event.network,
      authed: event.authed,
      ok: event.ok,
      calls: 1,
    });
  }

  async summary(options: UsageSummaryOptions = {}): Promise<UsageSummary> {
    const days = clampWindow(options.days);
    return aggregateUsage([...this.buckets.values()], { days, nowMs: this.now() });
  }
}
