import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { AuthRequiredError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { PrivyAuthBridge, ResolvedUser } from "./privy.js";

/**
 * Adapter from PrivyAuthBridge to the MCP SDK's OAuthTokenVerifier interface.
 * Verifies the bearer token, resolves the user's wallet, and packs the result
 * into AuthInfo.extra for downstream tool handlers.
 */
export function privyTokenVerifier(bridge: PrivyAuthBridge, logger?: Logger): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let userId: string;
      let sessionId: string;
      try {
        ({ userId, sessionId } = await bridge.verifyAccessToken(token));
      } catch (err) {
        logger?.warn("mcp bearer rejected: token verification failed", {
          stage: "verify_jwt",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // Resolve wallet lazily? For now eager — every authenticated call needs it.
      let resolved: ResolvedUser;
      try {
        resolved = await bridge.resolveUser(userId);
      } catch (err) {
        // Pass user info through even if no wallet — read tools that take an
        // address arg still work; write tools will fail with WalletNotFoundError.
        if (err instanceof Error && err.name === "WalletNotFoundError") {
          logger?.info("mcp bearer ok (no wallet linked, read-only)", { userId, sessionId });
          return {
            token,
            clientId: userId,
            scopes: ["monad:read"],
            extra: { userId, sessionId, walletAddress: null, walletId: null },
          };
        }
        logger?.warn("mcp bearer rejected: resolveUser failed", {
          stage: "resolve_user",
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new AuthRequiredError(
          err instanceof Error ? err.message : "Failed to resolve Privy user",
        );
      }
      logger?.info("mcp bearer ok", { userId, sessionId, wallet: resolved.walletAddress });
      return {
        token,
        clientId: userId,
        scopes: ["monad:read", "monad:write"],
        extra: {
          userId: resolved.userId,
          sessionId,
          walletAddress: resolved.walletAddress,
          walletId: resolved.walletId,
          email: resolved.email,
        },
      };
    },
  };
}

export interface AuthExtra {
  userId: string;
  sessionId: string;
  walletAddress: `0x${string}` | null;
  walletId: string | null;
  email?: string;
}

export function readAuthExtra(authInfo: AuthInfo | undefined): AuthExtra | null {
  if (!authInfo?.extra) return null;
  const extra = authInfo.extra as Record<string, unknown>;
  if (typeof extra.userId !== "string") return null;
  return {
    userId: extra.userId,
    sessionId: typeof extra.sessionId === "string" ? extra.sessionId : "",
    walletAddress: (extra.walletAddress as `0x${string}` | null) ?? null,
    walletId: (extra.walletId as string | null) ?? null,
    email: typeof extra.email === "string" ? extra.email : undefined,
  };
}
