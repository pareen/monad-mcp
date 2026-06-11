import { describe, expect, test } from "vitest";
import type { PrivyAuthBridge } from "../../src/auth/privy.js";
import { mcpTokenVerifier, privyTokenVerifier } from "../../src/auth/verifier.js";
import { loadConfig } from "../../src/config.js";
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

  test("accepts the configured E2E bearer and resolves the configured wallet", async () => {
    const verifier = mcpTokenVerifier(
      bridge({
        resolveUser: async (userId: string) => makeResolvedUser({ userId }),
        verifyAccessToken: async () => {
          throw new Error("should not call Privy JWT verifier for e2e token");
        },
      }),
      loadConfig({
        MONAD_DEFAULT_NETWORK: "testnet",
        MONAD_MCP_E2E_BEARER_TOKEN: "x".repeat(40),
        MONAD_MCP_E2E_USER_ID: "did:privy:e2e",
      }),
    );

    const authInfo = await verifier.verifyAccessToken("x".repeat(40));

    expect(authInfo.clientId).toBe("did:privy:e2e");
    expect(authInfo.extra?.e2e).toBe(true);
    expect(authInfo.extra?.walletAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  test("rejects E2E bearer on non-testnet deployments", async () => {
    const verifier = mcpTokenVerifier(
      bridge({
        resolveUser: async () => makeResolvedUser(),
      }),
      loadConfig({
        MONAD_DEFAULT_NETWORK: "mainnet",
        MONAD_MCP_E2E_BEARER_TOKEN: "x".repeat(40),
        MONAD_MCP_E2E_USER_ID: "did:privy:e2e",
      }),
    );

    await expect(verifier.verifyAccessToken("x".repeat(40))).rejects.toThrow(/testnet/);
  });
});
