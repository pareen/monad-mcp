import { encodeFunctionData, parseUnits } from "viem";
import { z } from "zod";
import { MONAD_MAINNET_ID } from "../chains/monad.js";
import { approvalUrlFor } from "./approval-url.js";
import { tryExecuteViaGrant } from "./grant-exec.js";
import type { ToolDefinition } from "./registry.js";
import { addressSchema, amountSchema } from "./schemas.js";

/**
 * LiFi REST aggregator — https://docs.li.fi/li.fi-api/li.fi-api
 * No API key required for basic quotes; rate-limited.
 */
const LIFI_BASE = "https://li.quest/v1";

interface LifiQuote {
  type: string;
  tool: string;
  toolDetails?: { name?: string };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { address: string; symbol: string; decimals: number };
    toToken: { address: string; symbol: string; decimals: number };
    fromAmount: string;
    toAmount?: string;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    executionDuration?: number;
    feeCosts?: Array<{ name: string; amountUSD?: string }>;
    gasCosts?: Array<{ amountUSD?: string }>;
  };
  transactionRequest?: {
    to?: string;
    value?: string;
    data?: string;
    chainId?: number;
    gasLimit?: string;
  };
  includedSteps?: Array<{ tool: string; type: string }>;
}

interface LifiError {
  message?: string;
  code?: string;
}

