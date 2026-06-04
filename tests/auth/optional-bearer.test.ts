import type { AddressInfo } from "node:net";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import express, { type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { optionalBearerAuth } from "../../src/auth/optional-bearer.js";

const RESOURCE_META = "https://example.test/.well-known/oauth-protected-resource/mcp";

/** Verifier that accepts "good" and "expired", rejecting everything else. */
function fakeVerifier(): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token === "good") {
        return {
          token,
          clientId: "did:privy:user1",
          scopes: ["monad:read", "monad:write"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: { userId: "did:privy:user1", walletAddress: "0xabc" },
        };
      }
      if (token === "expired") {
        return {
          token,
          clientId: "did:privy:user1",
          scopes: ["monad:read"],
          expiresAt: Math.floor(Date.now() / 1000) - 60,
          extra: { userId: "did:privy:user1" },
        };
      }
      throw new Error("token verification failed");
    },
  };
}

let baseUrl: string;
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/mcp",
    optionalBearerAuth({ verifier: fakeVerifier(), resourceMetadataUrl: RESOURCE_META }),
    (req: Request, res: Response) => {
      const auth = (req as Request & { auth?: AuthInfo }).auth;
      res.json({ ok: true, authenticated: Boolean(auth), userId: auth?.clientId ?? null });
    },
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

async function postMcp(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

describe("optionalBearerAuth", () => {
  test("no Authorization header → passes through anonymously", async () => {
    const res = await postMcp();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, authenticated: false, userId: null });
  });

  test("valid Bearer token → attaches req.auth", async () => {
    const res = await postMcp({ authorization: "Bearer good" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      authenticated: true,
      userId: "did:privy:user1",
    });
  });

  test("invalid token → 401 with WWW-Authenticate challenge", async () => {
    const res = await postMcp({ authorization: "Bearer nope" });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain(`resource_metadata="${RESOURCE_META}"`);
  });

  test("expired token → 401 (not a silent anonymous downgrade)", async () => {
    const res = await postMcp({ authorization: "Bearer expired" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain("expired");
  });

  test("malformed header (not Bearer) → 401", async () => {
    const res = await postMcp({ authorization: "Basic abc123" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
  });
});
