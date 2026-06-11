import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { createHttpApp } from "../src/server-http.js";
import { makeTestContext } from "./helpers/context.js";

describe("HTTP root page", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function start(): Promise<string> {
    const app = createHttpApp(makeTestContext());
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        resolve(`http://127.0.0.1:${(server?.address() as AddressInfo).port}`);
      });
    });
  }

  test("serves a usable status page at the HTTP root", async () => {
    // Regression: ISSUE-001 - HTTP root showed Express's raw 404 page.
    // Found by /qa on 2026-06-04
    // Report: .gstack/qa-reports/qa-report-localhost-2026-06-04.md
    const base = await start();
    const res = await fetch(`${base}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("monad-mcp");
    expect(html).toContain("HTTP MCP endpoint for Monad tools.");
    expect(html).toContain("/mcp");
    expect(html).toContain("/health");
  });

  test("reports the package version in health metadata", async () => {
    const base = await start();
    const res = await fetch(`${base}/health`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ version: pkg.version });
  });
});
