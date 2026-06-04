import { describe, expect, test } from "vitest";
import type { PrivyAuthBridge } from "../../src/auth/privy.js";
import { privyTokenVerifier } from "../../src/auth/verifier.js";
import { makeResolvedUser } from "../helpers/context.js";

const expiresAt = Math.floor(Date.now() / 1000) + 3600;

function bridge(overrides: Partial<PrivyAuthBridge>): PrivyAuthBridge {
  return overrides as PrivyAuthBridge;
}

describe("privyTokenVerifier", () => {
  test("returns SDK AuthInfo with Privy token expiration", async () => {
    const verifier = privyTokenVerifier(
      bridge({
        verifyAccessToken: async () => ({
          userId: "did:privy:user1",
          sessionId: "session_1",
          expiresAt,
        }),
        resolveUser: async () => makeResolvedUser(),
      }),
    );

    const authInfo = await verifier.verifyAccessToken("privy-token");

    expect(authInfo.expiresAt).toBe(expiresAt);
    expect(authInfo.scopes).toEqual(["monad:read", "monad:write"]);
    expect(authInfo.extra?.walletAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  test("keeps expiration when the user has no wallet", async () => {
    const verifier = privyTokenVerifier(
      bridge({
        verifyAccessToken: async () => ({
          userId: "did:privy:user1",
          sessionId: "session_1",
          expiresAt,
        }),
        resolveUser: async () => {
          const err = new Error("No Monad wallet linked to this Privy account");
          err.name = "WalletNotFoundError";
          throw err;
        },
      }),
    );

    const authInfo = await verifier.verifyAccessToken("privy-token");

    expect(authInfo.expiresAt).toBe(expiresAt);
    expect(authInfo.scopes).toEqual(["monad:read"]);
    expect(authInfo.extra?.walletAddress).toBeNull();
  });
});
