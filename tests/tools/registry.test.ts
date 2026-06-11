import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { type ToolDefinition, runTool } from "../../src/tools/registry.js";
import { makeTestContext } from "../helpers/context.js";

const echoShape = { msg: z.string() };
const echoTool: ToolDefinition<typeof echoShape> = {
  name: "echo",
  description: "echoes msg",
  kind: "read",
  inputSchema: echoShape,
  handler: async (args) => ({ text: `echo:${args.msg}`, structured: { msg: args.msg } }),
};

const writeShape = { x: z.string() };
const writeTool: ToolDefinition<typeof writeShape> = {
  name: "do_write",
  description: "requires auth",
  kind: "write",
  inputSchema: writeShape,
  handler: async (args, ctx) => ({
    text: `wrote ${args.x} for ${ctx.walletAddress}`,
  }),
};

const authedInfo: AuthInfo = {
  token: "tok",
  clientId: "did:privy:user1",
  scopes: ["monad:read", "monad:write"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: {
    userId: "did:privy:user1",
    sessionId: "sess",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletId: "wallet_1",
  },
};

describe("runTool", () => {
  test("read tool runs without auth and returns text content", async () => {
    const ctx = makeTestContext();
    const res = await runTool(echoTool, { msg: "hi" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toBe("echo:hi");
    expect(res.structuredContent).toEqual({ msg: "hi" });
  });

  test("write tool errors when no auth info", async () => {
    const ctx = makeTestContext();
    const res = await runTool(writeTool, { x: "y" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/auth_required/);
  });

  test("write tool errors when auth has no wallet", async () => {
    const ctx = makeTestContext();
    const noWalletAuth: AuthInfo = {
      ...authedInfo,
      extra: { ...authedInfo.extra!, walletAddress: null, walletId: null },
    };
    const res = await runTool(writeTool, { x: "y" }, ctx, noWalletAuth);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/wallet_not_found/);
  });

  test("write tool succeeds when authed with a wallet", async () => {
    const ctx = makeTestContext();
    const res = await runTool(writeTool, { x: "y" }, ctx, authedInfo);
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("0x1111111111111111111111111111111111111111");
  });

  test("invalid input is rejected before the handler runs", async () => {
    const ctx = makeTestContext();
    const res = await runTool(echoTool, { msg: 123 }, ctx);
    expect(res.isError).toBe(true);
  });

  test("records a successful anonymous read call", async () => {
    const ctx = makeTestContext();
    await runTool(echoTool, { msg: "hi" }, ctx);
    const s = await ctx.usage.summary();
    expect(s.totals.calls).toBe(1);
    expect(s.totals.ok).toBe(1);
    expect(s.totals.reads).toBe(1);
    expect(s.totals.anonymous).toBe(1);
    expect(s.byTool[0]).toMatchObject({ tool: "echo", kind: "read", calls: 1, ok: 1 });
  });

  test("records a failed call as an error (write without auth)", async () => {
    const ctx = makeTestContext();
    await runTool(writeTool, { x: "y" }, ctx);
    const s = await ctx.usage.summary();
    expect(s.totals.calls).toBe(1);
    expect(s.totals.errors).toBe(1);
    expect(s.totals.writes).toBe(1);
    expect(s.totals.successRate).toBe(0);
  });

  test("records an authed write as authed + ok", async () => {
    const ctx = makeTestContext();
    await runTool(writeTool, { x: "y" }, ctx, authedInfo);
    const s = await ctx.usage.summary();
    expect(s.totals.authed).toBe(1);
    expect(s.totals.ok).toBe(1);
    expect(s.totals.writes).toBe(1);
  });

  test("records even when input validation fails", async () => {
    const ctx = makeTestContext();
    await runTool(echoTool, { msg: 123 }, ctx);
    const s = await ctx.usage.summary();
    expect(s.totals.calls).toBe(1);
    expect(s.totals.errors).toBe(1);
  });

  test("network defaults to server config when arg is omitted", async () => {
    const seen: Array<string> = [];
    const sniffShape = { network: z.enum(["mainnet", "testnet"]).optional() };
    const sniff: ToolDefinition<typeof sniffShape> = {
      name: "sniff",
      description: "",
      kind: "read",
      inputSchema: sniffShape,
      handler: async (_a, c) => {
        seen.push(c.network);
        return { text: c.network };
      },
    };
    const ctx = makeTestContext();
    await runTool(sniff, {}, ctx);
    await runTool(sniff, { network: "mainnet" }, ctx);
    expect(seen).toEqual(["testnet", "mainnet"]);
  });
});
