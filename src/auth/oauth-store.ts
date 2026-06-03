import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Stateless + ephemeral primitives for the OAuth 2.1 authorization-server
 * bridge. Two distinct lifetimes, two distinct mechanisms:
 *
 *  - **Client registrations** (Dynamic Client Registration, RFC 7591) must
 *    survive process restarts and work across machines, so we make `client_id`
 *    a *self-describing, HMAC-signed* token that encodes the client's
 *    redirect URIs. No database row to look up later — verifying the signature
 *    re-derives everything we need. (Analogous to the approval-token trick in
 *    ./../approval/token.ts.)
 *
 *  - **Authorization codes** are short-lived (seconds) and must be one-shot.
 *    A signed token can't be invalidated after use without a store, so codes
 *    live in an in-process TTL map and are deleted on redemption — true
 *    single-use. They intentionally do NOT survive a restart (a user just
 *    re-runs login, which is instant if their Privy session is still warm).
 */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function safeEqualB64(aB64: string, b: Buffer): boolean {
  const a = unb64url(aB64);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Client registration (signed, stateless)
// ---------------------------------------------------------------------------

export interface RegisteredClient {
  redirectUris: string[];
  clientName?: string;
  /** seconds since epoch the registration was minted */
  issuedAt: number;
}

/**
 * Mints a `client_id` that *is* the registration: `<payload>.<hmac>` where
 * payload is base64url(JSON). Anyone can read it, but only we can have produced
 * a valid signature, so we trust the redirect URIs it carries.
 */
export function signClientId(client: RegisteredClient, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(client), "utf8"));
  return `${payload}.${b64url(hmac(secret, payload))}`;
}

export function verifyClientId(clientId: string, secret: string): RegisteredClient | null {
  const dot = clientId.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = clientId.slice(0, dot);
  const mac = clientId.slice(dot + 1);
  if (!safeEqualB64(mac, hmac(secret, payload))) return null;
  try {
    const parsed = JSON.parse(unb64url(payload).toString("utf8")) as RegisteredClient;
    if (!Array.isArray(parsed.redirectUris)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256 only)
// ---------------------------------------------------------------------------

/** base64url(SHA-256(verifier)) — the value a client puts in `code_challenge`. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  // Constant-time compare of two base64url strings of equal expected length.
  const expected = Buffer.from(pkceChallengeFromVerifier(verifier));
  const provided = Buffer.from(challenge);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

// ---------------------------------------------------------------------------
// Authorization codes (ephemeral, one-shot)
// ---------------------------------------------------------------------------

export interface AuthCodeData {
  /** The Privy access token we hand back at /token (pass-through). */
  privyToken: string;
  /** PKCE challenge the client committed to at /authorize. */
  codeChallenge: string;
  /** Must match the redirect_uri presented again at /token. */
  redirectUri: string;
  clientId: string;
  scope: string;
  expiresAt: number;
}

export class AuthCodeStore {
  private readonly codes = new Map<string, AuthCodeData>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Issues a fresh opaque code bound to `data`. */
  issue(data: Omit<AuthCodeData, "expiresAt">, ttlMs: number): string {
    this.sweep();
    const code = b64url(randomBytes(32));
    this.codes.set(code, { ...data, expiresAt: this.now() + ttlMs });
    return code;
  }

  /** Redeems a code exactly once. Returns null if unknown/expired. */
  take(code: string): AuthCodeData | null {
    const data = this.codes.get(code);
    if (!data) return null;
    this.codes.delete(code); // one-shot regardless of outcome
    if (data.expiresAt < this.now()) return null;
    return data;
  }

  private sweep(): void {
    const t = this.now();
    for (const [code, data] of this.codes) {
      if (data.expiresAt < t) this.codes.delete(code);
    }
  }

  get size(): number {
    return this.codes.size;
  }
}
