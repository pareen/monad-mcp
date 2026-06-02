import { encodeFunctionData, parseUnits } from "viem";
import { z } from "zod";
import { erc20Abi } from "../../tools/abi.js";
import { approvalUrlFor } from "../../tools/approval-url.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";

const shape = {
  token: addressSchema.describe("ERC-20 token contract."),
  spender: addressSchema.describe("Contract authorized to spend tokens (e.g. Uniswap router)."),
  amount: amountSchema.describe(
    'Amount in token units. Pass "max" via a very large amount string for unlimited approval.',
  ),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const approveErc20Tool: ToolDefinition<typeof shape> = {
  name: "approve_erc20",
  title: "Approve an ERC-20 spender",
  description:
    "Builds an unsigned ERC-20 approve() and returns an approval URL. Typically used before " +
    "a swap when the router doesn't have allowance yet.",
  kind: "write",
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) {
      throw new Error("unreachable: write-tool auth checked by registry");
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const [decimals, symbol] = await Promise.all([
      client.readContract({
        address: args.token,
        abi: erc20Abi,
        functionName: "decimals",
      }) as Promise<number>,
      client
        .readContract({ address: args.token, abi: erc20Abi, functionName: "symbol" })
        .catch(() => "TOKEN") as Promise<string>,
    ]);

    const amountUnits = parseUnits(args.amount, decimals);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [args.spender, amountUnits],
    });

    const summary = `Approve ${args.amount} ${symbol} for spender ${args.spender}`;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call: { to: args.token, value: "0", data },
      simulation: {
        assetChanges: [
          {
            kind: "erc20",
            token: args.token,
            symbol,
            decimals,
            delta: "0", // approval doesn't move tokens
          },
        ],
      },
      pluginContext: {
        plugin: "core",
        action: "approve",
        spender: args.spender,
        amount: amountUnits.toString(),
      },
      ttlMs: args.ttl_seconds * 1000,
    });

    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;
    return {
      text: `Approval prepared: ${summary}.\n${approvalUrl}\nPoll with request_id=${stored.id}.`,
      structured: { request_id: stored.id, approval_url: approvalUrl, summary },
    };
  },
};
