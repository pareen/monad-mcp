import { describe, expect, test } from "vitest";
import { MemoryGrantStore } from "../src/grants/memory.js";

const baseGrant = {
  userId: "did:privy:user1",
  walletAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  network: "testnet" as const,
  label: "agent-session",
  spendCapWei: "1000000000000000000", // 1 MON
  ttlMs: 60_000,
};

const callTo = (to: `0x${string}`, value: string, data: `0x${string}` = "0x") => ({
  to,
  value,
  data,
});

describe("MemoryGrantStore", () => {
  test("create → activate → findCovering matches a small native call", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create(baseGrant);
    expect(g.status).toBe("pending");

    const beforeActivate = await store.findCovering(
      g.userId,
      callTo("0xabababababababababababababababababababab", "1000000000000000"),
      "testnet",
    );
    expect(beforeActivate).toBeNull();

    await store.activate(g.id);
    const covered = await store.findCovering(
      g.userId,
      callTo("0xabababababababababababababababababababab", "1000000000000000"),
      "testnet",
    );
    expect(covered?.id).toBe(g.id);
  });

  test("spend cap blocks calls that exceed remaining", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create({ ...baseGrant, spendCapWei: "1000" });
    await store.activate(g.id);
    await store.recordSpend(g.id, 800n);

    const stillCovers = await store.findCovering(
      g.userId,
      callTo("0xaa".padEnd(42, "b") as `0x${string}`, "100"),
      "testnet",
    );
    expect(stillCovers).not.toBeNull();

    const wouldExceed = await store.findCovering(
      g.userId,
      callTo("0xaa".padEnd(42, "b") as `0x${string}`, "300"),
      "testnet",
    );
    expect(wouldExceed).toBeNull();
  });

  test("allowedTargets allowlist filters by recipient", async () => {
    const store = new MemoryGrantStore();
    const ok = "0xabababababababababababababababababababab" as `0x${string}`;
    const denied = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd" as `0x${string}`;
    const g = await store.create({ ...baseGrant, allowedTargets: [ok] });
    await store.activate(g.id);

    expect(await store.findCovering(g.userId, callTo(ok, "1"), "testnet")).not.toBeNull();
    expect(await store.findCovering(g.userId, callTo(denied, "1"), "testnet")).toBeNull();
  });

  test("allowedSelectors gate calldata", async () => {
    const store = new MemoryGrantStore();
    const erc20Transfer = "0xa9059cbb" as `0x${string}`;
    const approve = "0x095ea7b3" as `0x${string}`;
    const g = await store.create({
      ...baseGrant,
      allowedSelectors: [erc20Transfer],
    });
    await store.activate(g.id);

    const transferCall = callTo(
      "0xab".padEnd(42, "c") as `0x${string}`,
      "0",
      `${erc20Transfer}00000000` as `0x${string}`,
    );
    const approveCall = callTo(
      "0xab".padEnd(42, "c") as `0x${string}`,
      "0",
      `${approve}00000000` as `0x${string}`,
    );

    expect(await store.findCovering(g.userId, transferCall, "testnet")).not.toBeNull();
    expect(await store.findCovering(g.userId, approveCall, "testnet")).toBeNull();
  });

  test("revoke flips status and skips coverage", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create(baseGrant);
    await store.activate(g.id);
    await store.revoke(g.id);
    expect((await store.get(g.id))?.status).toBe("revoked");
    expect(
      await store.findCovering(
        g.userId,
        callTo("0xab".padEnd(42, "c") as `0x${string}`, "1"),
        "testnet",
      ),
    ).toBeNull();
  });

  test("expires lazily on read past TTL", async () => {
    let now = 0;
    const store = new MemoryGrantStore({ now: () => now });
    const g = await store.create({ ...baseGrant, ttlMs: 50 });
    await store.activate(g.id);
    now += 100;
    expect((await store.get(g.id))?.status).toBe("expired");
  });

  test("depleted grants transition status", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create({ ...baseGrant, spendCapWei: "1000" });
    await store.activate(g.id);
    const after = await store.recordSpend(g.id, 1000n);
    expect(after.status).toBe("depleted");
  });

  test("refundSpend restores depleted grants to active", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create({ ...baseGrant, spendCapWei: "1000" });
    await store.activate(g.id);
    await store.recordSpend(g.id, 1000n);
    expect((await store.get(g.id))?.status).toBe("depleted");
    const refunded = await store.refundSpend(g.id, 1000n);
    expect(refunded.status).toBe("active");
    expect(refunded.spentWei).toBe("0");
  });

  test("refundSpend clamps to zero", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create({ ...baseGrant, spendCapWei: "1000" });
    await store.activate(g.id);
    await store.recordSpend(g.id, 100n);
    const refunded = await store.refundSpend(g.id, 999n);
    expect(refunded.spentWei).toBe("0");
  });

  test("recordSpend rejects when grant is not active", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create(baseGrant);
    await expect(store.recordSpend(g.id, 1n)).rejects.toThrow(/not active/);
  });

  test("network mismatch is not covered", async () => {
    const store = new MemoryGrantStore();
    const g = await store.create({ ...baseGrant, network: "testnet" });
    await store.activate(g.id);
    expect(
      await store.findCovering(
        g.userId,
        callTo("0xab".padEnd(42, "c") as `0x${string}`, "1"),
        "mainnet",
      ),
    ).toBeNull();
  });

  test("listForUser returns newest-first", async () => {
    const store = new MemoryGrantStore();
    const first = await store.create({ ...baseGrant, label: "a" });
    await new Promise((r) => setTimeout(r, 2));
    const second = await store.create({ ...baseGrant, label: "b" });
    const all = await store.listForUser(baseGrant.userId);
    expect(all.map((g) => g.id)).toEqual([second.id, first.id]);
  });
});
