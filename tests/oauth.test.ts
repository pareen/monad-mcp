import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { oauthRouter } from "../src/auth/oauth-routes.js";
import {
  AuthCodeStore,
  pkceChallengeFromVerifier,
  signClientId,
  verifyClientId,
  verifyPkceS256,
} from "../src/auth/oauth-store.js";
import type { PrivyAuthBridge } from "../src/auth/privy.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";

const SECRET = "x".repeat(40);

describe("oauth-store: signed client_id", () => {
  test("round-trips redirect URIs and survives nothing-changed", () => {
    const id = signClientId(
      { redirectUris: ["https://a/cb", "http://127.0.0.1/cb"], issuedAt: 1 },
      SECRET,
    );
    const back = verifyClientId(id, SECRET);
    expect(back?.redirectUris).toEqual(["https://a/cb", "http://127.0.0.1/cb"]);
  });

  test("rejects a tampered payload", () => {
    const id = signClientId({ redirectUris: ["https://a/cb"], issuedAt: 1 }, SECRET);
    const [payload, mac] = id.split(".");
    const evil = Buffer.from(JSON.stringify({ redirectUris: ["https://evil/cb"], issuedAt: 1 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(verifyClientId(`${evil}.${mac}`, SECRET)).toBeNull();
    expect(verifyClientId(`${payload}.AAAA`, SECRET)).toBeNull();
    expect(verifyClientId(id, "different-secret")).toBeNull();
  });
});

describe("PKCE S256", () => {
  test("matching verifier verifies; wrong one fails", () => {
    const verifier = "abc123-verifier-string-long-enough";
    const challenge = pkceChallengeFromVerifier(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("not-the-verifier", challenge)).toBe(false);
  });
});

describe("AuthCodeStore", () => {
  test("issue → take is one-shot", () => {
    const store = new AuthCodeStore();
    const code = store.issue(
      {
        privyToken: "t",
        codeChallenge: "c",
        redirectUri: "https://a/cb",
        clientId: "cid",
        scope: "s",
      },
      60_000,
    );
    expect(store.take(code)?.privyToken).toBe("t");
    expect(store.take(code)).toBeNull(); // already redeemed
  });

  test("expired codes return null", () => {
    let now = 1_000;
    const store = new AuthCodeStore(() => now);
    const code = store.issue(
      {
        privyToken: "t",
        codeChallenge: "c",
        redirectUri: "https://a/cb",
        clientId: "cid",
        scope: "s",
      },
      100,
    );
    now = 2_000;
    expect(store.take(code)).toBeNull();
  });
});

describe("oauth routes (end-to-end protocol)", () => {
  let base: string;
  let server: ReturnType<express.Express["listen"]>;

  beforeAll(async () => {
    const config = loadConfig({
      PRIVY_APP_ID: "app-test",
      PRIVY_APP_SECRET: "secret-test",
      PUBLIC_BASE_URL: "http://127.0.0.1:0",
      MONAD_MCP_APPROVAL_SECRET: SECRET,
    } as NodeJS.ProcessEnv);
    // Stub Privy bridge: accept any token as a valid session.
    const auth = {
      verifyAccessToken: async (_t: string) => ({ userId: "u1", sessionId: "s1" }),
    } as unknown as PrivyAuthBridge;
    const app = express();
    app.use(
      oauthRouter({
        config,
        logger: createLogger("error"),
        auth,
        codes: new AuthCodeStore(),
        oauthSecret: SECRET,
      }),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  async function register(): Promise<string> {
    const res = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:7777/cb"], client_name: "Test" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id: string };
    expect(verifyClientId(body.client_id, SECRET)).not.toBeNull();
    return body.client_id;
  }

  test("rejects registration with a non-loopback http redirect", async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(res.status).toBe(400);
  });

  test("/authorize rejects an unknown client", async () => {
    const res = await fetch(
      `${base}/authorize?response_type=code&client_id=bogus&redirect_uri=http://127.0.0.1:7777/cb&code_challenge=x&code_challenge_method=S256`,
    );
    expect(res.status).toBe(400);
  });

  test("/authorize rejects a redirect_uri not in the registration", async () => {
    const clientId = await register();
    const res = await fetch(
      `${base}/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=http://127.0.0.1:9999/other&code_challenge=x&code_challenge_method=S256`,
    );
    expect(res.status).toBe(400);
  });

  test("full flow: register → authorize → consent → token returns the Privy token", async () => {
    const clientId = await register();
    const redirectUri = "http://127.0.0.1:7777/cb";
    const verifier = "verifier-0123456789-abcdefghij-klmnopqrst";
    const challenge = pkceChallengeFromVerifier(verifier);

    // /authorize renders the login page (HTML, 200) once params are valid.
    const authRes = await fetch(
      `${base}/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
    );
    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("content-type")).toContain("html");

    // The browser would POST the Privy token here after login.
    const consentRes = await fetch(`${base}/authorize/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "privy-access-token-abc",
        params: { clientId, redirectUri, codeChallenge: challenge, state: "xyz" },
      }),
    });
    expect(consentRes.status).toBe(200);
    const { redirect } = (await consentRes.json()) as { redirect: string };
    const code = new URL(redirect).searchParams.get("code");
    expect(new URL(redirect).searchParams.get("state")).toBe("xyz");
    expect(code).toBeTruthy();

    // /token exchanges the code for the (pass-through) Privy token.
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    });
    const tokRes = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(tokRes.status).toBe(200);
    const tok = (await tokRes.json()) as { access_token: string; token_type: string };
    expect(tok.access_token).toBe("privy-access-token-abc");
    expect(tok.token_type).toBe("Bearer");

    // Code is one-shot — a replay fails.
    const replay = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(replay.status).toBe(400);
  });

  test("/token fails PKCE with the wrong verifier", async () => {
    const clientId = await register();
    const redirectUri = "http://127.0.0.1:7777/cb";
    const challenge = pkceChallengeFromVerifier("the-real-verifier-aaaaaaaaaaaaaaaaa");

    const consentRes = await fetch(`${base}/authorize/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "tok",
        params: { clientId, redirectUri, codeChallenge: challenge },
      }),
    });
    const { redirect } = (await consentRes.json()) as { redirect: string };
    const code = new URL(redirect).searchParams.get("code") as string;

    const tokRes = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: "WRONG-verifier-bbbbbbbbbbbbbbbbbbbbbbb",
        redirect_uri: redirectUri,
      }).toString(),
    });
    expect(tokRes.status).toBe(400);
    expect(((await tokRes.json()) as { error: string }).error).toBe("invalid_grant");
  });
});
