#!/usr/bin/env node
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { approvalRouter } from "./approval/routes.js";
import { authorizationServerMetadata, protectedResourceMetadata } from "./auth/oauth.js";
import { privyTokenVerifier } from "./auth/verifier.js";
import { buildServer } from "./server.js";

async function main() {
  const { mcp, context } = buildServer();
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

  // OAuth 2.1 discovery — clients hit these to learn how to auth.
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata(config));
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata(config));
  app.get("/.well-known/oauth-authorization-server", authorizationServerMetadata(config));

  // Approval flow routes (page + API). The page is public, /submit is
  // bearer-authed at the handler level.
  app.use(approvalRouter(context));

  // MCP transport. Stateless: one transport per process, auth carried per
  // request via the Authorization header.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await mcp.connect(transport);

  const resourceMetadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;

  if (auth) {
    app.all(
      "/mcp",
      requireBearerAuth({
        verifier: privyTokenVerifier(auth),
        resourceMetadataUrl,
      }),
      (req: Request, res: Response) => {
        transport.handleRequest(req, res, req.body).catch((err: Error) => {
          logger.error("mcp transport error", { error: err.message });
        });
      },
    );
  } else {
    logger.warn(
      "MCP /mcp endpoint is open (no Privy auth configured). " +
        "Set PRIVY_APP_ID and PRIVY_APP_SECRET to require Bearer tokens.",
    );
    app.all("/mcp", (req: Request, res: Response) => {
      transport.handleRequest(req, res, req.body).catch((err: Error) => {
        logger.error("mcp transport error", { error: err.message });
      });
    });
  }

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
