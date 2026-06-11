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
import type { StoredRequest } from "../store/types.js";
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
  router.post("/api/stored-requests/:id/confirm", confirmStoredRequest(ctx));
  router.post("/api/stored-requests/:id/reject", rejectStoredRequest(ctx));
  return router;
}

/** Thrown when a client-reported tx hash doesn't match the stored request. */
class TxMismatchError extends Error {}

function statusForError(err: unknown): number {
  if (err instanceof AuthRequiredError) return 401;
  if (err instanceof StoredRequestNotFoundError) return 404;
  if (err instanceof StoredRequestExpiredError) return 410;
  if (err instanceof TxMismatchError) return 409;
  return 500;
}

/**
 * Resolves the authenticated user behind an approval action. Two ways in:
 *   1. Per-request approval token in `X-Approval-Token` (minted with the
 *      approval URL — proves the caller was handed the URL by the agent).
 *   2. Privy bearer token in `Authorization` (the in-browser login path).
 */
async function authorizeFor(ctx: ServerContext, req: Request, id: string): Promise<string> {
  const approvalToken = req.header("x-approval-token");
  const bearer = extractBearer(req.header("authorization"));

  if (approvalToken && ctx.config.approvalSecret) {
    const stored = await ctx.store.get(id);
    if (!stored) throw new StoredRequestNotFoundError(id);
    const ok = verifyApprovalToken(
      approvalToken,
      { requestId: id, userId: stored.userId, expiresAt: stored.expiresAt },
      ctx.config.approvalSecret,
    );
    if (!ok) throw new AuthRequiredError("Invalid or expired approval token");
    return stored.userId;
  }
  if (ctx.localWallet) {
    const stored = await ctx.store.get(id);
    if (stored?.userId === ctx.localWallet.userId && !ctx.config.approvalSecret) {
      return stored.userId;
    }
  }
  if (bearer) {
    if (!ctx.auth) throw new Error("Privy is not configured on this server.");
    const verified = await ctx.auth.verifyAccessToken(bearer);
    return verified.userId;
  }
  throw new AuthRequiredError();
}

/**
 * Integrity gate for the client-signed path: a logged-in user POSTs the hash of
 * a tx they broadcast from their own wallet, so we confirm on-chain that it
 * actually matches the request they were asked to approve before recording it.
 * Propagation lag is tolerated — an unfound tx is accepted (the caller is
 * already an authenticated owner); a *found-but-different* tx is rejected.
 */
async function assertOnChainMatch(
  ctx: ServerContext,
  stored: { network: "mainnet" | "testnet"; walletAddress: string; call: StoredRequest["call"] },
  txHash: Hex,
): Promise<void> {
  let tx: Awaited<
    ReturnType<ReturnType<ServerContext["clients"]["publicClient"]>["getTransaction"]>
  >;
  try {
    tx = await ctx.clients.publicClient(stored.network).getTransaction({ hash: txHash });
  } catch {
    return; // not yet indexed (just broadcast) — accept; ownership already proven
  }
  if (!tx) return;
  const mismatches: string[] = [];
  if ((tx.from ?? "").toLowerCase() !== stored.walletAddress.toLowerCase())
    mismatches.push(`from ${tx.from} ≠ ${stored.walletAddress}`);
  if ((tx.to ?? "").toLowerCase() !== stored.call.to.toLowerCase())
    mismatches.push(`to ${tx.to} ≠ ${stored.call.to}`);
  if (tx.value !== BigInt(stored.call.value))
    mismatches.push(`value ${tx.value} ≠ ${stored.call.value}`);
  if ((tx.input ?? "0x").toLowerCase() !== (stored.call.data ?? "0x").toLowerCase())
    mismatches.push("calldata differs");
  if (mismatches.length > 0) {
    throw new TxMismatchError(
      `Reported tx does not match the approved request: ${mismatches.join("; ")}`,
    );
  }
}

