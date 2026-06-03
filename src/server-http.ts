#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { approvalRouter } from "./approval/routes.js";
import { oauthRouter } from "./auth/oauth-routes.js";
import { AuthCodeStore } from "./auth/oauth-store.js";
import { authorizationServerMetadata, protectedResourceMetadata } from "./auth/oauth.js";
import { privyTokenVerifier } from "./auth/verifier.js";
import { buildMcpServer, buildServerContext } from "./server.js";

async function main() {
  const context = buildServerContext();
  const { config, logger, auth } = context;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      version: "0.1.0",
      default_network: config.defaultNetwork,
      privy_enabled: Boolean(auth),
    });
  });

  // OAuth 2.1 discovery + authorization-server endpoints — only when Privy is
  // configured (we can mint/verify tokens). In open (no-Privy) mode these 404,
  // so spec-compliant MCP clients treat the server as anonymous and connect
  // without attempting an OAuth flow.
  if (auth) {
    app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata(config));
    app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata(config));
    app.get("/.well-known/oauth-authorization-server", authorizationServerMetadata(config));
    // Some clients append the resource path when discovering the AS.
    app.get("/.well-known/oauth-authorization-server/mcp", authorizationServerMetadata(config));

    // Secret for signing client_ids. Prefer a stable configured secret so
    // registrations survive restarts; fall back to an ephemeral one (with a
    // warning) so the flow still works on a bare deploy.
    let oauthSecret = config.approvalSecret;
    if (!oauthSecret) {
      oauthSecret = randomBytes(32).toString("hex");
      logger.warn(
        "MONAD_MCP_APPROVAL_SECRET is unset — using an ephemeral OAuth signing secret. " +
          "Registered OAuth clients will be invalidated on restart. Set it for stability.",
      );
    }
    app.use(oauthRouter({ config, logger, auth, codes: new AuthCodeStore(), oauthSecret }));
  }

  // Approval flow routes (page + API). The page is public, /submit is
  // bearer-authed at the handler level.
  app.use(approvalRouter(context));

  const resourceMetadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;

  // Stateless: mint a fresh McpServer + transport per request. A single shared
  // transport keeps one-shot session state, so reusing it makes every client
  // after the first fail with "already initialized". The context (stores, auth)
  // is shared across requests; only the transport/server are per-request.
  const handleMcpPost = async (req: Request, res: Response) => {
    const server = buildMcpServer(context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("mcp transport error", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  // This server is stateless, so it has no server→client stream to attach to a
  // GET. Answer GET/DELETE with a clean 405 instead of letting the transport
  // throw a 500 — a 500 on the SSE probe reads as "failed to connect" in clients.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. This MCP server is stateless — use POST /mcp.",
      },
      id: null,
    });
  };

  if (auth) {
    app.post(
      "/mcp",
      requireBearerAuth({
        verifier: privyTokenVerifier(auth),
        resourceMetadataUrl,
      }),
      handleMcpPost,
    );
  } else {
    logger.warn(
      "MCP /mcp endpoint is open (no Privy auth configured). " +
        "Set PRIVY_APP_ID and PRIVY_APP_SECRET to require Bearer tokens.",
    );
    app.post("/mcp", handleMcpPost);
  }
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(config.port, () => {
    logger.info("monad-mcp http server listening", {
      port: config.port,
      base_url: config.publicBaseUrl,
      default_network: config.defaultNetwork,
      privy_enabled: Boolean(auth),
    });
  });
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: top-level fatal
  console.error("fatal:", err);
  process.exit(1);
});
