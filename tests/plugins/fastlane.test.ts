import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { fastlaneAddressesFor } from "../../src/plugins/fastlane/config.js";
import {
  fastlanePositionTool,
  fastlaneStakeTool,
  fastlaneUnstakeTool,
} from "../../src/plugins/fastlane/tools.js";
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

describe("FastLane shMONAD plugin", () => {
  test("default mainnet vault is the verified shMONAD address", () => {
    expect(fastlaneAddressesFor("mainnet").vault).toBe(
      "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
    );
  });

  test("fastlane_stake builds a payable deposit call with value = amount", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(fastlaneStakeTool, { amount_mon: "2" }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string; vault: `0x${string}` };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("2000000000000000000");
    expect(stored?.call.to).toBe(fastlaneAddressesFor("mainnet").vault);
    // deposit(uint256,address) selector
    expect(stored?.call.data.startsWith("0x6e553f65")).toBe(true);
  });

  test("fastlane_unstake builds a synchronous redeem call (value 0)", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(fastlaneUnstakeTool, { shares: "1" }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("0");
    expect(stored?.call.data.length).toBeGreaterThan(10);
  });

  test("fastlane_position formats shMON balance + share price + TVL", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 3_000_000_000_000_000_000n; // 3 shMON
      if (functionName === "convertToAssets") return 1_050_000_000_000_000_000n; // 1.05 MON/shMON
      if (functionName === "totalAssets") return 500_000_000_000_000_000_000n; // 500 MON TVL
      return 0n;
    });
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      fastlanePositionTool,
      { address: "0xabababababababababababababababababababab" },
      ctx,
    );
    const s = res.structuredContent as {
      share_balance_wei: string;
      underlying_wei: string;
      total_assets_wei: string;
    };
    expect(s.share_balance_wei).toBe("3000000000000000000");
    expect(s.underlying_wei).toBe("3150000000000000000"); // 3 * 1.05
    expect(s.total_assets_wei).toBe("500000000000000000000");
  });
});
