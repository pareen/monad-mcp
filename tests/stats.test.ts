import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ServerContext } from "../src/context.js";
import { statsRouter } from "../src/stats/routes.js";
import { makeTestContext } from "./helpers/context.js";

describe("stats routes", () => {
  let server: Server;
  let base: string;
  let ctx: ServerContext;

  function start(context: ServerContext): Promise<void> {
    const app = express();
    app.use(statsRouter(context));
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  beforeEach(async () => {
    ctx = makeTestContext();
    await start(ctx);
  });

  afterEach(() => {
    server?.close();
  });

  test("GET /stats.json returns a zeroed summary on a fresh server", async () => {
    const res = await fetch(`${base}/stats.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.totals.calls).toBe(0);
    expect(body.windowDays).toBe(30);
    expect(body.daily).toHaveLength(30);
  });

  test("GET /stats.json reflects recorded usage and respects ?days", async () => {
    await ctx.usage.record({
      tool: "get_balance",
      kind: "read",
      network: "testnet",
      authed: false,
      ok: true,
    });
    await ctx.usage.record({
      tool: "transfer",
      kind: "write",
      network: "mainnet",
      authed: true,
      ok: false,
    });

    const res = await fetch(`${base}/stats.json?days=7`);
    const body = await res.json();
    expect(body.totals.calls).toBe(2);
    expect(body.totals.writes).toBe(1);
    expect(body.totals.errors).toBe(1);
    expect(body.windowDays).toBe(7);
    expect(body.daily).toHaveLength(7);
    expect(body.byTool.map((t: { tool: string }) => t.tool).sort()).toEqual([
      "get_balance",
      "transfer",
    ]);
  });

  test("GET /stats.json clamps absurd window values", async () => {
    const res = await fetch(`${base}/stats.json?days=999999`);
    const body = await res.json();
    expect(body.windowDays).toBe(365);
  });

  test("GET /stats serves a self-contained HTML page", async () => {
    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("monad-mcp usage");
    expect(html).toContain("/stats.json");
    // No external script/style dependencies — fully inline.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });
});
