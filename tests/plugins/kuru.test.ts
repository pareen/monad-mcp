import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import {
  KURU_MAINNET_MARKETS,
  kuruAddressesFor,
  resolveKuruMarket,
} from "../../src/plugins/kuru/config.js";
import {
  kuruBestBidAskTool,
  kuruCancelOrdersTool,
  kuruMarketSwapTool,
  kuruPlaceLimitTool,
} from "../../src/plugins/kuru/tools.js";
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

describe("Kuru plugin", () => {
  test("resolveKuruMarket accepts known name or raw address", () => {
    const a = kuruAddressesFor("mainnet");
    expect(resolveKuruMarket("MON/USDC", a)).toBe(KURU_MAINNET_MARKETS["MON/USDC"]);
    expect(resolveKuruMarket("0x065C9d28E428A0db40191a54d33d5b7c71a9C394", a)).toBe(
      "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
    );
    expect(resolveKuruMarket("UNKNOWN", a)).toBeNull();
  });

  test("kuru_best_bid_ask reads bestBidAsk on the market contract", async () => {
    const readContract = vi.fn(async () => [100, 105] as readonly number[]);
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(kuruBestBidAskTool, { market: "MON/USDC" }, ctx);
    const s = res.structuredContent as { best_bid: number; best_ask: number };
    expect(s.best_bid).toBe(100);
    expect(s.best_ask).toBe(105);
  });

  test("kuru_place_limit encodes addBuyOrder for side=buy", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      kuruPlaceLimitTool,
      { market: "MON/USDC", side: "buy", price: 100, size: "1000", post_only: true },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.to).toBe(KURU_MAINNET_MARKETS["MON/USDC"]);
    expect(stored?.call.data.length).toBeGreaterThan(10);
  });

  test("kuru_cancel_orders accepts a batch of ids", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      kuruCancelOrdersTool,
      { market: "MON/USDC", order_ids: [1, 2, 3] },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    expect(s.request_id).toBeDefined();
  });

  test("kuru_market_swap propagates value_wei for native-MON markets", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      kuruMarketSwapTool,
      { market: "MON/USDC", side: "buy", amount: "100", value_wei: "100" },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("100");
  });
});
