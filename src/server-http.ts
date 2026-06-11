#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { approvalRouter } from "./approval/routes.js";
import { oauthRouter } from "./auth/oauth-routes.js";
import { AuthCodeStore } from "./auth/oauth-store.js";
import { authorizationServerMetadata, protectedResourceMetadata } from "./auth/oauth.js";
import { optionalBearerAuth } from "./auth/optional-bearer.js";
import { mcpTokenVerifier } from "./auth/verifier.js";
import type { ServerContext } from "./context.js";
import { VERSION, buildMcpServer, buildServerContext } from "./server.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHomePage(context: ServerContext): string {
  const { config, auth } = context;
  const baseUrl = escapeHtml(config.publicBaseUrl);
  const defaultNetwork = escapeHtml(config.defaultNetwork);
  const privyStatus = auth ? "enabled" : "not configured";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>monad-mcp</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f8fa;
        color: #15171a;
      }
      main {
        width: min(720px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid #d8dde5;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 20px 60px rgb(20 26 34 / 8%);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 20px;
        color: #4f5a68;
        line-height: 1.55;
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 10px 16px;
        margin: 0 0 24px;
      }
      dt {
        color: #687385;
      }
      dd {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        overflow-wrap: anywhere;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      a {
        color: #0d5bd7;
        text-decoration-thickness: 1px;
        text-underline-offset: 3px;
      }
      @media (max-width: 520px) {
        main {
          padding: 24px 16px;
        }
        h1 {
          font-size: 24px;
        }
        dl {
          grid-template-columns: 1fr;
          gap: 4px;
        }
        dt {
          margin-top: 8px;
        }
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #111418;
          color: #eef2f7;
        }
        main {
          background: #181d24;
          border-color: #303844;
          box-shadow: none;
        }
        p,
        dt {
          color: #aab4c3;
        }
        a {
          color: #8ab4ff;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>monad-mcp</h1>
      <p>HTTP MCP endpoint for Monad tools.</p>
      <dl>
        <dt>Endpoint</dt>
        <dd>${baseUrl}/mcp</dd>
        <dt>Network</dt>
        <dd>${defaultNetwork}</dd>
        <dt>Privy</dt>
        <dd>${privyStatus}</dd>
      </dl>
      <nav aria-label="Server links">
        <a href="/health">Health</a>
      </nav>
    </main>
  </body>
</html>`;
}

export function createHttpApp(context: ServerContext) {
  const { config, logger, auth } = context;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(renderHomePage(context));
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      version: VERSION,
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
    const verifier = mcpTokenVerifier(auth, config, logger);
    if (config.requireAuth) {
      // Strict mode: every call needs a valid bearer token (reads included).
      app.post("/mcp", requireBearerAuth({ verifier, resourceMetadataUrl }), handleMcpPost);
      logger.info("MCP /mcp requires a bearer token for all calls (MONAD_MCP_REQUIRE_AUTH).");
    } else {
      // Default: public reads, gated writes. Anonymous requests run read tools;
      // write tools self-gate in runTool and a token unlocks them.
      app.post(
        "/mcp",
        optionalBearerAuth({ verifier, resourceMetadataUrl, logger }),
        handleMcpPost,
      );
      logger.info(
        "MCP /mcp reads are public; write tools require a Privy bearer token. " +
          "Set MONAD_MCP_REQUIRE_AUTH=true to gate reads too.",
      );
    }
  } else {
    logger.warn(
      "MCP /mcp endpoint is fully open (no Privy auth configured). " +
        "Write tools run without a wallet check. " +
        "Set PRIVY_APP_ID and PRIVY_APP_SECRET to require a bearer token for writes.",
    );
    app.post("/mcp", handleMcpPost);
  }
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

export function startHttpServer(context = buildServerContext()) {
  const app = createHttpApp(context);
  const { config, logger, auth } = context;
  return app.listen(config.port, () => {
    logger.info("monad-mcp http server listening", {
      port: config.port,
      base_url: config.publicBaseUrl,
      default_network: config.defaultNetwork,
      privy_enabled: Boolean(auth),
    });
  });
}

async function main() {
  startHttpServer();
}

const isCliEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCliEntrypoint) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}
