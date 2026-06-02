import { randomBytes } from "node:crypto";
import { z } from "zod";
import { MONAD_MAINNET_ID, MONAD_TESTNET_ID } from "../chains/monad.js";
import { AuthRequiredError } from "../errors.js";
import { findCanonicalToken } from "../tokens/canonical.js";
import type { PaymentRequirements, X402PaymentPayload, X402Response } from "../x402/types.js";
import type { ToolDefinition } from "./registry.js";
import { optionalNetwork } from "./schemas.js";

const httpsUrlSchema = z.string().url();

const shape = {
  url: httpsUrlSchema.describe("Service URL to pay for."),
  method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method for the resource fetch."),
  body: z.string().optional().describe("Request body (POST only)."),
  max_amount_usdc: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe(
      'Maximum USDC the agent may spend on this request, decimal string e.g. "0.10". Hard cap — refuse to pay anything more.',
    ),
  network: optionalNetwork,
};

function isMonadNetworkId(s: string): boolean {
  return (
    s.toLowerCase() === "monad" ||
    s.toLowerCase() === "monad-mainnet" ||
    s.toLowerCase() === "monad-testnet"
  );
}

function chainIdForNetwork(network: "mainnet" | "testnet"): number {
  return network === "mainnet" ? MONAD_MAINNET_ID : MONAD_TESTNET_ID;
}

function pickAcceptable(
  accepts: PaymentRequirements[],
  network: "mainnet" | "testnet",
  maxUsdcRaw: bigint,
  usdcAddress: `0x${string}`,
): PaymentRequirements | null {
  for (const r of accepts) {
    if (r.scheme !== "exact") continue;
    if (!isMonadNetworkId(r.network)) continue;
    if (r.asset.toLowerCase() !== usdcAddress.toLowerCase()) continue;
    if (BigInt(r.maxAmountRequired) > maxUsdcRaw) continue;
    return r;
  }
  return null;
}

export const payForServiceTool: ToolDefinition<typeof shape> = {
  name: "pay_for_service",
  title: "Pay for an x402-protected service",
  description:
    "Fetches `url`. If the server returns HTTP 402, signs an EIP-3009 USDC transferWithAuthorization " +
    "via Privy, retries with the X-PAYMENT header, and returns the resulting body. The agent must " +
    "specify `max_amount_usdc` as a hard ceiling — requests demanding more are refused.",
  kind: "write",
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new AuthRequiredError();
    if (!ctx.server.auth) {
      throw new Error("Privy is not configured — cannot sign payments.");
    }

    const usdc = findCanonicalToken("USDC", ctx.network);
    if (!usdc || usdc.address === "native") {
      return {
        text: `USDC is not configured on Monad ${ctx.network}.`,
        structured: { error: "usdc_not_configured", network: ctx.network },
      };
    }
    const usdcAddress = usdc.address as `0x${string}`;
    const usdcDecimals = usdc.decimals;
    const maxUsdcRaw = BigInt(Math.round(Number(args.max_amount_usdc) * 10 ** usdcDecimals));

    // 1. Initial fetch
    const init: RequestInit = { method: args.method };
    if (args.body && args.method === "POST") {
      init.body = args.body;
      init.headers = { "Content-Type": "application/json" };
    }
    const firstResp = await fetch(args.url, init);
    if (firstResp.status !== 402) {
      const text = await firstResp.text();
      return {
        text: `${args.method} ${args.url} → ${firstResp.status}\n${text.slice(0, 500) || "(empty body)"}`,
        structured: {
          status: firstResp.status,
          paid: false,
          body: text,
        },
      };
    }

    // 2. Parse payment requirements
    const requirements = (await firstResp.json()) as X402Response;
    const chosen = pickAcceptable(requirements.accepts, ctx.network, maxUsdcRaw, usdcAddress);
    if (!chosen) {
      return {
        text: `No acceptable payment option in 402 response.\nAvailable: ${requirements.accepts.map((r) => `${r.scheme}/${r.network} ${r.asset} ${r.maxAmountRequired}`).join(", ")}\nCaller's limit: ${maxUsdcRaw} (raw USDC) on ${usdcAddress}.`,
        structured: {
          status: 402,
          paid: false,
          accepts: requirements.accepts,
          rejected_reason: "no_acceptable_terms",
        },
      };
    }

    // 3. Build + sign EIP-3009 authorization
    const now = Math.floor(Date.now() / 1000);
    const validAfter = BigInt(now - 60); // small window in the past
    const validBefore = BigInt(now + chosen.maxTimeoutSeconds);
    const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

    const resolved = await ctx.server.auth.resolveUser(ctx.userId);

    const domain = {
      name: usdc.name,
      version: "2",
      chainId: chainIdForNetwork(ctx.network),
      verifyingContract: usdcAddress,
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const message = {
      from: ctx.walletAddress,
      to: chosen.payTo,
      value: chosen.maxAmountRequired,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    };

    const signature = await ctx.server.auth.signTypedData(resolved.walletId, {
      caip2:
        ctx.network === "mainnet" ? `eip155:${MONAD_MAINNET_ID}` : `eip155:${MONAD_TESTNET_ID}`,
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
    });

    // 4. Pack payload + retry
    const payload: X402PaymentPayload = {
      x402Version: 1,
      scheme: chosen.scheme,
      network: chosen.network,
      payload: {
        signature,
        authorization: {
          from: ctx.walletAddress,
          to: chosen.payTo,
          value: chosen.maxAmountRequired,
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };
    const headerValue = Buffer.from(JSON.stringify(payload)).toString("base64");

    const retryInit: RequestInit = {
      method: args.method,
      headers: {
        "X-PAYMENT": headerValue,
        ...(args.body ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (args.body && args.method === "POST") retryInit.body = args.body;

    const retryResp = await fetch(args.url, retryInit);
    const retryBody = await retryResp.text();

    return {
      text:
        `Paid ${chosen.maxAmountRequired} (raw USDC) to ${chosen.payTo} for ${args.url}\n` +
        `Status: ${retryResp.status}\n${retryBody.slice(0, 1000)}`,
      structured: {
        paid: retryResp.ok,
        status: retryResp.status,
        body: retryBody,
        payment: {
          asset: usdcAddress,
          amount_raw: chosen.maxAmountRequired,
          amount_usdc: Number(chosen.maxAmountRequired) / 10 ** usdcDecimals,
          pay_to: chosen.payTo,
          network: chosen.network,
          scheme: chosen.scheme,
          valid_until: Number(validBefore),
        },
      },
    };
  },
};
