/**
 * x402 v1 payment requirements (subset). The full spec is at
 * https://x402.org but the canonical fields are stable.
 *
 * Server returns this JSON body when responding 402; we extract `accepts[0]`
 * (or the entry matching our scheme/network) and use it to build a signed
 * authorization.
 */
export interface PaymentRequirements {
  /** Settlement scheme. v1 ships with "exact" (EIP-3009 transferWithAuthorization). */
  scheme: string;
  /** Network identifier — e.g. "monad", "monad-mainnet". */
  network: string;
  /** Amount required, in the asset's smallest unit (decimal string). */
  maxAmountRequired: string;
  /** Resource URL the user wants to access. */
  resource: string;
  /** Human-readable description of what's being paid for. */
  description?: string;
  /** Asset (ERC-20 contract) the payment must be in. */
  asset: `0x${string}`;
  /** Address that should receive the payment. */
  payTo: `0x${string}`;
  /** Required validity window — usually <= 300 seconds. */
  maxTimeoutSeconds: number;
  /** Optional extra arguments (e.g. memos). */
  extra?: Record<string, unknown>;
}

export interface X402Response {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
}

/**
 * Payload packed into the X-PAYMENT header on retry. Base64-encoded JSON.
 */
export interface X402PaymentPayload {
  x402Version: 1;
  scheme: string;
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
}
