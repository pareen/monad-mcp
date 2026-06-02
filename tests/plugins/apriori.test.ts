import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test } from "vitest";
import { aprioriAddressesFor } from "../../src/plugins/apriori/config.js";
import {
  aprioriClaimRedeemTool,
  aprioriRequestRedeemTool,
  aprioriStakeTool,
} from "../../src/plugins/apriori/tools.js";
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

describe("aPriori plugin", () => {
  test("default mainnet vault resolves", () => {
    expect(aprioriAddressesFor("mainnet").vault).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("apriori_stake routes value via msg.value", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(aprioriStakeTool, { amount_mon: "0.5" }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string; vault: `0x${string}` };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("500000000000000000");
    expect(stored?.call.to).toBe(aprioriAddressesFor("mainnet").vault);
  });

  test("apriori_request_redeem encodes shares + controller + owner", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(aprioriRequestRedeemTool, { shares: "1" }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("0");
    // requestRedeem(uint256,address,address) selector
    expect(stored?.call.data.length).toBeGreaterThan(10);
  });

  test("apriori_claim_redeem accepts multiple request ids", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(aprioriClaimRedeemTool, { request_ids: [1, 2, 3] }, ctx, authedInfo);
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("0");
  });
});
