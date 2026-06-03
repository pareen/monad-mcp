import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findCanonicalToken } from "../../src/tokens/canonical.js";
import { runTool } from "../../src/tools/registry.js";
import {
  getTokenPriceTool,
  listCanonicalTokensTool,
  resolveTokenTool,
} from "../../src/tools/tokens.js";
import { makeTestContext } from "../helpers/context.js";

describe("canonical token registry", () => {
  test("matches by uppercase symbol", () => {
    const t = findCanonicalToken("usdc", "mainnet");
    expect(t?.symbol).toBe("USDC");
    expect(t?.address).toMatch(/^0x/);
  });

  test("matches by name substring", () => {
    // Monad's canonical Tether is USDT0; "tether" stays an alias.
    const t = findCanonicalToken("Tether", "mainnet");
    expect(t?.symbol).toBe("USDT0");
  });

  test("passes raw addresses through", () => {
    const addr = "0x1234567890123456789012345678901234567890";
    const t = findCanonicalToken(addr, "mainnet");
    expect(t?.address.toLowerCase()).toBe(addr);
  });

  test("returns null for unknown symbols on testnet", () => {
    expect(findCanonicalToken("USDC", "testnet")).toBeNull();
  });
});

describe("resolve_token tool", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("returns the canonical entry without hitting DexScreener", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(resolveTokenTool, { query: "USDC" }, ctx);
    const s = res.structuredContent as { source: string; symbol: string };
    expect(s.source).toBe("canonical");
    expect(s.symbol).toBe("USDC");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("falls back to DexScreener for non-canonical names on mainnet", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        pairs: [
          {
            chainId: "monad",
            dexId: "uniswap",
            pairAddress: "0xpair1",
            baseToken: {
              address: "0xnewtoken",
              name: "Cool Memecoin",
              symbol: "COOL",
            },
            quoteToken: { address: "0xq", name: "USDC", symbol: "USDC" },
            liquidity: { usd: 50000 },
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(resolveTokenTool, { query: "COOL" }, ctx);
    const s = res.structuredContent as {
      source: string;
      matches: Array<{ symbol: string }>;
    };
    expect(s.source).toBe("dexscreener");
    expect(s.matches[0]?.symbol).toBe("COOL");
  });
});

describe("get_token_price tool", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("returns price for the deepest-liquidity pair on Monad", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        pairs: [
          {
            chainId: "monad",
            dexId: "uniswap",
            pairAddress: "0xpairA",
            baseToken: { address: "0xtok", name: "Tok", symbol: "TOK" },
            quoteToken: { address: "0xusdc", name: "USDC", symbol: "USDC" },
            priceUsd: "1.23",
            liquidity: { usd: 100000 },
            volume: { h24: 5000 },
          },
          {
            chainId: "monad",
            dexId: "kuru",
            pairAddress: "0xpairB",
            baseToken: { address: "0xtok", name: "Tok", symbol: "TOK" },
            quoteToken: { address: "0xmon", name: "Monad", symbol: "MON" },
            priceUsd: "1.20",
            liquidity: { usd: 20000 },
          },
          {
            chainId: "base",
            dexId: "aerodrome",
            pairAddress: "0xpairC",
            baseToken: { address: "0xtok", name: "Tok", symbol: "TOK" },
            quoteToken: { address: "0xusdc", name: "USDC", symbol: "USDC" },
            priceUsd: "9.99",
            liquidity: { usd: 1_000_000 },
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(
      getTokenPriceTool,
      { token: "0xcccccccccccccccccccccccccccccccccccccccc" },
      ctx,
    );
    const s = res.structuredContent as { price_usd: string; dex: string };
    expect(s.price_usd).toBe("1.23"); // mainnet uniswap pair has deepest Monad liquidity
    expect(s.dex).toBe("uniswap");
  });

  test("rejects testnet (no price feed)", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      getTokenPriceTool,
      { token: "0xcccccccccccccccccccccccccccccccccccccccc" },
      ctx,
    );
    expect((res.structuredContent as { error: string }).error).toBe("testnet_unsupported");
  });
});

describe("list_canonical_tokens tool", () => {
  test("lists mainnet canonical tokens including MON and USDC", async () => {
    const ctx = makeTestContext({ config: { defaultNetwork: "mainnet" } });
    const res = await runTool(listCanonicalTokensTool, {}, ctx);
    const s = res.structuredContent as { tokens: Array<{ symbol: string }> };
    const symbols = s.tokens.map((t) => t.symbol);
    expect(symbols).toContain("MON");
    expect(symbols).toContain("USDC");
    expect(symbols).toContain("sMON");
  });
});
