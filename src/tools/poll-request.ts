import { z } from "zod";
import { type ToolDefinition, txExplorerUrl } from "./registry.js";

const shape = {
  request_id: z.string().uuid().describe("The stored-request ID returned by a write tool."),
};

/**
 * Lets the agent check whether a stored request has been approved by the user.
 * Designed for short polling — the agent calls this periodically after handing
 * the user an approval URL.
 */
export const pollRequestTool: ToolDefinition<typeof shape> = {
  name: "poll_request",
  title: "Poll a pending approval request",
  description:
    "Checks the status of a stored transaction request. Returns one of: " +
    "pending (user hasn't approved yet), approved (with tx hash), rejected, or expired.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const req = await ctx.server.store.get(args.request_id);
    if (!req) {
      return {
        text: `Request ${args.request_id} not found.`,
        structured: { request_id: args.request_id, status: "not_found" },
      };
    }

    if (req.status === "approved" && req.txHash) {
      return {
        text: `Request ${req.id} approved. tx_hash=${req.txHash}\n${txExplorerUrl(req.network, req.txHash)}`,
        structured: {
          request_id: req.id,
          status: req.status,
          tx_hash: req.txHash,
          network: req.network,
          explorer_url: txExplorerUrl(req.network, req.txHash),
        },
      };
    }

    return {
      text: `Request ${req.id} is ${req.status}${
        req.status === "pending" ? " — waiting for user approval." : "."
      }${req.rejectionReason ? ` Reason: ${req.rejectionReason}` : ""}`,
      structured: {
        request_id: req.id,
        status: req.status,
        rejection_reason: req.rejectionReason,
        expires_at: req.expiresAt,
      },
    };
  },
};
