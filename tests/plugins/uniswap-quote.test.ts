import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { uniswapQuoteTool } from "../../src/plugins/uniswap/quote.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

const ROUTER = "0x9999999999999999999999999999999999999999";
const QUOTER = "0x8888888888888888888888888888888888888888";

describe("uniswap_quote tool", () => {
  beforeEach(() => {
    process.env.UNISWAP_TESTNET_QUOTER_V2 = QUOTER;
    process.env.UNISWAP_TESTNET_SWAP_ROUTER_02 = ROUTER;
  });
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must truly unset, not set to "undefined"
    delete process.env.UNISWAP_TESTNET_QUOTER_V2;
    // biome-ignore lint/performance/noDelete: must truly unset, not set to "undefined"
    delete process.env.UNISWAP_TESTNET_SWAP_ROUTER_02;
  });

  test("returns the best fee tier from a quote sweep", async () => {
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "decimals") return 18;
      if (args.functionName === "symbol") return "MON";
      return 0n;
    });
    // 0.05% tier wins
    const simulateContract = vi.fn(async (args: { args: [{ fee: number }] }) => {
      const fee = args.args[0].fee;
      if (fee === 500) return { result: [2_000n, 0n, 0, 50_000n] };
      if (fee === 3000) return { result: [1_500n, 0n, 0, 50_000n] };
      throw new Error("no pool");
    });
    const ctx = makeTestContext({
      publicClient: {
        readContract: readContract as never,
        simulateContract: simulateContract as never,
      },
    });
    const res = await runTool(
      uniswapQuoteTool,
      {
        token_in: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token_out: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        amount_in: "1",
      },
      ctx,
    );
    const structured = res.structuredContent as {
      best: { fee: number; amount_out: string };
    };
    expect(structured.best.fee).toBe(500);
    expect(structured.best.amount_out).toBe("2000");
  });

  test("reports no pools when every fee tier reverts", async () => {
    const ctx = makeTestContext({
      publicClient: {
        readContract: vi.fn(async (args: { functionName: string }) =>
          args.functionName === "decimals" ? 18 : "X",
        ) as unknown as never,
        simulateContract: vi.fn(async () => {
          throw new Error("no pool");
        }) as never,
      },
    });
    const res = await runTool(
      uniswapQuoteTool,
      {
        token_in: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token_out: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        amount_in: "1",
      },
      ctx,
    );
    expect(res.content[0]?.text).toMatch(/No Uniswap v3 pool/);
  });

  test("errors clearly when addresses not configured", async () => {
    // biome-ignore lint/performance/noDelete: must truly unset, not set to "undefined"
    delete process.env.UNISWAP_TESTNET_QUOTER_V2;
    const ctx = makeTestContext();
    const res = await runTool(
      uniswapQuoteTool,
      {
        token_in: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token_out: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        amount_in: "1",
      },
      ctx,
    );
    expect(res.content[0]?.text).toMatch(/not configured/);
  });
});
