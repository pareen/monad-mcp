import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import { resolveNameTool } from "../../src/tools/resolve-name.js";
import { makeTestContext } from "../helpers/context.js";

const KEONE = "0x771cda7e3786979d8fded8d4c22cd42f7b576dd4";

describe("resolve_name tool", () => {
  const originalResolver = process.env.MONAD_NAME_SERVICE_RESOLVER;
  beforeEach(() => {
    // biome-ignore lint/performance/noDelete: must truly unset, not set to "undefined"
    delete process.env.MONAD_NAME_SERVICE_RESOLVER;
  });
  afterEach(() => {
    if (originalResolver) process.env.MONAD_NAME_SERVICE_RESOLVER = originalResolver;
  });

  test("passes a 0x address through when it has no primary .nad name", async () => {
    // Default stub readContract returns 0n, so reverse resolution yields nothing.
    const ctx = makeTestContext();
    const res = await runTool(
      resolveNameTool,
      { query: "0xabababababababababababababababababababab" },
      ctx,
    );
    const s = res.structuredContent as { source: string; address: string };
    expect(s.source).toBe("passthrough");
    expect(s.address).toBe("0xabababababababababababababababababababab");
  });

  test("reverse-resolves a 0x address to its primary .nad name", async () => {
    const ctx = makeTestContext({
      publicClient: { readContract: vi.fn(async () => "keone") as never },
    });
    const res = await runTool(resolveNameTool, { query: KEONE }, ctx);
    const s = res.structuredContent as { source: string; name: string };
    expect(s.source).toBe("nns_reverse");
    expect(s.name).toBe("keone.nad");
  });

  test("forward-resolves a .nad name via NNS", async () => {
    const ctx = makeTestContext({
      publicClient: {
        readContract: vi.fn(async () => "0x771CdA7e3786979d8fDed8d4c22Cd42F7B576dD4") as never,
      },
    });
    const res = await runTool(resolveNameTool, { query: "keone.nad" }, ctx);
    const s = res.structuredContent as { source: string; address: string };
    expect(s.source).toBe("nns");
    expect(s.address).toBe(KEONE);
  });

  test("reports no record for an unregistered .nad name", async () => {
    const ctx = makeTestContext({
      publicClient: {
        readContract: vi.fn(async () => "0x0000000000000000000000000000000000000000") as never,
      },
    });
    const res = await runTool(resolveNameTool, { query: "ghost.nad" }, ctx);
    expect((res.structuredContent as { source: string }).source).toBe("nns_no_record");
  });

  test("returns no_resolver for a non-.nad name with no env resolver", async () => {
    const ctx = makeTestContext();
    const res = await runTool(resolveNameTool, { query: "pareen.mon" }, ctx);
    expect((res.structuredContent as { source: string }).source).toBe("no_resolver");
  });

  test("falls back to the env resolver addr(node) for non-.nad names", async () => {
    process.env.MONAD_NAME_SERVICE_RESOLVER = "0x9999999999999999999999999999999999999999";
    const readContract = vi.fn(async () => "0xcccccccccccccccccccccccccccccccccccccccc");
    const ctx = makeTestContext({ publicClient: { readContract: readContract as never } });
    const res = await runTool(resolveNameTool, { query: "pareen.mon" }, ctx);
    const s = res.structuredContent as { source: string; address: string };
    expect(s.source).toBe("resolver");
    expect(s.address.toLowerCase()).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
  });
});
