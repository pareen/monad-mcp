import { encodeFunctionData, formatEther, parseEther } from "viem";
import { z } from "zod";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { aprioriVaultAbi } from "./abi.js";
import { aprioriAddressesFor } from "./config.js";

const stakeShape = {
  amount_mon: amountSchema,
  receiver: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const aprioriStakeTool: ToolDefinition<typeof stakeShape> = {
  name: "apriori_stake",
  title: "Stake MON for aprMON (aPriori)",
  description:
    "Deposits MON into the aPriori vault, minting aprMON. Native asset travels via msg.value; " +
    "aPriori is ERC-4626 so `assets` must equal `msg.value`. Auto-routes through an active " +
    "session-key grant when one covers the call.",
  kind: "write",
  inputSchema: stakeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = aprioriAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `aPriori vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }

    const assets = parseEther(args.amount_mon);
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: aprioriVaultAbi,
      functionName: "deposit",
      args: [assets, receiver],
    });
    const call = { to: vault, value: assets.toString(), data };
    const summary = `aPriori stake: deposit ${args.amount_mon} MON → aprMON (receiver ${receiver})`;

    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: { plugin: "apriori", action: "stake", vault, receiver },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      simulation: { assetChanges: [{ kind: "native", delta: `-${assets.toString()}` }] },
      pluginContext: { plugin: "apriori", action: "stake", vault, receiver },
      ttlMs: args.ttl_seconds * 1000,
    });
    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;
    return {
      text: `${summary}\nApprove: ${approvalUrl}`,
      structured: { request_id: stored.id, approval_url: approvalUrl, plugin: "apriori", vault },
    };
  },
};

const requestRedeemShape = {
  shares: amountSchema.describe('Amount of aprMON shares to redeem, e.g. "0.5".'),
  controller: addressSchema
    .optional()
    .describe("Controller address (per ERC-7540). Defaults to the staking wallet."),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const aprioriRequestRedeemTool: ToolDefinition<typeof requestRedeemShape> = {
  name: "apriori_request_redeem",
  title: "Request aprMON redemption (aPriori)",
  description:
    "Step 1 of the aPriori unstake flow: requestRedeem(shares, controller, owner). Returns a " +
    "request id you must persist client-side — pass it to `apriori_claim_redeem` after the " +
    "staking module's epoch (~12–18h).",
  kind: "write",
  inputSchema: requestRedeemShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = aprioriAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `aPriori vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }

    const shares = parseEther(args.shares);
    const controller = (args.controller ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: aprioriVaultAbi,
      functionName: "requestRedeem",
      args: [shares, controller, ctx.walletAddress],
    });
    const call = { to: vault, value: "0", data };
    const summary = `aPriori redeem request: queue ${args.shares} aprMON`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "apriori", action: "request_redeem", vault, controller },
      ttlMs: args.ttl_seconds * 1000,
    });
    return {
      text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}\nAfter approval, read the tx logs for the request id to use with apriori_claim_redeem.`,
      structured: {
        request_id: stored.id,
        approval_url: `${approvalUrlFor(ctx.server, stored)}`,
        plugin: "apriori",
      },
    };
  },
};

const claimShape = {
  request_ids: z
    .array(z.coerce.number().int().nonnegative())
    .min(1)
    .describe("Request IDs returned by previous requestRedeem calls."),
  receiver: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const aprioriClaimRedeemTool: ToolDefinition<typeof claimShape> = {
  name: "apriori_claim_redeem",
  title: "Claim processed redemptions (aPriori)",
  description:
    "Step 2 of the aPriori unstake flow: redeem(requestIDs, receiver). Pass the request ids " +
    "you saved from earlier requestRedeem calls.",
  kind: "write",
  inputSchema: claimShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = aprioriAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `aPriori vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const ids = args.request_ids.map((n) => BigInt(n));
    const data = encodeFunctionData({
      abi: aprioriVaultAbi,
      functionName: "redeem",
      args: [ids, receiver],
    });
    const call = { to: vault, value: "0", data };
    const summary = `aPriori claim: redeem ${ids.length} request(s) to ${receiver}`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "apriori", action: "claim", vault, ids: args.request_ids },
      ttlMs: args.ttl_seconds * 1000,
    });
    return {
      text: `${summary}\nApprove: ${approvalUrlFor(ctx.server, stored)}`,
      structured: {
        request_id: stored.id,
        approval_url: `${approvalUrlFor(ctx.server, stored)}`,
      },
    };
  },
};

const positionShape = {
  address: addressSchema.optional(),
  network: optionalNetwork,
};

export const aprioriPositionTool: ToolDefinition<typeof positionShape> = {
  name: "apriori_position",
  title: "Get aprMON position (aPriori)",
  description:
    "Reads the holder's aprMON balance and converts to underlying MON via convertToAssets.",
  kind: "read",
  inputSchema: positionShape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return { text: "No address provided.", structured: { error: "no_address" } };
    }
    const { vault } = aprioriAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `aPriori vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const [shareBalance, sharePrice] = await Promise.all([
      client.readContract({
        address: vault,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [target],
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: aprioriVaultAbi,
        functionName: "convertToAssets",
        args: [10n ** 18n],
      }) as Promise<bigint>,
    ]);
    const underlying = (shareBalance * sharePrice) / 10n ** 18n;

    return {
      text:
        `${target} aprMON balance: ${formatEther(shareBalance)} aprMON ≈ ${formatEther(underlying)} MON\n` +
        `Share price: 1 aprMON = ${formatEther(sharePrice)} MON (snapshot)`,
      structured: {
        holder: target,
        plugin: "apriori",
        vault,
        share_balance_wei: shareBalance.toString(),
        underlying_wei: underlying.toString(),
        share_price_wei: sharePrice.toString(),
      },
    };
  },
};
