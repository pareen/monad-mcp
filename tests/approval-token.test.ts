import { describe, expect, test } from "vitest";
import { mintApprovalToken, verifyApprovalToken } from "../src/approval/token.js";

const secret = "this-is-a-long-enough-secret-for-tests-only";
const payload = {
  requestId: "req-1",
  userId: "did:privy:user-1",
  expiresAt: 1_000_000_000_000,
};

describe("approval token", () => {
  test("mint+verify round-trips on matching payload", () => {
    const token = mintApprovalToken(payload, secret);
    expect(verifyApprovalToken(token, payload, secret, 1_000)).toBe(true);
  });

  test("rejects tokens past their expiry", () => {
    const token = mintApprovalToken(payload, secret);
    expect(verifyApprovalToken(token, payload, secret, payload.expiresAt + 1)).toBe(false);
  });

  test("rejects when request id doesn't match", () => {
    const token = mintApprovalToken(payload, secret);
    expect(verifyApprovalToken(token, { ...payload, requestId: "wrong" }, secret, 1_000)).toBe(
      false,
    );
  });

  test("rejects when user id doesn't match", () => {
    const token = mintApprovalToken(payload, secret);
    expect(verifyApprovalToken(token, { ...payload, userId: "spoofed" }, secret, 1_000)).toBe(
      false,
    );
  });

  test("rejects when expiry differs (tamper detection)", () => {
    const token = mintApprovalToken(payload, secret);
    expect(
      verifyApprovalToken(token, { ...payload, expiresAt: payload.expiresAt + 10 }, secret, 1_000),
    ).toBe(false);
  });

  test("rejects when secret differs", () => {
    const token = mintApprovalToken(payload, secret);
    expect(verifyApprovalToken(token, payload, "different-secret", 1_000)).toBe(false);
  });

  test("rejects malformed tokens", () => {
    expect(verifyApprovalToken("not-a-token", payload, secret, 1_000)).toBe(false);
    expect(verifyApprovalToken("a.b", payload, secret, 1_000)).toBe(false);
    expect(verifyApprovalToken("a.b.c", payload, secret, 1_000)).toBe(false);
  });

  test("two mints for the same payload produce different tokens (nonce in nonce)", () => {
    const a = mintApprovalToken(payload, secret);
    const b = mintApprovalToken(payload, secret);
    expect(a).not.toBe(b);
    // ...but both verify
    expect(verifyApprovalToken(a, payload, secret, 1_000)).toBe(true);
    expect(verifyApprovalToken(b, payload, secret, 1_000)).toBe(true);
  });
});
