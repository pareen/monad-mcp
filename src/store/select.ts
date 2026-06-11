import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { MemoryGrantStore } from "../grants/memory.js";
import { PgGrantStore } from "../grants/postgres.js";
import type { GrantStore } from "../grants/types.js";
import type { Logger } from "../logger.js";
import { MemoryUsageStore } from "../usage/memory.js";
import { PgUsageStore } from "../usage/postgres.js";
import type { UsageStore } from "../usage/types.js";
import { MemoryRequestStore } from "./memory.js";
import { PgRequestStore } from "./postgres.js";
import type { RequestStore } from "./types.js";

let sharedPool: Pool | null = null;

function poolFor(config: Config): Pool {
  if (sharedPool) return sharedPool;
  if (!config.databaseUrl) throw new Error("DATABASE_URL not set");
  sharedPool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  return sharedPool;
}

export interface StoreBundle {
  requestStore: RequestStore;
  grantStore: GrantStore;
  usageStore: UsageStore;
}

export function selectStores(config: Config, _logger: Logger): StoreBundle {
  if (config.storeBackend === "postgres") {
    const pool = poolFor(config);
    return {
      requestStore: new PgRequestStore(pool),
      grantStore: new PgGrantStore(pool),
      usageStore: new PgUsageStore(pool),
    };
  }
  return {
    requestStore: new MemoryRequestStore(),
    grantStore: new MemoryGrantStore(),
    usageStore: new MemoryUsageStore(),
  };
}

/**
 * Applies every bundled migration in `migrations/`, in filename order,
 * idempotently (each file uses IF NOT EXISTS). Intended for dev and small
 * deploys — for heavier setups use a real migration runner (sqitch, dbmate).
 */
export async function runMigrations(config: Config): Promise<void> {
  if (config.storeBackend !== "postgres") return;
  const pool = poolFor(config);
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "..", "..", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(dir, file), "utf8");
    await pool.query(sql);
  }
}

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
