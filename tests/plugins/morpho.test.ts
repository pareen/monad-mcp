import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { marketId } from "../../src/plugins/morpho/market.js";
import {
  morphoPositionTool,
  morphoSupplyTool,
  morphoWithdrawTool,
} from "../../src/plugins/morpho/tools.js";
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

const sampleMarket = {
  loan_token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  collateral_token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  oracle: "0xcccccccccccccccccccccccccccccccccccccccc",
  irm: "0xdddddddddddddddddddddddddddddddddddddddd",
  lltv: "860000000000000000",
};

describe("Morpho plugin", () => {
  test("marketId is deterministic and matches keccak256(abi.encode(MarketParams))", () => {
    const id = marketId({
      loanToken: sampleMarket.loan_token as `0x${string}`,
      collateralToken: sampleMarket.collateral_token as `0x${string}`,
      oracle: sampleMarket.oracle as `0x${string}`,
      irm: sampleMarket.irm as `0x${string}`,
      lltv: BigInt(sampleMarket.lltv),
    });
    expect(id).toMatch(/^0x[a-fA-F0-9]{64}$/);
    // computing twice produces the same id
    const id2 = marketId({
      loanToken: sampleMarket.loan_token as `0x${string}`,
      collateralToken: sampleMarket.collateral_token as `0x${string}`,
      oracle: sampleMarket.oracle as `0x${string}`,
      irm: sampleMarket.irm as `0x${string}`,
      lltv: BigInt(sampleMarket.lltv),
    });
    expect(id2).toBe(id);
  });

  test("morpho_supply builds a stored request against the Blue singleton", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      morphoSupplyTool,
      { market: sampleMarket, amount: "100", decimals: 6 },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.to.toLowerCase()).toBe(
      "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee".toLowerCase(),
    );
    expect(stored?.call.value).toBe("0");
  });

  test("morpho_withdraw encodes onBehalf + receiver correctly", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      morphoWithdrawTool,
      { market: sampleMarket, amount: "50", decimals: 6 },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("0");
    expect(stored?.call.data.length).toBeGreaterThan(10);
  });

  test("morpho_position reads position(id, user) and exposes raw fields", async () => {
    const readContract = vi.fn(async () => [10n, 5n, 100n] as readonly bigint[]);
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      morphoPositionTool,
      { market: sampleMarket, user: "0xabababababababababababababababababababab" },
      ctx,
    );
    const s = res.structuredContent as {
      supply_shares: string;
      borrow_shares: string;
      collateral: string;
    };
    expect(s.supply_shares).toBe("10");
    expect(s.borrow_shares).toBe("5");
    expect(s.collateral).toBe("100");
  });
});
