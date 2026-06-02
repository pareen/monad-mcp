import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import { resolveNameTool } from "../../src/tools/resolve-name.js";
import { makeTestContext } from "../helpers/context.js";

describe("resolve_name tool", () => {
  const originalResolver = process.env.MONAD_NAME_SERVICE_RESOLVER;
  beforeEach(() => {
    // biome-ignore lint/performance/noDelete: must truly unset, not set to "undefined"
    delete process.env.MONAD_NAME_SERVICE_RESOLVER;
  });
  afterEach(() => {
    if (originalResolver) process.env.MONAD_NAME_SERVICE_RESOLVER = originalResolver;
  });

  test("passes through 0x addresses", async () => {
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

  test("returns no_resolver when MNS isn't configured", async () => {
    const ctx = makeTestContext();
    const res = await runTool(resolveNameTool, { query: "pareen.mon" }, ctx);
    expect((res.structuredContent as { source: string }).source).toBe("no_resolver");
  });

  test("calls the resolver addr(node) when MNS is configured", async () => {
    process.env.MONAD_NAME_SERVICE_RESOLVER = "0x9999999999999999999999999999999999999999";
    const readContract = vi.fn(async () => "0xcccccccccccccccccccccccccccccccccccccccc");
    const ctx = makeTestContext({
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(resolveNameTool, { query: "pareen.mon" }, ctx);
    const s = res.structuredContent as { source: string; address: string };
    expect(s.source).toBe("mns");
    expect(s.address.toLowerCase()).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
  });
});
