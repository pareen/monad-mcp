import { InvalidTokenError, OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../logger.js";

export interface OptionalBearerAuthOptions {
  verifier: OAuthTokenVerifier;
  /** Resource metadata URL advertised in the WWW-Authenticate challenge. */
  resourceMetadataUrl?: string;
  logger?: Logger;
}

/**
 * Optional Bearer auth for a server that wants PUBLIC reads + GATED writes.
 *
 * Behavior:
 *  - No `Authorization` header → pass through anonymously (no `req.auth`). The
 *    per-tool gate in `runTool` lets read tools run and rejects write tools with
 *    `AuthRequiredError`, so a token is only ever needed to send a transaction.
 *  - A valid `Bearer <token>` → verify it, attach `req.auth` (so write tools see
 *    the wallet), then continue. Same expiry checks as the SDK's strict variant.
 *  - A malformed or invalid/expired token → 401 with a spec-compliant
 *    `WWW-Authenticate` challenge. Someone who sent a token meant to authenticate,
 *    so a bad one is a hard error (prompts the client to re-auth) rather than a
 *    silent downgrade to anonymous.
 *
 * This mirrors `@modelcontextprotocol/sdk`'s `requireBearerAuth`, differing only
 * in that a *missing* header is allowed instead of rejected.
 */
export function optionalBearerAuth({
  verifier,
  resourceMetadataUrl,
  logger,
}: OptionalBearerAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    // Anonymous: no credentials offered. Reads proceed; writes self-gate.
    if (!authHeader) {
      next();
      return;
    }

    try {
      const [type, token] = authHeader.split(" ");
      if (type?.toLowerCase() !== "bearer" || !token) {
        throw new InvalidTokenError("Invalid Authorization header format, expected 'Bearer TOKEN'");
      }

      const authInfo = await verifier.verifyAccessToken(token);

      if (typeof authInfo.expiresAt !== "number" || Number.isNaN(authInfo.expiresAt)) {
        throw new InvalidTokenError("Token has no expiration time");
      }
      if (authInfo.expiresAt < Date.now() / 1000) {
        throw new InvalidTokenError("Token has expired");
      }

      // Picked up by StreamableHTTPServerTransport and forwarded as
      // extra.authInfo to every tool callback.
      (req as Request & { auth?: typeof authInfo }).auth = authInfo;
      next();
    } catch (error) {
      const wwwAuth = (code: string, message: string): string => {
        let header = `Bearer error="${code}", error_description="${message}"`;
        if (resourceMetadataUrl) header += `, resource_metadata="${resourceMetadataUrl}"`;
        return header;
      };

      if (error instanceof InvalidTokenError) {
        logger?.info("mcp bearer rejected (optional mode)", { reason: error.message });
        res.set("WWW-Authenticate", wwwAuth(error.errorCode, error.message));
        res.status(401).json(error.toResponseObject());
      } else if (error instanceof OAuthError) {
        // verifyAccessToken can surface other OAuth errors; treat as a 401
        // challenge so the client knows to (re-)authenticate.
        res.set("WWW-Authenticate", wwwAuth(error.errorCode, error.message));
        res.status(401).json(error.toResponseObject());
      } else {
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn("mcp bearer verification error (optional mode)", { error: message });
        res.set("WWW-Authenticate", wwwAuth("invalid_token", message));
        res.status(401).json(new InvalidTokenError(message).toResponseObject());
      }
    }
  };
}