function approvalPage(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const id = asId(req.params.id);
    const stored = await ctx.store.get(id);
    if (!stored) {
      res.status(404).send("Request not found");
      return;
    }
    const isLocalWalletRequest = Boolean(
      ctx.localWallet && stored.userId === ctx.localWallet.userId,
    );
    if (!ctx.config.privyAppId && !isLocalWalletRequest) {
      res.status(500).send("Server not configured — PRIVY_APP_ID is unset.");
      return;
    }
    const rpcUrl =
      stored.network === "mainnet" ? ctx.config.monadMainnetRpc : ctx.config.monadTestnetRpc;
    const tokenParam = typeof req.query.t === "string" ? req.query.t : undefined;
    // Grant activations have no transaction to sign in the browser — they flip a
    // server-side grant — so they keep the server-submit path. Everything else
    // (real transfers/contract calls) signs client-side with the user's own
    // wallet, which works for any wallet the user controls (no server signer).
    const pc = stored.pluginContext as { kind?: string } | undefined;
    const signingMode: "client" | "server" =
      isLocalWalletRequest || pc?.kind === "grant_activation" ? "server" : "client";
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderApprovalPage({
        request: stored,
        privyAppId: ctx.config.privyAppId ?? "",
        chainId: chainIdFor(stored.network),
        publicBaseUrl: ctx.config.publicBaseUrl,
        rpcUrl,
        approvalToken: tokenParam,
        signingMode,
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
      const id = asId(req.params.id);
      const userId = await authorizeFor(ctx, req, id);
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
        let policyId: string | null = null;
        if (ctx.auth) {
          const resolved = await ctx.auth.resolveUser(userId);
          const { PolicyMirror } = await import("../auth/policy-mirror.js");
          const mirror = new PolicyMirror(ctx.auth, ctx.logger);
          policyId = await mirror.mirror(grant, resolved.walletId);
          if (policyId) await ctx.grants.setPrivyPolicyId(grant.id, policyId);
        }
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

      if (ctx.localWallet && stored.userId === ctx.localWallet.userId) {
        const txHash = await ctx.localWallet.sendTransaction(stored.network, stored.call);
        const updated = await ctx.store.markApproved(id, txHash);
        ctx.logger.info("request approved (local wallet)", {
          request_id: id,
          tx_hash: txHash,
          user_id: userId,
        });
        res.json({ tx_hash: updated.txHash, status: updated.status });
        return;
      }

      if (!ctx.auth) throw new Error("Privy is not configured on this server.");
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
      ctx.logger.error("submit failed", { error: msg });
      res.status(statusForError(err)).json({ error: msg });
    }
  };
}

/**
 * Client-signed approval path: the user signed + broadcast the transaction in
 * their browser with their own embedded wallet (via the Privy web SDK), and now
 * reports the resulting hash. The server never signs here — it verifies the
 * caller owns the request, checks the on-chain tx matches, and records it.
 *
 * This is the trust-maximizing path and the only one that works for wallets the
 * server can't sign for (i.e. anything created by browser login rather than
 * server-side provisioning).
 */
function confirmStoredRequest(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const id = asId(req.params.id);
      const txHash = (req.body as { tx_hash?: string } | undefined)?.tx_hash;
      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        res.status(400).json({ error: "tx_hash (0x + 64 hex chars) is required" });
        return;
      }
      const userId = await authorizeFor(ctx, req, id);
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
      const pc = stored.pluginContext as { kind?: string } | undefined;
      if (pc?.kind === "grant_activation") {
        res
          .status(400)
          .json({ error: "grant activations are confirmed via /submit, not /confirm" });
        return;
      }

      await assertOnChainMatch(ctx, stored, txHash as Hex);

      const updated = await ctx.store.markApproved(id, txHash as `0x${string}`);
      ctx.logger.info("request approved (client-signed)", {
        request_id: id,
        tx_hash: txHash,
        user_id: userId,
      });
      res.json({ tx_hash: updated.txHash, status: updated.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("confirm failed", { error: msg });
      res.status(statusForError(err)).json({ error: msg });
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
