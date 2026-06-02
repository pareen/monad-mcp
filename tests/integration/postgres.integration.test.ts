import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PgGrantStore } from "../../src/grants/postgres.js";
import { PgRequestStore } from "../../src/store/postgres.js";

const url = process.env.DATABASE_URL;
const describeOrSkip = url ? describe : describe.skip;

const baseInput = {
  userId: "did:privy:user1",
  network: "testnet" as const,
  walletAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  summary: "Send 1 MON to 0xabc",
  call: {
    to: "0xabababababababababababababababababababab" as `0x${string}`,
    value: "1000000000000000000",
    data: "0x" as `0x${string}`,
  },
};

describeOrSkip("integration: Postgres stores", () => {
  let pool: Pool;
  let store: PgRequestStore;
  let grants: PgGrantStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    const sql = readFileSync(resolve(process.cwd(), "migrations/001_init.sql"), "utf8");
    await pool.query(sql);
    // Clean slate per run
    await pool.query("TRUNCATE stored_requests, session_grants");
    store = new PgRequestStore(pool);
    grants = new PgGrantStore(pool);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  test("PgRequestStore round-trips a create + approve + get", async () => {
    const created = await store.create(baseInput);
    expect(created.status).toBe("pending");
    const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const approved = await store.markApproved(created.id, txHash);
    expect(approved.status).toBe("approved");
    expect(approved.txHash).toBe(txHash);
    const fetched = await store.get(created.id);
    expect(fetched?.status).toBe("approved");
    expect(fetched?.txHash).toBe(txHash);
  });

  test("PgRequestStore auto-expires past TTL on read", async () => {
    let now = 100_000;
    const tinyStore = new PgRequestStore(pool, { now: () => now, defaultTtlMs: 50 });
    const created = await tinyStore.create(baseInput);
    now += 200;
    const fetched = await tinyStore.get(created.id);
    expect(fetched?.status).toBe("expired");
  });

  test("PgGrantStore activate → recordSpend → findCovering", async () => {
    const g = await grants.create({
      userId: "did:privy:user1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      label: "pg-test",
      spendCapWei: "1000000000000000000",
      ttlMs: 60_000,
    });
    await grants.activate(g.id);
    const covering = await grants.findCovering(
      g.userId,
      { to: "0xab".padEnd(42, "c") as `0x${string}`, value: "1000", data: "0x" },
      "testnet",
    );
    expect(covering?.id).toBe(g.id);
    await grants.recordSpend(g.id, 1000n);
    const after = await grants.get(g.id);
    expect(after?.spentWei).toBe("1000");
  });

  test("PgGrantStore refundSpend rehydrates a depleted grant", async () => {
    const g = await grants.create({
      userId: "did:privy:user1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      label: "refund",
      spendCapWei: "1000",
      ttlMs: 60_000,
    });
    await grants.activate(g.id);
    await grants.recordSpend(g.id, 1000n);
    expect((await grants.get(g.id))?.status).toBe("depleted");
    const refunded = await grants.refundSpend(g.id, 1000n);
    expect(refunded.status).toBe("active");
    expect(refunded.spentWei).toBe("0");
  });
});
