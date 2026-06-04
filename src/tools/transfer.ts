import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { z } from "zod";
import { erc20Abi } from "./abi.js";
import { approvalUrlFor } from "./approval-url.js";
import { shortAddr } from "./format.js";
import { tryExecuteViaGrant } from "./grant-exec.js";
import type { ToolDefinition } from "./registry.js";
import { resolveToolRecipient } from "./resolve-account.js";
import { addressSchema, amountSchema, optionalNetwork, recipientSchema } from "./schemas.js";

const shape = {
  to: recipientSchema.describe(
    "Recipient — a 0x address or a Nad Name Service name like 'keone.nad' (resolved on-chain).",
  ),
  amount: amountSchema.describe('Amount to send, as a decimal string e.g. "1.5".'),
  token: addressSchema.optional().describe("ERC-20 token address. Omit to send native MON."),
  network: optionalNetwork,
  ttl_seconds: z.coerce
    .number()
    .int()
    .positive()
    .max(3600)
    .default(300)
    .describe("How long the approval link stays valid. Defaults to 5 minutes."),
};

export const transferTool: ToolDefinition<typeof shape> = {
  name: "transfer",
  title: "Send MON or an ERC-20 token",
  description:
    "Builds an unsigned transfer transaction (native MON or ERC-20) and returns an approval URL. " +
    "The user opens the URL, reviews the transaction in their Privy wallet, and approves or rejects it. " +
    "After approval, poll the request with `poll_request` to retrieve the tx hash.",
  kind: "write",
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) {
      throw new Error("unreachable: write-tool auth was checked by the registry");
    }

    const client = ctx.server.clients.publicClient(ctx.network);

    // Accept either a 0x address or a `.nad` name. Resolving here (rather than
    // in the schema) lets us reach the chain and surface a clear error the
    // agent can relay if the name doesn't resolve.
    const recipient = await resolveToolRecipient(ctx, args.to);
    // How the recipient reads in the summary / approval UI: name + short addr
    // when resolved from a name, otherwise just the address.
    const recipientLabel = recipient.name
      ? `${recipient.name} (${shortAddr(recipient.address)})`
      : recipient.address;

    let call: { to: `0x${string}`; value: string; data: `0x${string}` };
    let summary: string;
    let assetChange: {
      kind: "native" | "erc20";
      token?: `0x${string}`;
      symbol?: string;
      decimals?: number;
      delta: string;
    };

    if (!args.token) {
      const wei = parseEther(args.amount);
      call = { to: recipient.address, value: wei.toString(), data: "0x" };
      summary = `Send ${args.amount} MON to ${recipientLabel}`;
      assetChange = { kind: "native", delta: `-${wei.toString()}` };
    } else {
      // Look up decimals + symbol so the approval UI can render a clean diff.
      const [decimals, symbol] = await Promise.all([
        client.readContract({
          address: args.token,
          abi: erc20Abi,
          functionName: "decimals",
        }) as Promise<number>,
        client
          .readContract({
            address: args.token,
            abi: erc20Abi,
            functionName: "symbol",
          })
          .catch(() => "TOKEN") as Promise<string>,
      ]);

      const amountUnits = parseUnits(args.amount, decimals);
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient.address, amountUnits],
      });
      call = { to: args.token, value: "0", data };
      summary = `Send ${args.amount} ${symbol} to ${recipientLabel}`;
      assetChange = {
        kind: "erc20",
        token: args.token,
        symbol,
        decimals,
        delta: `-${amountUnits.toString()}`,
      };
    }

    // Best-effort gas estimate. Don't fail the call if the node refuses to
    // simulate — the approval page will re-estimate at signing time.
    let estimatedGas: string | undefined;
    try {
      const gas = await client.estimateGas({
        account: ctx.walletAddress,
        to: call.to,
        value: BigInt(call.value),
        data: call.data,
      });
      estimatedGas = gas.toString();
    } catch {
      estimatedGas = undefined;
    }

    // If the user has an active session-key grant covering this call,
    // execute immediately and skip the approval URL.
    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: {
        network: ctx.network,
        from: ctx.walletAddress,
        summary,
        call,
        simulation: { assetChanges: [assetChange], estimatedGas },
      },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      simulation: {
        assetChanges: [assetChange],
        estimatedGas,
      },
      ttlMs: args.ttl_seconds * 1000,
    });

    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;

    return {
      text:
        `Transaction prepared: ${summary}\n` +
        `Open this link to review and approve:\n${approvalUrl}\n` +
        `Then call \`poll_request\` with request_id=${stored.id} to get the tx hash. Link expires in ${args.ttl_seconds}s.`,
      structured: {
        request_id: stored.id,
        approval_url: approvalUrl,
        network: ctx.network,
        from: ctx.walletAddress,
        to: recipient.address,
        ...(recipient.name ? { recipient_name: recipient.name } : {}),
        summary,
        call,
        simulation: stored.simulation,
        expires_at: stored.expiresAt,
      },
    };
  },
};
