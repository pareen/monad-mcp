import type { Pool } from "pg";
import type { NetworkName } from "../chains/monad.js";
import type { ToolKind } from "../tools/registry.js";
import { aggregateUsage, clampWindow, utcDay } from "./aggregate.js";
import type {
  UsageEvent,
  UsageRow,
  UsageStore,
  UsageSummary,
  UsageSummaryOptions,
} from "./types.js";

interface DbRow {
  day: string;
  tool: string;
  kind: ToolKind;
  network: NetworkName;
  authed: boolean;
  ok: boolean;
  calls: string; // BIGINT arrives as a string
}

export interface PgUsageStoreOptions {
  now?: () => number;
}

export class PgUsageStore implements UsageStore {
  private readonly now: () => number;

  constructor(
    private readonly pool: Pool,
    options: PgUsageStoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async record(event: UsageEvent): Promise<void> {
    // Compute the UTC day in app code so buckets match the memory store
    // regardless of the database server's timezone.
    const day = utcDay(this.now());
    await this.pool.query(
      `INSERT INTO tool_usage_daily (day, tool, kind, network, authed, ok, calls)
       VALUES ($1,$2,$3,$4,$5,$6,1)
       ON CONFLICT (day, tool, kind, network, authed, ok)
       DO UPDATE SET calls = tool_usage_daily.calls + 1`,
      [day, event.tool, event.kind, event.network, event.authed, event.ok],
    );
  }

  async summary(options: UsageSummaryOptions = {}): Promise<UsageSummary> {
    const days = clampWindow(options.days);
    // Lifetime totals come from every row; the daily window is applied in the
    // shared aggregator. Row count stays low (one per day × small dimension
    // tuple), so fetching all and folding in JS keeps both stores identical.
    const res = await this.pool.query<DbRow>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, tool, kind, network, authed, ok, calls
       FROM tool_usage_daily`,
    );
    const rows: UsageRow[] = res.rows.map((r) => ({
      day: r.day,
      tool: r.tool,
      kind: r.kind,
      network: r.network,
      authed: r.authed,
      ok: r.ok,
      calls: Number(r.calls),
    }));
    return aggregateUsage(rows, { days, nowMs: this.now() });
  }
}
