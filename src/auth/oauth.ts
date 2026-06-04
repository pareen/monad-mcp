import type { Request, Response } from "express";
import type { Config } from "../config.js";

/**
 * OAuth 2.1 Protected Resource Metadata (RFC 9728) — tells an MCP client where
 * to obtain a token. We are our own authorization server (we bridge to Privy
 * login under the hood via /authorize + /token), so we point clients at
 * ourselves, not directly at Privy.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc9728
 */
export function protectedResourceMetadata(config: Config) {
  return (_req: Request, res: Response): void => {
    res.json({
      resource: `${config.publicBaseUrl}/mcp`,
      authorization_servers: [config.publicBaseUrl],
      bearer_methods_supported: ["header"],
      resource_documentation: `${config.publicBaseUrl}/docs`,
      scopes_supported: ["monad:read", "monad:write"],
    });
  };
}

/**
 * OAuth 2.1 Authorization Server Metadata (RFC 8414). Advertises the endpoints
 * implemented in ./oauth-routes.ts. This server is a thin AS in front of Privy:
 * /authorize renders a Privy login page, and the bearer token we ultimately
 * issue is the user's Privy access token (pass-through).
 *
 * No refresh_token grant yet — Privy session refresh is a browser concern, so
 * on access-token expiry the client simply re-runs /authorize (usually silent
 * if the user's Privy session is still warm).
 */
export function authorizationServerMetadata(config: Config) {
  return (_req: Request, res: Response): void => {
    const base = config.publicBaseUrl;
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["monad:read", "monad:write"],
    });
  };
}
