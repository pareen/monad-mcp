import { z } from "zod";
import type { ToolDefinition } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const shape = {
  to: addressSchema,
  data: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/)
    .default("0x"),
  value_wei: z.string().regex(/^\d+$/).default("0"),
  from: addressSchema
    .optional()
    .describe("Sender address. Defaults to the authenticated wallet, then to zero."),
  network: optionalNetwork,
};

/**
 * Dry-run a transaction via eth_call. Returns the raw return data on success
 * or the revert reason on failure. Doesn't include state-change traces — for
 * that you'd need Tenderly or a custom tracer; out of scope for v1.
 */
export const simulateTransactionTool: ToolDefinition<typeof shape> = {
  name: "simulate_transaction",
  title: "Dry-run a transaction (eth_call)",
  description:
    "Calls eth_call against the latest block to preview the outcome of a transaction. Returns " +
    "raw return data on success, or the decoded revert reason on failure. Useful before approving " +
    "a swap, contract call, or bridge to confirm it won't revert.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const client = ctx.server.clients.publicClient(ctx.network);
    const from = (args.from ?? ctx.walletAddress ?? undefined) as `0x${string}` | undefined;
    try {
      const result = await client.call({
        account: from,
        to: args.to,
        value: BigInt(args.value_wei),
        data: args.data as `0x${string}`,
      });
      const returnData = result.data ?? "0x";
      return {
        text: `simulate ${args.to} OK\n  return data: ${returnData}\n  (no revert — this transaction would succeed at the current head)`,
        structured: {
          ok: true,
          return_data: returnData,
          from,
          to: args.to,
          value_wei: args.value_wei,
          network: ctx.network,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // viem extracts the revert reason into the error message when possible.
      return {
        text: `simulate ${args.to} REVERTED\n  ${msg}`,
        structured: {
          ok: false,
          revert_reason: msg,
          from,
          to: args.to,
          value_wei: args.value_wei,
        },
      };
    }
  },
};
