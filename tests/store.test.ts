import { describe, expect, test, vi } from "vitest";
import { MemoryRequestStore } from "../src/store/memory.js";

const baseInput = {
  userId: "did:privy:user1",
  network: "testnet" as const,
  walletAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  summary: "Send 1 MON to 0xabc",
  call: {
    to: "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabc" as `0x${string}`,
    value: "1000000000000000000",
    data: "0x" as `0x${string}`,
  },
};

describe("MemoryRequestStore", () => {
  test("creates and retrieves a pending request", async () => {
    const store = new MemoryRequestStore();
    const req = await store.create(baseInput);
    expect(req.status).toBe("pending");
    expect(req.id).toMatch(/^[0-9a-f]{8}-/);
    expect(await store.get(req.id)).toEqual(req);
  });

  test("marks approved and stores tx hash idempotently", async () => {
    const store = new MemoryRequestStore();
    const req = await store.create(baseInput);
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const ok = await store.markApproved(req.id, hash);
    expect(ok.status).toBe("approved");
    expect(ok.txHash).toBe(hash);
    // idempotent — same hash returns the same row
    expect(await store.markApproved(req.id, hash)).toEqual(ok);
  });

  test("marks rejected with reason", async () => {
    const store = new MemoryRequestStore();
    const req = await store.create(baseInput);
    const rejected = await store.markRejected(req.id, "user denied");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("user denied");
  });

  test("auto-expires past TTL on read", async () => {
    let now = 1_000;
    const store = new MemoryRequestStore({ now: () => now, defaultTtlMs: 100 });
    const req = await store.create(baseInput);
    expect(req.status).toBe("pending");
    now += 200;
    const fetched = await store.get(req.id);
    expect(fetched?.status).toBe("expired");
  });

  test("expired requests reject markApproved", async () => {
    let now = 0;
    const store = new MemoryRequestStore({ now: () => now, defaultTtlMs: 50 });
    const req = await store.create(baseInput);
    now += 100;
    await expect(
      store.markApproved(req.id, `0x${"cd".repeat(32)}` as `0x${string}`),
    ).rejects.toThrow(/expired/);
  });

  test("returns null for unknown id", async () => {
    const store = new MemoryRequestStore();
    expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  test("markRejected on approved is a no-op (no reversal)", async () => {
    const store = new MemoryRequestStore();
    const req = await store.create(baseInput);
    await store.markApproved(req.id, `0x${"ef".repeat(32)}` as `0x${string}`);
    const result = await store.markRejected(req.id);
    expect(result.status).toBe("approved");
  });
});
