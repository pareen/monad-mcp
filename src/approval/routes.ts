import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import { type Hex, toHex } from "viem";
import { extractBearer } from "../auth/privy.js";
import { MONAD_MAINNET_ID, MONAD_TESTNET_ID } from "../chains/monad.js";
import type { ServerContext } from "../context.js";
import {
  AuthRequiredError,
  StoredRequestExpiredError,
  StoredRequestNotFoundError,
} from "../errors.js";
import { renderApprovalPage } from "./page.js";
import { mintApprovalToken, verifyApprovalToken } from "./token.js";

export function approvalUrlFor(
  ctx: ServerContext,
  request: { id: string; userId: string; expiresAt: number },
): string {
  const url = `${ctx.config.publicBaseUrl}/approve/${request.id}`;
  if (!ctx.config.approvalSecret) return url;
  const token = mintApprovalToken(
    { requestId: request.id, userId: request.userId, expiresAt: request.expiresAt },
    ctx.config.approvalSecret,
  );
  return `${url}?t=${encodeURIComponent(token)}`;
}

function caip2For(network: "mainnet" | "testnet"): string {
  return network === "mainnet" ? `eip155:${MONAD_MAINNET_ID}` : `eip155:${MONAD_TESTNET_ID}`;
}

function chainIdFor(network: "mainnet" | "testnet"): number {
  return network === "mainnet" ? MONAD_MAINNET_ID : MONAD_TESTNET_ID;
}

function asId(value: string | string[] | undefined): string {
  if (typeof value !== "string") throw new Error("missing id");
  return value;
}

export function approvalRouter(ctx: ServerContext): Router {
  const router = express.Router();
  router.get("/approve/:id", approvalPage(ctx));
  router.get("/api/stored-requests/:id", getStoredRequest(ctx));
  router.post("/api/stored-requests/:id/submit", submitStoredRequest(ctx));
  router.post("/api/stored-requests/:id/reject", rejectStoredRequest(ctx));
  return router;
}

function approvalPage(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const id = asId(req.params.id);
    const stored = await ctx.store.get(id);
    if (!stored) {
      res.status(404).send("Request not found");
      return;
    }
    if (!ctx.config.privyAppId) {
      res.status(500).send("Server not configured — PRIVY_APP_ID is unset.");
      return;
    }
    const rpcUrl =
      stored.network === "mainnet" ? ctx.config.monadMainnetRpc : ctx.config.monadTestnetRpc;
    const tokenParam = typeof req.query.t === "string" ? req.query.t : undefined;
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderApprovalPage({
        request: stored,
        privyAppId: ctx.config.privyAppId,
        chainId: chainIdFor(stored.network),
        publicBaseUrl: ctx.config.publicBaseUrl,
        rpcUrl,
        approvalToken: tokenParam,
      }),
    );
  };
}

function getStoredRequest(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const id = asId(req.params.id);
    const stored = await ctx.store.get(id);
    if (!stored) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      id: stored.id,
      status: stored.status,
      summary: stored.summary,
      network: stored.network,
      tx_hash: stored.txHash,
      expires_at: stored.expiresAt,
    });
  };
}

/**
 * Server-side approval path: verifies the bearer token, ensures the
 * authenticated user owns the stored request, then submits the tx via Privy
 * server SDK using the user's embedded wallet.
 *
 * In production a browser-first flow (Privy web SDK signs locally) is
 * preferred. This server path exists for headless approval and tests.
 */
function submitStoredRequest(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      if (!ctx.auth) throw new Error("Privy is not configured on this server.");
      const id = asId(req.params.id);

      // Two ways to authenticate the submit:
      //   1. Privy bearer token in Authorization header (original flow).
      //   2. Per-request approval token in X-Approval-Token header — minted
      //      when the stored request was created, lives only for that one
      //      request, and proves the caller was handed the approval URL by
      //      the agent.
      const approvalToken = req.header("x-approval-token");
      const bearer = extractBearer(req.header("authorization"));
      let userId: string;

      if (approvalToken && ctx.config.approvalSecret) {
        const stored = await ctx.store.get(id);
        if (!stored) throw new StoredRequestNotFoundError(id);
        const ok = verifyApprovalToken(
          approvalToken,
          { requestId: id, userId: stored.userId, expiresAt: stored.expiresAt },
          ctx.config.approvalSecret,
        );
        if (!ok) throw new AuthRequiredError("Invalid or expired approval token");
        userId = stored.userId;
      } else if (bearer) {
        const verified = await ctx.auth.verifyAccessToken(bearer);
        userId = verified.userId;
      } else {
        throw new AuthRequiredError();
      }
      const stored = await ctx.store.get(id);
      if (!stored) throw new StoredRequestNotFoundError(id);
      if (stored.userId !== userId) {
        res.status(403).json({ error: "not_your_request" });
        return;
      }
      if (stored.status === "expired") throw new StoredRequestExpiredError(id);
      if (stored.status === "approved" && stored.txHash) {
        res.json({ tx_hash: stored.txHash, status: "approved" });
        return;
      }
      if (stored.status === "rejected") {
        res.status(409).json({ error: "already_rejected" });
        return;
      }

      // Grant-activation requests don't submit a transaction — they flip a
      // pending session-key grant to "active" and (best-effort) mirror it as
      // a Privy wallet policy for defense-in-depth.
      const pc = stored.pluginContext as { kind?: string; grant_id?: string } | undefined;
      if (pc?.kind === "grant_activation" && typeof pc.grant_id === "string") {
        const grant = await ctx.grants.activate(pc.grant_id);
        await ctx.store.markApproved(id, "0x0" as `0x${string}`);
        const resolved = await ctx.auth.resolveUser(userId);
        const { PolicyMirror } = await import("../auth/policy-mirror.js");
        const mirror = new PolicyMirror(ctx.auth, ctx.logger);
        const policyId = await mirror.mirror(grant, resolved.walletId);
        if (policyId) await ctx.grants.setPrivyPolicyId(grant.id, policyId);
        ctx.logger.info("grant activated", {
          grant_id: grant.id,
          user_id: userId,
          policy_mirrored: Boolean(policyId),
        });
        res.json({
          status: "approved",
          grant_id: grant.id,
          grant_status: grant.status,
          grant_expires_at: grant.expiresAt,
          privy_policy_id: policyId,
        });
        return;
      }

      const resolved = await ctx.auth.resolveUser(userId);
      const valueHex = toHex(BigInt(stored.call.value));

      const txHash = await ctx.auth.sendTransaction(resolved.walletId, {
        caip2: caip2For(stored.network),
        to: stored.call.to,
        value: valueHex as Hex,
        data: stored.call.data,
      });

      const updated = await ctx.store.markApproved(id, txHash);
      ctx.logger.info("request approved", { request_id: id, tx_hash: txHash, user_id: userId });
      res.json({ tx_hash: updated.txHash, status: updated.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof AuthRequiredError
          ? 401
          : err instanceof StoredRequestNotFoundError
            ? 404
            : err instanceof StoredRequestExpiredError
              ? 410
              : 500;
      ctx.logger.error("submit failed", { error: msg });
      res.status(code).json({ error: msg });
    }
  };
}

function rejectStoredRequest(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const id = asId(req.params.id);
      const reason = (req.body as { reason?: string } | undefined)?.reason;
      const updated = await ctx.store.markRejected(id, reason);
      res.json({ status: updated.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof StoredRequestNotFoundError ? 404 : 500;
      res.status(code).json({ error: msg });
    }
  };
}
