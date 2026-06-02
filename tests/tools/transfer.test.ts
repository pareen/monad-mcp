import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import { transferTool } from "../../src/tools/transfer.js";
import { makeTestContext } from "../helpers/context.js";

const authedInfo: AuthInfo = {
  token: "tok",
  clientId: "did:privy:user1",
  scopes: ["monad:read", "monad:write"],
  extra: {
    userId: "did:privy:user1",
    sessionId: "sess",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletId: "wallet_1",
  },
};

describe("transfer tool", () => {
  test("native MON transfer stores a request with the right call payload", async () => {
    const ctx = makeTestContext({
      publicClient: { estimateGas: vi.fn(async () => 21_000n) as never },
    });
    const res = await runTool(
      transferTool,
      {
        to: "0xabababababababababababababababababababab",
        amount: "1.5",
      },
      ctx,
      authedInfo,
    );
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as {
      request_id: string;
      approval_url: string;
      call: { to: string; value: string; data: string };
      simulation: { assetChanges: Array<{ kind: string }> };
    };
    expect(structured.call.value).toBe("1500000000000000000");
    expect(structured.call.data).toBe("0x");
    expect(structured.approval_url).toContain(`/approve/${structured.request_id}`);

    const stored = await ctx.store.get(structured.request_id);
    expect(stored?.status).toBe("pending");
    expect(stored?.network).toBe("testnet");
    expect(stored?.simulation?.assetChanges?.[0]?.kind).toBe("native");
  });

  test("ERC-20 transfer encodes calldata against the token contract", async () => {
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "decimals") return 6;
      if (args.functionName === "symbol") return "USDC";
      return 0n;
    });
    const ctx = makeTestContext({
      publicClient: {
        readContract: readContract as never,
        estimateGas: vi.fn(async () => 50_000n) as never,
      },
    });
    const res = await runTool(
      transferTool,
      {
        to: "0xabababababababababababababababababababab",
        amount: "10",
        token: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
      ctx,
      authedInfo,
    );
    const structured = res.structuredContent as {
      call: { to: string; value: string; data: string };
      simulation: { assetChanges: Array<{ kind: string; symbol: string; delta: string }> };
    };
    expect(structured.call.to).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    expect(structured.call.value).toBe("0");
    // ERC-20 transfer(address,uint256) selector
    expect(structured.call.data.startsWith("0xa9059cbb")).toBe(true);
    expect(structured.simulation.assetChanges[0]?.symbol).toBe("USDC");
    expect(structured.simulation.assetChanges[0]?.delta).toBe("-10000000");
  });

  test("rejects when caller is unauthenticated", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      transferTool,
      { to: "0xabababababababababababababababababababab", amount: "1" },
      ctx,
    );
    expect(res.isError).toBe(true);
  });

  test("honours ttl_seconds when building the stored request", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      transferTool,
      {
        to: "0xabababababababababababababababababababab",
        amount: "0.01",
        ttl_seconds: 60,
      },
      ctx,
      authedInfo,
    );
    const { request_id } = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(request_id);
    expect(stored).not.toBeNull();
    expect(stored!.expiresAt - stored!.createdAt).toBeCloseTo(60_000, -2);
  });
});
