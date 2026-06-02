import type { Request, Response } from "express";
import type { Config } from "../config.js";

/**
 * OAuth 2.1 Protected Resource Metadata (RFC 9728) — tells an MCP client
 * where to obtain a token. Privy is the actual authorization server; this
 * endpoint just points clients at it.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc9728
 */
export function protectedResourceMetadata(config: Config) {
  return (_req: Request, res: Response): void => {
    res.json({
      resource: `${config.publicBaseUrl}/mcp`,
      authorization_servers: ["https://auth.privy.io"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${config.publicBaseUrl}/docs`,
      scopes_supported: ["monad:read", "monad:write"],
    });
  };
}

/**
 * Minimal OAuth 2.1 Authorization Server Metadata (RFC 8414) shim so MCP
 * clients that discover the AS from us still find a valid document. The
 * actual issuer is Privy — we just rebroadcast its endpoints.
 */
export function authorizationServerMetadata(config: Config) {
  return (_req: Request, res: Response): void => {
    res.json({
      issuer: "https://auth.privy.io",
      authorization_endpoint: "https://auth.privy.io/oauth/authorize",
      token_endpoint: "https://auth.privy.io/oauth/token",
      registration_endpoint: `${config.publicBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["monad:read", "monad:write", "offline_access"],
    });
  };
}