async function fetchLifi<T>(path: string): Promise<T> {
  const res = await fetch(`${LIFI_BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "monad-mcp/0.1" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as LifiError;
    throw new Error(`LiFi ${res.status}: ${body.message ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

// ───────── bridge_quote ─────────
const quoteShape = {
  from_chain_id: z.coerce
    .number()
    .int()
    .positive()
    .describe("Source chain ID (e.g. 1=Ethereum, 10=Optimism, 42161=Arbitrum)."),
  from_token: z.string().describe("Source token: 0x address, or '0x0000…0000' for native."),
  to_token: z.string().describe("Destination token on Monad (0x address) or 'MON' for native."),
  amount: amountSchema.describe("Amount in source token, decimal e.g. '10'."),
  from_decimals: z.coerce.number().int().min(0).max(36).default(18),
  recipient: addressSchema
    .optional()
    .describe("Address on Monad to receive bridged tokens. Defaults to the user's wallet."),
  slippage_bps: z.coerce
    .number()
    .int()
    .min(0)
    .max(5000)
    .default(50)
    .describe("Default 50 bps = 0.5%."),
};

export const bridgeQuoteTool: ToolDefinition<typeof quoteShape> = {
  name: "bridge_quote",
  title: "Get a bridge quote into Monad (LiFi)",
  description:
    "Queries the LiFi aggregator for the cheapest/fastest route from another chain into Monad " +
    "(chain id 143). Returns the chosen route + transaction request you can submit on the source " +
    "chain. If Monad isn't yet listed by LiFi, returns a clear error.",
  kind: "read",
  inputSchema: quoteShape,
  handler: async (args, ctx) => {
    const recipient = (args.recipient ?? ctx.walletAddress) as `0x${string}` | null;
    if (!recipient) {
      return {
        text: "No recipient provided and no authenticated wallet.",
        structured: { error: "no_recipient" },
      };
    }
    const fromAmount = parseUnits(args.amount, args.from_decimals).toString();
    const toToken =
      args.to_token.toUpperCase() === "MON"
        ? "0x0000000000000000000000000000000000000000"
        : args.to_token;
    const params = new URLSearchParams({
      fromChain: String(args.from_chain_id),
      toChain: String(MONAD_MAINNET_ID),
      fromToken: args.from_token,
      toToken,
      fromAmount,
      fromAddress: recipient,
      toAddress: recipient,
      slippage: (args.slippage_bps / 10_000).toString(),
    });

    try {
      const quote = await fetchLifi<LifiQuote>(`/quote?${params.toString()}`);
      const feeUsd = (quote.estimate.feeCosts ?? []).reduce(
        (acc, f) => acc + Number(f.amountUSD ?? 0),
        0,
      );
      const gasUsd = (quote.estimate.gasCosts ?? []).reduce(
        (acc, g) => acc + Number(g.amountUSD ?? 0),
        0,
      );
      return {
        text: `Bridge route: ${args.amount} ${quote.action.fromToken.symbol} (chain ${args.from_chain_id}) → ${quote.action.toToken.symbol} on Monad via ${quote.tool}\n  toAmount: ${quote.estimate.toAmount} (raw)\n  ETA: ${quote.estimate.executionDuration ?? "?"}s   fees: $${feeUsd.toFixed(4)}   gas: $${gasUsd.toFixed(4)}\n  steps: ${quote.includedSteps?.map((s) => `${s.tool}/${s.type}`).join(" → ") ?? "(direct)"}\n${
          quote.transactionRequest
            ? `  source-chain tx: to=${quote.transactionRequest.to}  value=${quote.transactionRequest.value ?? "0"}`
            : "  (no transactionRequest returned — try a different route)"
        }`,
        structured: {
          provider: "lifi",
          tool: quote.tool,
          tool_name: quote.toolDetails?.name,
          from_chain: args.from_chain_id,
          to_chain: MONAD_MAINNET_ID,
          from_token: quote.action.fromToken,
          to_token: quote.action.toToken,
          from_amount: quote.estimate.fromAmount,
          to_amount: quote.estimate.toAmount,
          eta_seconds: quote.estimate.executionDuration,
          fee_usd: feeUsd,
          gas_usd: gasUsd,
          transaction_request: quote.transactionRequest,
          steps: quote.includedSteps,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // LiFi returns 404 / NotFound when no route is available.
      return {
        text: `No bridge route found: ${msg}`,
        structured: { error: "no_route", details: msg },
      };
    }
  },
};

// ───────── bridge_execute (source-chain only) ─────────
const executeShape = {
  to: addressSchema,
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
  value_wei: z.string().regex(/^\d+$/).default("0"),
  chain_id: z.coerce.number().int().positive(),
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(600),
};

/**
 * Executes the source-chain leg of a bridge — submits the bridge contract call
 * returned by `bridge_quote` to whatever EVM chain it lives on. Note: our
 * Privy bridge currently only signs for Monad chains (143/10143). Calls on
 * other chains require either (a) the user to send the tx from a different
 * wallet, or (b) Privy embedded wallet support for the source chain.
 *
 * For v1 this tool builds the stored request and returns an approval URL; the
 * approval page will need source-chain support to actually submit. Documented
 * as a known gap.
 */
export const bridgeExecuteTool: ToolDefinition<typeof executeShape> = {
  name: "bridge_execute",
  title: "Execute a bridge transaction (source chain)",
  description:
    "Submits the source-chain transaction returned by `bridge_quote`. Currently the server-side " +
    "submitter only signs on Monad — for cross-chain submission, open the approval URL on a " +
    "wallet that supports the source chain.",
  kind: "write",
  inputSchema: executeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");

    if (args.chain_id === MONAD_MAINNET_ID || args.chain_id === 10143) {
      // Monad source — the same code path as a normal write_contract call.
      const call = {
        to: args.to,
        value: args.value_wei,
        data: args.data as `0x${string}`,
      };
      const summary = `Bridge tx on Monad chain ${args.chain_id}`;
      const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
      if (viaGrant) return viaGrant;
      const stored = await ctx.server.store.create({
        userId: ctx.userId,
        network: ctx.network,
        walletAddress: ctx.walletAddress,
        summary,
        call,
        pluginContext: { tool: "bridge_execute", chain_id: args.chain_id },
        ttlMs: args.ttl_seconds * 1000,
      });
      return {
        text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}`,
        structured: {
          request_id: stored.id,
          approval_url: `${approvalUrlFor(ctx.server, stored)}`,
          source: "monad",
        },
      };
    }

    // Non-Monad source chain — we can't sign here.
    return {
      text:
        `Source chain ${args.chain_id} is not Monad — this server's Privy wallet can't sign there.\n` +
        `Submit this tx from a wallet that supports chain ${args.chain_id}:\n` +
        `  to: ${args.to}\n  value: ${args.value_wei}\n  data: ${args.data}`,
      structured: {
        error: "source_chain_not_supported",
        chain_id: args.chain_id,
        manual_submit: { to: args.to, value: args.value_wei, data: args.data },
      },
    };
  },
};

// Mark unused imports as used.
void encodeFunctionData;
