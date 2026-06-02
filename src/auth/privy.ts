import { PrivyClient, isEmbeddedWalletLinkedAccount, verifyAccessToken } from "@privy-io/node";
import { type JWTVerifyGetKey, createRemoteJWKSet } from "jose";
import type { Config } from "../config.js";
import { AuthRequiredError, WalletNotFoundError } from "../errors.js";

export interface ResolvedUser {
  userId: string;
  walletAddress: `0x${string}`;
  /** Privy wallet ID — used when we ask Privy to sign or send a tx. */
  walletId: string;
  email?: string;
}

/**
 * Thin bridge over @privy-io/node. Owns:
 *  - access-token verification (Bearer tokens sent by MCP clients)
 *  - user → embedded-wallet resolution
 *  - server-side tx submission once a user has approved in the UI
 *
 * If Privy isn't configured (no app id/secret), the bridge is `null` and
 * the server only exposes the read-only tools.
 *
 * Token verification: pass a static SPKI public key via PRIVY_VERIFICATION_KEY
 * (recommended — no extra network call), or rely on the JWKS endpoint as a
 * fallback. The verification key can be copied from the Privy dashboard.
 */
export interface PrivyAuthOptions {
  verificationKey?: string;
  /** PKCS8 base64-encoded P-256 private key — bootstrap via scripts/bootstrap-auth-key.ts. */
  authorizationPrivateKey?: string;
  /** Privy key quorum ID that holds the public key — attached as an additional signer on new wallets. */
  keyQuorumId?: string;
}

export class PrivyAuthBridge {
  readonly client: PrivyClient;
  private readonly verificationKey: string | JWTVerifyGetKey;
  private readonly appId: string;
  private readonly authorizationPrivateKey?: string;
  private readonly keyQuorumId?: string;

