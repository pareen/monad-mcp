import { timingSafeEqual } from "node:crypto";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Config } from "../config.js";
import { AuthRequiredError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { PrivyAuthBridge, ResolvedUser } from "./privy.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

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
      let expiresAt: number;
      try {
        ({ userId, sessionId, expiresAt } = await bridge.verifyAccessToken(token));
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
            expiresAt,
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
        expiresAt,
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

/**
 * Production verifier with an optional, disabled-by-default E2E bearer.
 *
 * The E2E bearer exists only so hosted QA can exercise `/mcp` write calls
 * without a dashboard test account or manual OTP. It still resolves a real
 * Privy user/wallet, and `runTool` restricts the token to a tiny testnet
 * native transfer.
 */
export function mcpTokenVerifier(
  bridge: PrivyAuthBridge,
  config: Config,
  logger?: Logger,
): OAuthTokenVerifier {
  const privy = privyTokenVerifier(bridge, logger);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (config.e2eBearerToken && config.e2eUserId && safeEqual(token, config.e2eBearerToken)) {
        if (config.defaultNetwork !== "testnet") {
          throw new AuthRequiredError("E2E bearer auth is only allowed on testnet deployments.");
        }
        const resolved = await bridge.resolveUser(config.e2eUserId);
        logger?.info("mcp e2e bearer ok", {
          userId: resolved.userId,
          wallet: resolved.walletAddress,
        });
        return {
          token,
          clientId: resolved.userId,
          scopes: ["monad:read", "monad:write"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            userId: resolved.userId,
            sessionId: "e2e-bearer",
            walletAddress: resolved.walletAddress,
            walletId: resolved.walletId,
            email: resolved.email,
            e2e: true,
            e2eAllowedRecipient: config.e2eAllowedRecipient.toLowerCase(),
            e2eMaxTransferWei: config.e2eMaxTransferWei,
          },
        };
      }
      return privy.verifyAccessToken(token);
    },
  };
}

export interface AuthExtra {
  userId: string;
  sessionId: string;
  walletAddress: `0x${string}` | null;
  walletId: string | null;
  email?: string;
  e2e?: boolean;
  e2eAllowedRecipient?: `0x${string}`;
  e2eMaxTransferWei?: string;
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
    e2e: extra.e2e === true,
    e2eAllowedRecipient:
      typeof extra.e2eAllowedRecipient === "string"
        ? (extra.e2eAllowedRecipient as `0x${string}`)
        : undefined,
    e2eMaxTransferWei:
      typeof extra.e2eMaxTransferWei === "string" ? extra.e2eMaxTransferWei : undefined,
  };
}
