import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { checkTokenTool } from "../../src/tools/check-token.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

describe("check_token tool", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pairs: [] }),
    } as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("recognizes canonical USDC and reports info severity", async () => {
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getCode: vi.fn(async () => "0x6080") as never,
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "symbol") return "USDC";
          if (functionName === "decimals") return 6;
          return "X";
        }) as never,
      },
    });
    const res = await runTool(
      checkTokenTool,
      { token: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" },
      ctx,
    );
    const s = res.structuredContent as {
      is_canonical: boolean;
      canonical_symbol: string;
      risks: Array<{ code: string }>;
    };
    expect(s.is_canonical).toBe(true);
    expect(s.canonical_symbol).toBe("USDC");
    expect(s.risks.find((r) => r.code === "canonical_token")).toBeDefined();
  });

  test("flags EOA addresses (no bytecode) as danger", async () => {
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getCode: vi.fn(async () => "0x") as never,
        readContract: vi.fn(async () => {
          throw new Error("no contract");
        }) as never,
      },
    });
    const res = await runTool(
      checkTokenTool,
      { token: "0x9999999999999999999999999999999999999999" },
      ctx,
    );
    const s = res.structuredContent as {
      overall: string;
      risks: Array<{ code: string; severity: string }>;
    };
    expect(s.overall).toBe("danger");
    expect(s.risks.some((r) => r.code === "no_bytecode")).toBe(true);
  });

  test("warns on low DEX liquidity", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [
          {
            chainId: "monad",
            dexId: "uniswap",
            pairAddress: "0xpair",
            baseToken: { address: "0xtok", name: "T", symbol: "T" },
            quoteToken: { address: "0xq", name: "USDC", symbol: "USDC" },
            liquidity: { usd: 500 },
            pairCreatedAt: Date.now() - 30 * 86_400_000,
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getCode: vi.fn(async () => "0x6080") as never,
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "symbol") return "MEME";
          if (functionName === "decimals") return 18;
          return "X";
        }) as never,
      },
    });
    const res = await runTool(
      checkTokenTool,
      { token: "0x1234567890123456789012345678901234567890" },
      ctx,
    );
    const s = res.structuredContent as {
      overall: string;
      risks: Array<{ code: string }>;
    };
    expect(s.overall).toBe("warn");
    expect(s.risks.some((r) => r.code === "low_liquidity")).toBe(true);
  });

  test("flags newly-created pairs", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [
          {
            chainId: "monad",
            dexId: "uniswap",
            pairAddress: "0xpair",
            baseToken: { address: "0xtok", name: "T", symbol: "T" },
            quoteToken: { address: "0xq", name: "USDC", symbol: "USDC" },
            liquidity: { usd: 50_000 },
            pairCreatedAt: Date.now() - 2 * 86_400_000, // 2 days old
          },
        ],
      }),
    } as never);
    const ctx = makeTestContext({
      config: { defaultNetwork: "mainnet" },
      publicClient: {
        getCode: vi.fn(async () => "0x6080") as never,
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "symbol") return "NEW";
          if (functionName === "decimals") return 18;
          return "X";
        }) as never,
      },
    });
    const res = await runTool(
      checkTokenTool,
      { token: "0x1234567890123456789012345678901234567890" },
      ctx,
    );
    const s = res.structuredContent as { risks: Array<{ code: string }> };
    expect(s.risks.some((r) => r.code === "new_pair")).toBe(true);
  });
});