  constructor(appId: string, appSecret: string, options: PrivyAuthOptions = {}) {
    this.appId = appId;
    this.client = new PrivyClient({ appId, appSecret });
    this.verificationKey =
      options.verificationKey ??
      createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`));
    this.authorizationPrivateKey = options.authorizationPrivateKey;
    this.keyQuorumId = options.keyQuorumId;
  }

  static fromConfig(config: Config): PrivyAuthBridge | null {
    if (!config.privyAppId || !config.privyAppSecret) return null;
    return new PrivyAuthBridge(config.privyAppId, config.privyAppSecret, {
      verificationKey: process.env.PRIVY_VERIFICATION_KEY,
      authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
      keyQuorumId: process.env.PRIVY_KEY_QUORUM_ID,
    });
  }

  get hasServerSigning(): boolean {
    return Boolean(this.authorizationPrivateKey && this.keyQuorumId);
  }

  /**
   * Verifies a Privy-issued access token. Throws AuthRequiredError if invalid.
   */
  async verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string }> {
    try {
      const payload = await verifyAccessToken({
        access_token: token,
        app_id: this.appId,
        verification_key: this.verificationKey,
      });
      return { userId: payload.user_id, sessionId: payload.session_id };
    } catch (err) {
      throw new AuthRequiredError(
        err instanceof Error ? `Invalid Privy token: ${err.message}` : "Invalid Privy token",
      );
    }
  }

  /**
   * Resolves a user ID to their embedded Ethereum wallet. Picks the first
   * embedded Ethereum wallet linked to the account — multi-wallet users will
   * need an account selector once we ship that UI.
   */
  async resolveUser(userId: string): Promise<ResolvedUser> {
    const user = await this.client.users()._get(userId);
    const linked = user.linked_accounts ?? [];

    let walletId: string | null = null;
    let address: string | null = null;
    for (const acc of linked) {
      if (!isEmbeddedWalletLinkedAccount(acc)) continue;
      if (acc.chain_type !== "ethereum") continue;
      if (!acc.id) continue;
      walletId = acc.id;
      address = acc.address;
      break;
    }

    if (!walletId || !address) throw new WalletNotFoundError();

    const userEmail = (user as unknown as { email?: { address?: string } | string | null }).email;
    const email =
      typeof userEmail === "string"
        ? userEmail
        : userEmail && typeof userEmail === "object"
          ? userEmail.address
          : undefined;

    return {
      userId,
      walletAddress: address as `0x${string}`,
      walletId,
      email,
    };
  }

  /**
   * Server-side tx submission via the user's Privy embedded wallet.
   * Called from the approval page once the user clicks Approve.
   *
   * The user's authorization for this specific call is captured by:
   *  1. The bearer token check at the route boundary (user is who they say).
   *  2. Privy wallet policies (configured per-app — allowlist, spend limits).
   *
   * For maximum-trust flows we sign in the browser instead via Privy's web SDK;
   * this server path exists for headless / programmatic approval contexts.
   */
  async sendTransaction(
    walletId: string,
    params: {
      caip2: string;
      to: `0x${string}`;
      value: `0x${string}`;
      data: `0x${string}`;
    },
  ): Promise<`0x${string}`> {
    if (!this.authorizationPrivateKey) {
      throw new Error(
        "PRIVY_AUTHORIZATION_PRIVATE_KEY is not set. Run `npm run bootstrap:auth-key` and follow the printed steps.",
      );
    }
    // EthereumSendTransactionRpcInput puts `caip2` at the top level of the
    // request body, NOT inside `params`. The `method` field is filled in by
    // the SDK helper. authorization_context tells Privy to sign the request
    // with our P-256 key — required for wallets we own.
    const res = (await this.client
      .wallets()
      .ethereum()
      .sendTransaction(walletId, {
        caip2: params.caip2,
        params: {
          transaction: {
            to: params.to,
            value: params.value,
            data: params.data,
          },
        },
        authorization_context: {
          authorization_private_keys: [this.authorizationPrivateKey],
        },
      } as unknown as Parameters<
        ReturnType<ReturnType<PrivyClient["wallets"]>["ethereum"]>["sendTransaction"]
      >[1])) as unknown as { hash?: string; data?: { hash?: string } };

    const hash = res.hash ?? res.data?.hash;
    if (!hash) throw new Error(`Privy did not return a tx hash: ${JSON.stringify(res)}`);
    return hash as `0x${string}`;
  }

  /**
   * Signs an EIP-712 typed-data payload with the user's embedded wallet.
   * Used for x402 EIP-3009 authorizations and other gasless signing flows.
   * Returns the raw 0x-prefixed signature.
   */
  async signTypedData(
    walletId: string,
    payload: {
      caip2: string;
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    },
  ): Promise<`0x${string}`> {
    if (!this.authorizationPrivateKey) {
      throw new Error("PRIVY_AUTHORIZATION_PRIVATE_KEY is not set.");
    }
    const res = (await this.client
      .wallets()
      .ethereum()
      .signTypedData(walletId, {
        caip2: payload.caip2,
        params: {
          typed_data: {
            domain: payload.domain,
            types: { ...payload.types, EIP712Domain: undefined },
            primaryType: payload.primaryType,
            message: payload.message,
          },
        },
        authorization_context: {
          authorization_private_keys: [this.authorizationPrivateKey],
        },
      } as unknown as Parameters<
        ReturnType<ReturnType<PrivyClient["wallets"]>["ethereum"]>["signTypedData"]
      >[1])) as unknown as { signature?: string; data?: { signature?: string } };
    const sig = res.signature ?? res.data?.signature;
    if (!sig) throw new Error(`Privy did not return a signature: ${JSON.stringify(res)}`);
    return sig as `0x${string}`;
  }

  /**
   * Creates a Privy policy with the given rules. Used by `PolicyMirror` to
   * mirror MCP session-key grants at the wallet layer.
   */
  async createPolicy(params: {
    chain_type: string;
    name: string;
    version: string;
    rules: unknown[];
  }): Promise<{ id: string }> {
    if (!this.authorizationPrivateKey || !this.keyQuorumId) {
      throw new Error("Privy authorization keys not configured");
    }
    const body = {
      ...(params as Record<string, unknown>),
      owner_id: this.keyQuorumId,
      authorization_context: {
        authorization_private_keys: [this.authorizationPrivateKey],
      },
    };
    const res = (await this.client.policies().create(body as never)) as unknown as {
      id: string;
    };
    return { id: res.id };
  }

  /** Sets (or clears) the policy_ids on a wallet. */
  async setWalletPolicyIds(walletId: string, policyIds: string[]): Promise<void> {
    if (!this.authorizationPrivateKey) {
      throw new Error("Privy authorization private key not configured");
    }
    await this.client.wallets()._update(walletId, {
      policy_ids: policyIds,
      authorization_context: {
        authorization_private_keys: [this.authorizationPrivateKey],
      },
    } as never);
  }

  /** Deletes a Privy policy by id. */
  async deletePolicy(policyId: string): Promise<void> {
    if (!this.authorizationPrivateKey) {
      throw new Error("Privy authorization private key not configured");
    }
    await this.client.policies()._delete(policyId, {
      authorization_context: {
        authorization_private_keys: [this.authorizationPrivateKey],
      },
    } as never);
  }

  /**
   * Creates a Privy user with an Ethereum embedded wallet. Used by
   * `create_user` for self-serve onboarding. If `email` is omitted we mint a
   * deterministic placeholder so Privy's required `linked_accounts` field has
   * something to chew on; callers can link a real account later.
   */
  async createUserWithWallet(opts: { email?: string }): Promise<ResolvedUser> {
    const email =
      opts.email ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@monad-mcp.local`;
    if (!this.keyQuorumId) {
      throw new Error(
        "PRIVY_KEY_QUORUM_ID is not set. Run `npm run bootstrap:auth-key` first so new wallets " +
          "are server-signable.",
      );
    }
    const user = await this.client.users().create({
      linked_accounts: [{ type: "email", address: email }],
      wallets: [
        {
          chain_type: "ethereum",
          additional_signers: [{ signer_id: this.keyQuorumId }],
        },
      ],
    });
    return this.resolveUser(user.id);
  }
}

/** Pulls the Bearer token out of an Authorization header, or returns null. */
export function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1] ?? null;
}
