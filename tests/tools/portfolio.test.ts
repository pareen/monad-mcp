import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getPortfolioTool } from "../../src/tools/portfolio.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

function mockDexPair(symbol: string, address: string, priceUsd: string, liqUsd: number) {
  return {
    chainId: "monad",
    dexId: "uniswap",
    pairAddress: `0xpair-${symbol}`,
    baseToken: { address, name: symbol, symbol },
    quoteToken: { address: "0xq", name: "USDC", symbol: "USDC" },
    priceUsd,
    liquidity: { usd: liqUsd },
    volume: { h24: 1000 },
  };
}

describe("get_portfolio tool", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        pairs: [mockDexPair("?", "0x0", "1.00", 10000)],
      }),
    } as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("hides zero balances by default", async () => {
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getBalance: vi.fn(async () => 0n) as never,
        readContract: vi.fn(async () => 0n) as never,
      },
    });
    const res = await runTool(
      getPortfolioTool,
      { address: "0x1111111111111111111111111111111111111111" },
      ctx,
    );
    const s = res.structuredContent as {
      holdings: Array<{ symbol: string }>;
      total_value_usd: number;
    };
    expect(s.holdings).toEqual([]);
    expect(s.total_value_usd).toBe(0);
  });

  test("totalizes mixed native + ERC-20 balances at USD prices", async () => {
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getBalance: vi.fn(async () => 2_000_000_000_000_000_000n) as never, // 2 MON
        readContract: vi.fn(async (params: { address: string }) => {
          // USDC at 1_000_000 (= 1.00 with 6 decimals)
          if (params.address.toLowerCase() === "0xf817257fed379853cde0fa4f97ab987181b1e5ea") {
            return 1_000_000n;
          }
          return 0n;
        }) as never,
      },
    });
    const res = await runTool(
      getPortfolioTool,
      { address: "0x1111111111111111111111111111111111111111" },
      ctx,
    );
    const s = res.structuredContent as {
      holdings: Array<{ symbol: string; value_usd: number | null }>;
      total_value_usd: number;
    };
    const symbols = s.holdings.map((h) => h.symbol);
    expect(symbols).toContain("MON");
    expect(symbols).toContain("USDC");
    expect(s.total_value_usd).toBeGreaterThan(0);
  });

  test("include_zero=true returns all canonical tokens", async () => {
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getBalance: vi.fn(async () => 0n) as never,
        readContract: vi.fn(async () => 0n) as never,
      },
    });
    const res = await runTool(
      getPortfolioTool,
      { address: "0x1111111111111111111111111111111111111111", include_zero: true },
      ctx,
    );
    const s = res.structuredContent as { holdings: Array<{ symbol: string }> };
    expect(s.holdings.length).toBeGreaterThan(3); // MON + WMON + USDC + ...
  });
});
