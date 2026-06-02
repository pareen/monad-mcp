import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { MemoryGrantStore } from "../grants/memory.js";
import { PgGrantStore } from "../grants/postgres.js";
import type { GrantStore } from "../grants/types.js";
import type { Logger } from "../logger.js";
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
}

export function selectStores(config: Config, _logger: Logger): StoreBundle {
  if (config.storeBackend === "postgres") {
    const pool = poolFor(config);
    return {
      requestStore: new PgRequestStore(pool),
      grantStore: new PgGrantStore(pool),
    };
  }
  return {
    requestStore: new MemoryRequestStore(),
    grantStore: new MemoryGrantStore(),
  };
}

/**
 * Applies the bundled migration SQL idempotently. Intended for dev — in
 * production use a real migration runner (sqitch, dbmate, etc.).
 */
export async function runMigrations(config: Config): Promise<void> {
  if (config.storeBackend !== "postgres") return;
  const pool = poolFor(config);
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "..", "..", "migrations", "001_init.sql");
  const sql = await readFile(path, "utf8");
  await pool.query(sql);
}

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
