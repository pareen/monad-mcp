import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-request approval token. Each stored request gets a one-shot, HMAC-signed
 * capability token embedded in its approval URL. The browser page picks it up
 * from the query string and sends it with /submit — that's the user-attestation
 * primitive that lets us skip a full OAuth bounce while still proving the
 * caller has been handed the URL by the agent.
 *
 * Format: `<random_id>.<expires_at_ms>.<hmac_b64url>` where the HMAC is over
 * `request_id || user_id || random_id || expires_at_ms`.
 */

export interface ApprovalTokenPayload {
  requestId: string;
  userId: string;
  expiresAt: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function mintApprovalToken(payload: ApprovalTokenPayload, secret: string): string {
  const nonce = b64url(randomBytes(12));
  const exp = payload.expiresAt.toString();
  const mac = createHmac("sha256", secret)
    .update(`${payload.requestId}|${payload.userId}|${nonce}|${exp}`)
    .digest();
  return `${nonce}.${exp}.${b64url(mac)}`;
}

export function verifyApprovalToken(
  token: string,
  payload: ApprovalTokenPayload,
  secret: string,
  now: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, macB64] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  if (exp !== payload.expiresAt) return false;
  const expected = createHmac("sha256", secret)
    .update(`${payload.requestId}|${payload.userId}|${nonce}|${expStr}`)
    .digest();
  const provided = unb64url(macB64);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
