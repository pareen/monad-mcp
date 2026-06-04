import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import { payForServiceTool } from "../../src/tools/x402.js";
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

function makeAuthMock(signature: `0x${string}` = "0xdeadbeef") {
  return {
    resolveUser: vi.fn(async () => ({ userId, walletAddress, walletId })),
    signTypedData: vi.fn(async () => signature),
    sendTransaction: vi.fn(),
  } as never;
}

describe("pay_for_service tool", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("passes through 200 responses without paying", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "hello world",
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" }, auth: makeAuthMock() });
    const res = await runTool(
      payForServiceTool,
      { url: "https://example.com/free", max_amount_usdc: "0.10" },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { paid: boolean };
    expect(s.paid).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects when no acceptable payment terms match", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "",
      json: async () => ({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "ethereum", // wrong network
            maxAmountRequired: "1000",
            resource: "https://example.com/paid",
            asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
            payTo: "0xabababababababababababababababababababab",
            maxTimeoutSeconds: 60,
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" }, auth: makeAuthMock() });
    const res = await runTool(
      payForServiceTool,
      { url: "https://example.com/paid", max_amount_usdc: "0.10" },
      ctx,
      authedInfo,
    );
    expect((res.structuredContent as { rejected_reason: string }).rejected_reason).toBe(
      "no_acceptable_terms",
    );
  });

  test("rejects when required amount exceeds caller's max", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "",
      json: async () => ({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "monad",
            maxAmountRequired: "10000000", // $10 USDC
            resource: "https://example.com/paid",
            asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
            payTo: "0xabababababababababababababababababababab",
            maxTimeoutSeconds: 60,
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" }, auth: makeAuthMock() });
    const res = await runTool(
      payForServiceTool,
      { url: "https://example.com/paid", max_amount_usdc: "0.10" }, // 100000 raw, well below 10M
      ctx,
      authedInfo,
    );
    expect((res.structuredContent as { rejected_reason: string }).rejected_reason).toBe(
      "no_acceptable_terms",
    );
  });

  test("signs and retries when terms are acceptable", async () => {
    // First call: 402 with valid terms
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "",
      json: async () => ({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "monad",
            maxAmountRequired: "50000", // $0.05 USDC raw
            resource: "https://example.com/paid",
            asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
            payTo: "0xabababababababababababababababababababab",
            maxTimeoutSeconds: 60,
          },
        ],
      }),
    } as never);
    // Second call: 200 with the resource
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "the paid content",
    } as never);

    const auth = makeAuthMock("0xfeedbeef" as `0x${string}`);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" }, auth });
    const res = await runTool(
      payForServiceTool,
      { url: "https://example.com/paid", max_amount_usdc: "0.10" },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as {
      paid: boolean;
      body: string;
      payment: { amount_raw: string; pay_to: string };
    };
    expect(s.paid).toBe(true);
    expect(s.body).toBe("the paid content");
    expect(s.payment.amount_raw).toBe("50000");
    expect(s.payment.pay_to).toBe("0xabababababababababababababababababababab");

    // Second fetch should include the X-PAYMENT header
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1]!;
    const init = secondCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-PAYMENT"]).toBeDefined();
    const decoded = JSON.parse(Buffer.from(headers["X-PAYMENT"]!, "base64").toString());
    expect(decoded.scheme).toBe("exact");
    expect(decoded.payload.signature).toBe("0xfeedbeef");
  });
});
