import { http, createPublicClient } from "viem";
import { describe, expect, test } from "vitest";
import { monadMainnet } from "../../src/chains/monad.js";
import { canonicalTokensFor } from "../../src/tokens/canonical.js";

// Regression: the mainnet canonical token registry once held WMON/USDC/USDT/WETH
// addresses that hosted no contract on Monad mainnet (chainId 143), so
// list_canonical_tokens / resolve_token handed agents dead addresses. This test
// reads symbol + decimals from each live contract and asserts they match the
// registry, so a wrong/undeployed address fails CI. Verified addresses found by
// /qa on 2026-06-03. Opt-out with SKIP_RPC_TESTS=1 (e.g. offline CI).
const run = process.env.SKIP_RPC_TESTS ? describe.skip : describe;

const erc20 = [
  {
    type: "function",
    stateMutability: "view",
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    stateMutability: "view",
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
  },
] as const;

const client = createPublicClient({
  chain: monadMainnet,
  transport: http(monadMainnet.rpcUrls.default.http[0]),
});

const tokens = Object.values(canonicalTokensFor("mainnet")).filter((t) => t.address !== "native");

run("integration: mainnet canonical token addresses are live ERC-20s", () => {
  for (const token of tokens) {
    test(`${token.symbol} (${token.address}) has matching code, symbol, decimals`, async () => {
      const address = token.address as `0x${string}`;

      const code = await client.getCode({ address });
      expect(code, `${token.symbol} has no contract code on mainnet`).toBeDefined();
      expect(code).not.toBe("0x");

      const [symbol, decimals] = await Promise.all([
        client.readContract({ address, abi: erc20, functionName: "symbol" }),
        client.readContract({ address, abi: erc20, functionName: "decimals" }),
      ]);

      expect(String(symbol).toUpperCase()).toBe(token.symbol.toUpperCase());
      expect(Number(decimals)).toBe(token.decimals);
    });
  }
});
