import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { renderLoginPage } from "./login-page.js";
import {
  type AuthCodeStore,
  type RegisteredClient,
  signClientId,
  verifyClientId,
  verifyPkceS256,
} from "./oauth-store.js";
import type { PrivyAuthBridge } from "./privy.js";

/**
 * OAuth 2.1 Authorization Server endpoints that bridge MCP clients to Privy
 * login. The server itself is the AS (issuer = publicBaseUrl); Privy is the
 * underlying identity/wallet provider. Flow:
 *
 *   1. POST /oauth/register  — Dynamic Client Registration (RFC 7591)
 *   2. GET  /authorize       — validate request, render the Privy login page
 *   3. POST /authorize/consent — (browser) exchange a Privy token for a code
 *   4. POST /token           — exchange the code (+ PKCE verifier) for the token
 *
 * We pass the Privy access token straight through as the bearer token; the
 * existing privyTokenVerifier already knows how to validate it on /mcp.
 */

export interface OAuthDeps {
  config: Config;
  logger: Logger;
  auth: PrivyAuthBridge;
  codes: AuthCodeStore;
  /** HMAC secret for signing client_ids. */
  oauthSecret: string;
}

const CODE_TTL_MS = 120_000; // 2 minutes — plenty for an immediate /token call.
const SCOPES = "monad:read monad:write";

export function oauthRouter(deps: OAuthDeps): Router {
  const router = express.Router();
  router.post("/oauth/register", express.json(), registerClient(deps));
  router.get("/authorize", authorize(deps));
  router.post("/authorize/consent", express.json(), consent(deps));
  router.post("/token", express.urlencoded({ extended: false }), express.json(), token(deps));
  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(res: Response, status: number, error: string, description?: string): void {
  res.status(status).json({ error, error_description: description });
}

/** True for https URLs and http loopback (localhost / 127.0.0.1 / [::1]). */
function isAllowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") {
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  }
  return false;
}

function htmlError(res: Response, status: number, message: string): void {
  res
    .status(status)
    .type("html")
    .send(
      /* html */ `<!doctype html><meta charset="utf-8"><title>Sign-in error</title>
<body style="background:#0a0a0a;color:#fafafa;font-family:-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div style="max-width:420px;text-align:center">
<h1 style="font-size:18px">Couldn't start sign-in</h1>
<p style="color:#888;font-size:14px">${message}</p>
</div></body>`,
    );
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Decode a JWT's `exp` (no signature check) to size `expires_in`. */
function expiresInFromJwt(token: string, fallback = 3600): number {
  try {
    const part = token.split(".")[1];
    if (!part) return fallback;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    if (typeof exp !== "number") return fallback;
    const secs = Math.floor(exp - Date.now() / 1000);
    return secs > 0 ? secs : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 1. Dynamic Client Registration
// ---------------------------------------------------------------------------

function registerClient(deps: OAuthDeps): RequestHandler {
  return (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (redirectUris.length === 0) {
      jsonError(res, 400, "invalid_redirect_uri", "redirect_uris is required");
      return;
    }
    const bad = redirectUris.find((u) => !isAllowedRedirect(u));
    if (bad) {
      jsonError(
        res,
        400,
        "invalid_redirect_uri",
        `redirect_uri must be https or http loopback: ${bad}`,
      );
      return;
    }
    const client: RegisteredClient = {
      redirectUris,
      clientName: str(body.client_name),
      issuedAt: Math.floor(Date.now() / 1000),
    };
    const clientId = signClientId(client, deps.oauthSecret);
    deps.logger.info("oauth client registered", {
      client_name: client.clientName,
      redirect_uris: redirectUris,
    });
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: client.issuedAt,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      ...(client.clientName ? { client_name: client.clientName } : {}),
    });
  };
}

// ---------------------------------------------------------------------------
// 2. Authorization endpoint
// ---------------------------------------------------------------------------

function authorize(deps: OAuthDeps): RequestHandler {
  return (req: Request, res: Response): void => {
    const q = req.query as Record<string, string | undefined>;
    const clientId = str(q.client_id);
    const redirectUri = str(q.redirect_uri);

    // redirect_uri + client_id must be validated BEFORE we ever redirect back,
    // otherwise we'd be an open redirector.
    if (!clientId) {
      htmlError(res, 400, "Missing client_id.");
      return;
    }
    const client = verifyClientId(clientId, deps.oauthSecret);
    if (!client) {
      htmlError(res, 400, "Unknown or invalid client. Try reconnecting from your AI app.");
      return;
    }
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      htmlError(res, 400, "redirect_uri does not match this client's registration.");
      return;
    }

    // From here, redirect_uri is trusted — protocol errors bounce back to it.
    const state = str(q.state);
    const fail = (error: string, description: string) => {
      const url = new URL(redirectUri);
      url.searchParams.set("error", error);
      url.searchParams.set("error_description", description);
      if (state) url.searchParams.set("state", state);
      res.redirect(url.toString());
    };

    if (str(q.response_type) !== "code") {
      fail("unsupported_response_type", "Only response_type=code is supported.");
      return;
    }
    const codeChallenge = str(q.code_challenge);
    const method = str(q.code_challenge_method);
    if (!codeChallenge || method !== "S256") {
      fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
      return;
    }

    res.type("html").send(
      renderLoginPage({
        privyAppId: deps.config.privyAppId as string,
        publicBaseUrl: deps.config.publicBaseUrl,
        params: {
          responseType: "code",
          clientId,
          redirectUri,
          state,
          scope: str(q.scope),
          codeChallenge,
          codeChallengeMethod: "S256",
          resource: str(q.resource),
        },
      }),
    );
  };
}

