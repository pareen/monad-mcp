import { describe, expect, test } from "vitest";
import {
  MONAD_MAINNET_ID,
  MONAD_TESTNET_ID,
  chainFor,
  isMonadChainId,
  monadMainnet,
  monadTestnet,
  networkForChainId,
} from "../src/chains/monad.js";

describe("monad chain config", () => {
  test("chain ids match the canonical Monad assignments", () => {
    expect(MONAD_MAINNET_ID).toBe(143);
    expect(MONAD_TESTNET_ID).toBe(10143);
    expect(monadMainnet.id).toBe(143);
    expect(monadTestnet.id).toBe(10143);
    expect(monadMainnet.testnet).toBe(false);
    expect(monadTestnet.testnet).toBe(true);
  });

  test("chainFor selects by network name", () => {
    expect(chainFor("mainnet").id).toBe(143);
    expect(chainFor("testnet").id).toBe(10143);
  });

  test("isMonadChainId narrows correctly", () => {
    expect(isMonadChainId(143)).toBe(true);
    expect(isMonadChainId(10143)).toBe(true);
    expect(isMonadChainId(1)).toBe(false);
    expect(isMonadChainId(8453)).toBe(false);
  });

  test("networkForChainId reverses the mapping", () => {
    expect(networkForChainId(143)).toBe("mainnet");
    expect(networkForChainId(10143)).toBe("testnet");
    expect(() => networkForChainId(1)).toThrow();
  });

  test("native currency is MON with 18 decimals", () => {
    expect(monadMainnet.nativeCurrency).toEqual({ name: "Monad", symbol: "MON", decimals: 18 });
    expect(monadTestnet.nativeCurrency).toEqual({ name: "Monad", symbol: "MON", decimals: 18 });
  });

  // Regression: ISSUE-001 — the mainnet block explorer pointed at
  // https://explorer.monad.xyz, a domain that does not resolve (NXDOMAIN),
  // so every mainnet explorer_url across the read/write tools was a dead link.
  // The live explorer is the monadexplorer.com family (testnet uses the
  // testnet. subdomain). Found by /qa on 2026-06-03.
  test("block explorers point at the live monadexplorer.com family, not the dead domain", () => {
    expect(monadMainnet.blockExplorers?.default.url).toBe("https://monadexplorer.com");
    expect(monadTestnet.blockExplorers?.default.url).toBe("https://testnet.monadexplorer.com");
    for (const chain of [monadMainnet, monadTestnet]) {
      expect(chain.blockExplorers?.default.url).not.toContain("explorer.monad.xyz");
    }
  });
});
