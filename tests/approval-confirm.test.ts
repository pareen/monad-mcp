import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { approvalRouter } from "../src/approval/routes.js";
import type { ServerContext } from "../src/context.js";
import type { StoredRequest } from "../src/store/types.js";
import { makeTestContext } from "./helpers/context.js";

const SECRET = "test-secret-at-least-32-chars-long-aaaa";
const USER = "did:privy:user1";
const WALLET = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const TO = "0x771cda7e3786979d8fded8d4c22cd42f7b576dd4" as `0x${string}`;
const HASH = `0x${"a".repeat(64)}` as `0x${string}`;

/** A viem-shaped transaction matching the request below. */
function chainTx(over: Record<string, unknown> = {}) {
  return { from: WALLET, to: TO, value: 100000000000000000n, input: "0x", ...over };
}

async function makeRequest(
  ctx: ServerContext,
  over: Partial<Parameters<ServerContext["store"]["create"]>[0]> = {},
): Promise<StoredRequest> {
  return ctx.store.create({
    userId: USER,
    network: "testnet",
    walletAddress: WALLET,
    summary: "Send 0.1 MON",
    call: { to: TO, value: "100000000000000000", data: "0x" },
    ...over,
  });
}

describe("POST /api/stored-requests/:id/confirm", () => {
  let server: Server;
  let base: string;
  let ctx: ServerContext;

  function start(context: ServerContext): Promise<void> {
    ctx = context;
    const app = express();
    app.use(express.json());
    app.use(approvalRouter(ctx));
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  function ctxWith(over: Parameters<typeof makeTestContext>[0] = {}): ServerContext {
    return makeTestContext({
      config: { approvalSecret: SECRET, ...over.config },
      publicClient: { getTransaction: vi.fn(async () => chainTx()), ...over.publicClient },
      auth: over.auth,
    });
  }

  function post(id: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/stored-requests/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  afterEach(() => {
    server?.close();
    vi.restoreAllMocks();
  });

  test("records a matching, on-chain-verified tx via approval token", async () => {
    await start(ctxWith());
    const req = await makeRequest(ctx);
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: HASH }, { "X-Approval-Token": token });
    expect(res.status).toBe(200);
    expect((await res.json()).tx_hash).toBe(HASH);
    expect((await ctx.store.get(req.id))?.status).toBe("approved");
  });

  test("accepts a not-yet-indexed tx (propagation lag tolerated)", async () => {
    await start(
      ctxWith({
        publicClient: {
          getTransaction: vi.fn(async () => {
            throw new Error("Transaction could not be found");
          }),
        },
      }),
    );
    const req = await makeRequest(ctx);
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: HASH }, { "X-Approval-Token": token });
    expect(res.status).toBe(200);
  });

  test("rejects a tx whose on-chain destination differs (409)", async () => {
    await start(
      ctxWith({
        publicClient: {
          getTransaction: vi.fn(async () =>
            chainTx({ to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
          ),
        },
      }),
    );
    const req = await makeRequest(ctx);
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: HASH }, { "X-Approval-Token": token });
    expect(res.status).toBe(409);
    expect((await ctx.store.get(req.id))?.status).toBe("pending");
  });

  test("rejects a malformed tx_hash (400)", async () => {
    await start(ctxWith());
    const req = await makeRequest(ctx);
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: "0xnothex" }, { "X-Approval-Token": token });
    expect(res.status).toBe(400);
  });

  test("authenticates via Privy bearer token", async () => {
    const auth = {
      verifyAccessToken: vi.fn(async () => ({
        userId: USER,
        sessionId: "s",
        expiresAt: 0,
      })),
    } as unknown as ServerContext["auth"];
    await start(ctxWith({ auth }));
    const req = await makeRequest(ctx);
    const res = await post(req.id, { tx_hash: HASH }, { Authorization: "Bearer abc" });
    expect(res.status).toBe(200);
  });

  test("forbids confirming someone else's request (403)", async () => {
    const auth = {
      verifyAccessToken: vi.fn(async () => ({
        userId: "did:privy:someone-else",
        sessionId: "s",
        expiresAt: 0,
      })),
    } as unknown as ServerContext["auth"];
    await start(ctxWith({ auth }));
    const req = await makeRequest(ctx);
    const res = await post(req.id, { tx_hash: HASH }, { Authorization: "Bearer abc" });
    expect(res.status).toBe(403);
  });

  test("refuses grant-activation requests (use /submit) (400)", async () => {
    await start(ctxWith());
    const req = await makeRequest(ctx, {
      pluginContext: { kind: "grant_activation", grant_id: "g1" },
    });
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: HASH }, { "X-Approval-Token": token });
    expect(res.status).toBe(400);
  });

  test("is idempotent once approved", async () => {
    await start(ctxWith());
    const req = await makeRequest(ctx);
    await ctx.store.markApproved(req.id, HASH);
    const { mintApprovalToken } = await import("../src/approval/token.js");
    const token = mintApprovalToken(
      { requestId: req.id, userId: USER, expiresAt: req.expiresAt },
      SECRET,
    );
    const res = await post(req.id, { tx_hash: HASH }, { "X-Approval-Token": token });
    expect(res.status).toBe(200);
    expect((await res.json()).tx_hash).toBe(HASH);
  });

  test("401 when neither token nor bearer is supplied", async () => {
    await start(ctxWith());
    const req = await makeRequest(ctx);
    const res = await post(req.id, { tx_hash: HASH });
    expect(res.status).toBe(401);
  });
});
