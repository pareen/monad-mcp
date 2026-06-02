import { describe, expect, test } from "vitest";
import { pollRequestTool } from "../../src/tools/poll-request.js";
import { runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

const baseInput = {
  userId: "did:privy:user1",
  network: "testnet" as const,
  walletAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  summary: "test",
  call: {
    to: "0xabababababababababababababababababababab" as `0x${string}`,
    value: "0",
    data: "0x" as `0x${string}`,
  },
};

describe("poll_request tool", () => {
  test("reports pending when stored request is fresh", async () => {
    const ctx = makeTestContext();
    const r = await ctx.store.create(baseInput);
    const res = await runTool(pollRequestTool, { request_id: r.id }, ctx);
    expect(res.content[0]?.text).toMatch(/pending/);
  });

  test("returns tx hash on approved", async () => {
    const ctx = makeTestContext();
    const r = await ctx.store.create(baseInput);
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    await ctx.store.markApproved(r.id, hash);
    const res = await runTool(pollRequestTool, { request_id: r.id }, ctx);
    const structured = res.structuredContent as { tx_hash: string; status: string };
    expect(structured.tx_hash).toBe(hash);
    expect(structured.status).toBe("approved");
  });

  test("reports not_found for unknown id", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      pollRequestTool,
      { request_id: "00000000-0000-0000-0000-000000000000" },
      ctx,
    );
    expect((res.structuredContent as { status: string }).status).toBe("not_found");
  });
});
