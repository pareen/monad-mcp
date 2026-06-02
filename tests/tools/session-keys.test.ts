import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import {
  grantSessionKeyTool,
  listSessionKeysTool,
  revokeSessionKeyTool,
} from "../../src/tools/session-keys.js";
import { transferTool } from "../../src/tools/transfer.js";
import { makeTestContext } from "../helpers/context.js";

const userId = "did:privy:user1";
const walletAddress = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const walletId = "wallet_1";

const authedInfo: AuthInfo = {
  token: "tok",
  clientId: userId,
  scopes: ["monad:read", "monad:write"],
  extra: { userId, sessionId: "sess", walletAddress, walletId },
};

describe("session-key tools", () => {
  test("grant_session_key creates a pending grant + approval URL", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      grantSessionKeyTool,
      { spend_cap_mon: "0.5", label: "dca", ttl_seconds: 600 },
      ctx,
      authedInfo,
    );
    expect(res.isError).toBeFalsy();
    const struct = res.structuredContent as {
      grant_id: string;
      request_id: string;
      approval_url: string;
      spend_cap_wei: string;
    };
    expect(struct.spend_cap_wei).toBe("500000000000000000");
    expect(struct.approval_url).toContain(`/approve/${struct.request_id}`);

    const grant = await ctx.grants.get(struct.grant_id);
    expect(grant?.status).toBe("pending");
    expect(grant?.label).toBe("dca");
  });

  test("list_session_keys shows grants for the user", async () => {
    const ctx = makeTestContext();
    await runTool(grantSessionKeyTool, { spend_cap_mon: "0.1", label: "a" }, ctx, authedInfo);
    await runTool(grantSessionKeyTool, { spend_cap_mon: "0.2", label: "b" }, ctx, authedInfo);
    const list = await runTool(listSessionKeysTool, {}, ctx, authedInfo);
    const struct = list.structuredContent as { grants: Array<{ label: string }> };
    expect(struct.grants.map((g) => g.label).sort()).toEqual(["a", "b"]);
  });

  test("revoke_session_key flips the grant status", async () => {
    const ctx = makeTestContext();
    const grantRes = await runTool(
      grantSessionKeyTool,
      { spend_cap_mon: "0.1", label: "x" },
      ctx,
      authedInfo,
    );
    const grantId = (grantRes.structuredContent as { grant_id: string }).grant_id;
    await ctx.grants.activate(grantId);

    const revoked = await runTool(revokeSessionKeyTool, { grant_id: grantId }, ctx, authedInfo);
    expect((revoked.structuredContent as { status: string }).status).toBe("revoked");
  });

  test("transfer uses an active covering grant — skips approval URL", async () => {
    const ctx = makeTestContext();
    // Pre-create + activate a grant for 1 MON
    const grant = await ctx.grants.create({
      userId,
      walletAddress,
      network: "testnet",
      label: "agent",
      spendCapWei: "1000000000000000000",
      ttlMs: 60_000,
    });
    await ctx.grants.activate(grant.id);

    // Stub the Privy bridge: resolveUser + sendTransaction
    const sendTransaction = vi.fn(async () => "0xdeadbeef".padEnd(66, "0") as `0x${string}`);
    ctx.auth = {
      resolveUser: vi.fn(async () => ({ userId, walletAddress, walletId })),
      sendTransaction,
    } as never;

    const res = await runTool(
      transferTool,
      {
        to: "0xabababababababababababababababababababab",
        amount: "0.01",
      },
      ctx,
      authedInfo,
    );
    const struct = res.structuredContent as {
      executed_via_grant: boolean;
      tx_hash: string;
      grant_spent_wei: string;
    };
    expect(struct.executed_via_grant).toBe(true);
    expect(struct.tx_hash).toMatch(/^0xdeadbeef/);
    expect(struct.grant_spent_wei).toBe("10000000000000000"); // 0.01 MON
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  test("transfer falls back to approval URL when grant doesn't cover", async () => {
    const ctx = makeTestContext();
    // Grant covers only address 0xab… but caller sends to 0xcd…
    const okTarget = "0xabababababababababababababababababababab" as `0x${string}`;
    const grant = await ctx.grants.create({
      userId,
      walletAddress,
      network: "testnet",
      label: "scoped",
      spendCapWei: "1000000000000000000",
      allowedTargets: [okTarget],
      ttlMs: 60_000,
    });
    await ctx.grants.activate(grant.id);

    ctx.auth = {
      resolveUser: vi.fn(),
      sendTransaction: vi.fn(),
    } as never;

    const res = await runTool(
      transferTool,
      { to: "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd", amount: "0.01" },
      ctx,
      authedInfo,
    );
    const struct = res.structuredContent as {
      approval_url?: string;
      executed_via_grant?: boolean;
    };
    expect(struct.executed_via_grant).toBeUndefined();
    expect(struct.approval_url).toContain("/approve/");
  });

  test("transfer refunds the grant when Privy submission fails", async () => {
    const ctx = makeTestContext();
    const grant = await ctx.grants.create({
      userId,
      walletAddress,
      network: "testnet",
      label: "refund",
      spendCapWei: "1000000000000000000",
      ttlMs: 60_000,
    });
    await ctx.grants.activate(grant.id);

    ctx.auth = {
      resolveUser: vi.fn(async () => ({ userId, walletAddress, walletId })),
      sendTransaction: vi.fn(async () => {
        throw new Error("privy rejected: insufficient gas");
      }),
    } as never;

    const res = await runTool(
      transferTool,
      { to: "0xabababababababababababababababababababab", amount: "0.01" },
      ctx,
      authedInfo,
    );
    expect(res.isError).toBe(true);

    // Grant should be back to active with spentWei = 0
    const refreshed = await ctx.grants.get(grant.id);
    expect(refreshed?.spentWei).toBe("0");
    expect(refreshed?.status).toBe("active");
  });
});
