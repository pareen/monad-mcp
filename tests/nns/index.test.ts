import type { PublicClient } from "viem";
import { describe, expect, test, vi } from "vitest";
import {
  isHexAddress,
  looksLikeNadName,
  nnsAddress,
  resolveNadName,
  resolveRecipient,
  reverseNadName,
} from "../../src/nns/index.js";

const KEONE = "0x771cda7e3786979d8fded8d4c22cd42f7b576dd4";

/** Build a stub PublicClient whose readContract dispatches by functionName. */
function stubClient(
  handlers: Partial<Record<"getResolvedAddress" | "getPrimaryNameForAddress", () => unknown>>,
): PublicClient {
  return {
    readContract: vi.fn(async (args: { functionName: string }) => {
      const fn = handlers[args.functionName as keyof typeof handlers];
      if (!fn) throw new Error(`unexpected functionName ${args.functionName}`);
      return fn();
    }),
  } as unknown as PublicClient;
}

describe("nns helpers", () => {
  test("isHexAddress", () => {
    expect(isHexAddress("0x771cda7e3786979d8fded8d4c22cd42f7b576dd4")).toBe(true);
    expect(isHexAddress("  0x771cda7e3786979d8fded8d4c22cd42f7b576dd4  ")).toBe(true);
    expect(isHexAddress("0x123")).toBe(false);
    expect(isHexAddress("keone.nad")).toBe(false);
  });

  test("looksLikeNadName", () => {
    expect(looksLikeNadName("keone.nad")).toBe(true);
    expect(looksLikeNadName("KEONE.NAD")).toBe(true);
    expect(looksLikeNadName("sub.keone.nad")).toBe(true);
    expect(looksLikeNadName(".nad")).toBe(false);
    expect(looksLikeNadName("keone.eth")).toBe(false);
    expect(looksLikeNadName("keone")).toBe(false);
    expect(looksLikeNadName("0xabc")).toBe(false);
  });

  test("nnsAddress is configured for mainnet", () => {
    expect(nnsAddress("mainnet")).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

describe("resolveNadName", () => {
  test("returns the lowercased address on a hit", async () => {
    const client = stubClient({
      getResolvedAddress: () => "0x771CdA7e3786979d8fDed8d4c22Cd42F7B576dD4",
    });
    expect(await resolveNadName(client, "mainnet", "keone.nad")).toBe(KEONE);
  });

  test("returns null for the zero address (unregistered)", async () => {
    const client = stubClient({
      getResolvedAddress: () => "0x0000000000000000000000000000000000000000",
    });
    expect(await resolveNadName(client, "mainnet", "nope.nad")).toBeNull();
  });

  test("returns null when the call reverts", async () => {
    const client = stubClient({
      getResolvedAddress: () => {
        throw new Error("reverted");
      },
    });
    expect(await resolveNadName(client, "mainnet", "keone.nad")).toBeNull();
  });
});

describe("reverseNadName", () => {
  test("appends the .nad TLD to the primary label", async () => {
    const client = stubClient({ getPrimaryNameForAddress: () => "keone" });
    expect(await reverseNadName(client, "mainnet", KEONE)).toBe("keone.nad");
  });

  test("does not double-append when the label already has the TLD", async () => {
    const client = stubClient({ getPrimaryNameForAddress: () => "keone.nad" });
    expect(await reverseNadName(client, "mainnet", KEONE)).toBe("keone.nad");
  });

  test("returns null for an empty primary name", async () => {
    const client = stubClient({ getPrimaryNameForAddress: () => "" });
    expect(await reverseNadName(client, "mainnet", KEONE)).toBeNull();
  });
});

describe("resolveRecipient", () => {
  test("passes through a 0x address (lowercased) without an RPC call", async () => {
    const client = stubClient({});
    const r = await resolveRecipient(
      client,
      "mainnet",
      "0x771CdA7e3786979d8fDed8d4c22Cd42F7B576dD4",
    );
    expect(r).toEqual({ address: KEONE, source: "address" });
  });

  test("resolves a .nad name and tags the source", async () => {
    const client = stubClient({
      getResolvedAddress: () => "0x771CdA7e3786979d8fDed8d4c22Cd42F7B576dD4",
    });
    const r = await resolveRecipient(client, "mainnet", "Keone.nad");
    expect(r).toEqual({ address: KEONE, name: "keone.nad", source: "nns" });
  });

  test("throws an actionable error when a .nad name has no record", async () => {
    const client = stubClient({
      getResolvedAddress: () => "0x0000000000000000000000000000000000000000",
    });
    await expect(resolveRecipient(client, "mainnet", "ghost.nad")).rejects.toThrow(/ghost\.nad/);
  });

  test("throws for input that is neither an address nor a .nad name", async () => {
    const client = stubClient({});
    await expect(resolveRecipient(client, "mainnet", "not-a-name")).rejects.toThrow(
      /0x address or a '\.nad' name/,
    );
  });
});