// ---------------------------------------------------------------------------
// 3. Consent callback (browser → server, after Privy login)
// ---------------------------------------------------------------------------

function consent(deps: OAuthDeps): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      token?: unknown;
      params?: {
        clientId?: unknown;
        redirectUri?: unknown;
        codeChallenge?: unknown;
        state?: unknown;
        scope?: unknown;
      };
    };
    const token = str(body.token);
    const p = body.params ?? {};
    const clientId = str(p.clientId);
    const redirectUri = str(p.redirectUri);
    const codeChallenge = str(p.codeChallenge);
    const state = str(p.state);

    if (!token || !clientId || !redirectUri || !codeChallenge) {
      jsonError(res, 400, "invalid_request", "Missing token or authorization parameters.");
      return;
    }
    // Re-validate the client + redirect — never trust values echoed by the browser.
    const client = verifyClientId(clientId, deps.oauthSecret);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      jsonError(res, 400, "invalid_request", "client_id / redirect_uri mismatch.");
      return;
    }
    // The Privy token must be real before we mint a code for it.
    try {
      await deps.auth.verifyAccessToken(token);
    } catch (err) {
      jsonError(
        res,
        401,
        "access_denied",
        err instanceof Error ? err.message : "Invalid Privy session.",
      );
      return;
    }

    const code = deps.codes.issue(
      { privyToken: token, codeChallenge, redirectUri, clientId, scope: SCOPES },
      CODE_TTL_MS,
    );
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.json({ redirect: url.toString() });
  };
}

// ---------------------------------------------------------------------------
// 4. Token endpoint
// ---------------------------------------------------------------------------

function token(deps: OAuthDeps): RequestHandler {
  return (req: Request, res: Response): void => {
    res.set("Cache-Control", "no-store");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grantType = str(body.grant_type);
    if (grantType !== "authorization_code") {
      jsonError(
        res,
        400,
        "unsupported_grant_type",
        "Only grant_type=authorization_code is supported (no refresh — re-authorize on expiry).",
      );
      return;
    }
    const code = str(body.code);
    const verifier = str(body.code_verifier);
    const redirectUri = str(body.redirect_uri);
    const clientId = str(body.client_id);
    if (!code || !verifier || !redirectUri) {
      jsonError(res, 400, "invalid_request", "code, code_verifier and redirect_uri are required.");
      return;
    }
    const data = deps.codes.take(code);
    if (!data) {
      jsonError(res, 400, "invalid_grant", "Authorization code is invalid or expired.");
      return;
    }
    if (data.redirectUri !== redirectUri || (clientId && data.clientId !== clientId)) {
      jsonError(res, 400, "invalid_grant", "redirect_uri / client_id does not match the code.");
      return;
    }
    if (!verifyPkceS256(verifier, data.codeChallenge)) {
      jsonError(res, 400, "invalid_grant", "PKCE verification failed.");
      return;
    }
    res.json({
      access_token: data.privyToken,
      token_type: "Bearer",
      expires_in: expiresInFromJwt(data.privyToken),
      scope: data.scope,
    });
  };
}
