import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { kintsuAddressesFor } from "../../src/plugins/kintsu/config.js";
import {
  kintsuPositionTool,
  kintsuRequestUnstakeTool,
  kintsuStakeTool,
} from "../../src/plugins/kintsu/tools.js";
import { runTool } from "../../src/tools/registry.js";
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

describe("Kintsu plugin", () => {
  test("default mainnet vault address resolves", () => {
    expect(kintsuAddressesFor("mainnet").vault).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("kintsu_stake builds a payable deposit call with value = amount", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(kintsuStakeTool, { amount_mon: "2" }, ctx, authedInfo);
    const s = res.structuredContent as {
      approval_url: string;
      request_id: string;
      vault: `0x${string}`;
    };
    expect(s.approval_url).toContain("/approve/");
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("2000000000000000000");
    expect(stored?.call.to).toBe(kintsuAddressesFor("mainnet").vault);
    expect(stored?.call.data.startsWith("0x")).toBe(true);
    // deposit(uint96,address) selector
    expect(stored?.call.data.slice(0, 10)).not.toBe("0x00000000");
  });

  test("kintsu_request_unstake builds a non-payable call", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(kintsuRequestUnstakeTool, { shares: "1" }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("0");
  });

  test("kintsu_position formats holder balance + share price", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 2_000_000_000_000_000_000n; // 2 sMON
      if (functionName === "convertToAssets") return 1_010_000_000_000_000_000n; // 1.01 MON / sMON
      if (functionName === "totalAssets") return 100_000_000_000_000_000_000n; // 100 MON TVL
      return 0n;
    });
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      kintsuPositionTool,
      { address: "0xabababababababababababababababababababab" },
      ctx,
    );
    const s = res.structuredContent as {
      share_balance_wei: string;
      underlying_wei: string;
      share_price_wei: string;
    };
    expect(s.share_balance_wei).toBe("2000000000000000000");
    expect(s.share_price_wei).toBe("1010000000000000000");
    expect(s.underlying_wei).toBe("2020000000000000000"); // 2 * 1.01
  });
});
