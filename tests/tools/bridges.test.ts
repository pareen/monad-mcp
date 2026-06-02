import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { bridgeExecuteTool, bridgeQuoteTool } from "../../src/tools/bridges.js";
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

describe("bridge tools", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("bridge_quote returns route metadata from LiFi", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        type: "lifi",
        tool: "stargate",
        toolDetails: { name: "Stargate" },
        action: {
          fromChainId: 8453,
          toChainId: 143,
          fromToken: { address: "0xUSDC_BASE", symbol: "USDC", decimals: 6 },
          toToken: { address: "0xUSDC_MONAD", symbol: "USDC", decimals: 6 },
          fromAmount: "10000000",
        },
        estimate: {
          fromAmount: "10000000",
          toAmount: "9950000",
          executionDuration: 120,
          feeCosts: [{ name: "stargate", amountUSD: "0.05" }],
          gasCosts: [{ amountUSD: "0.01" }],
        },
        transactionRequest: { to: "0xstargate", value: "0", data: "0xabcd" },
        includedSteps: [{ tool: "stargate", type: "cross" }],
      }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      bridgeQuoteTool,
      {
        from_chain_id: 8453,
        from_token: "0xUSDC_BASE",
        to_token: "0xUSDC_MONAD",
        amount: "10",
        from_decimals: 6,
        recipient: "0xabababababababababababababababababababab",
      },
      ctx,
    );
    const s = res.structuredContent as { provider: string; tool: string; to_amount: string };
    expect(s.provider).toBe("lifi");
    expect(s.tool).toBe("stargate");
    expect(s.to_amount).toBe("9950000");
  });

  test("bridge_quote surfaces no-route error from LiFi", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ message: "No available quotes for the requested route" }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      bridgeQuoteTool,
      {
        from_chain_id: 9999,
        from_token: "0x0000000000000000000000000000000000000000",
        to_token: "MON",
        amount: "1",
        recipient: "0xabababababababababababababababababababab",
      },
      ctx,
    );
    expect((res.structuredContent as { error: string }).error).toBe("no_route");
  });

  test("bridge_execute on a non-Monad source returns a manual-submit payload", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      bridgeExecuteTool,
      {
        to: "0xabababababababababababababababababababab",
        data: "0xdeadbeef",
        value_wei: "0",
        chain_id: 8453,
      },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { error: string; manual_submit: { to: string } };
    expect(s.error).toBe("source_chain_not_supported");
    expect(s.manual_submit.to).toBe("0xabababababababababababababababababababab");
  });

  test("bridge_execute on Monad chain id goes through the stored-request flow", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      bridgeExecuteTool,
      {
        to: "0xabababababababababababababababababababab",
        data: "0xdeadbeef",
        value_wei: "1000",
        chain_id: 143,
      },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id?: string; error?: string };
    expect(s.request_id).toBeDefined();
    expect(s.error).toBeUndefined();
  });
});
