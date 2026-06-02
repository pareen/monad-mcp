import { encodeFunctionData, formatEther, parseEther } from "viem";
import { z } from "zod";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { kintsuVaultAbi } from "./abi.js";
import { kintsuAddressesFor } from "./config.js";

const stakeShape = {
  amount_mon: amountSchema.describe('Amount of MON to stake, e.g. "1.5".'),
  receiver: addressSchema
    .optional()
    .describe("Address to receive sMON. Defaults to the staking wallet."),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const kintsuStakeTool: ToolDefinition<typeof stakeShape> = {
  name: "kintsu_stake",
  title: "Stake MON for sMON (Kintsu)",
  description:
    "Deposits MON into the Kintsu vault, minting sMON shares. The native asset goes as msg.value; " +
    "Kintsu is an ERC-7535 vault so `assets` must equal `msg.value`. Auto-executes under an " +
    "active session-key grant; otherwise returns an approval URL.",
  kind: "write",
  inputSchema: stakeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = kintsuAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `Kintsu vault not configured for Monad ${ctx.network}. Set KINTSU_${ctx.network.toUpperCase()}_VAULT.`,
        structured: { error: "vault_not_configured", network: ctx.network },
      };
    }

    const assets = parseEther(args.amount_mon);
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: kintsuVaultAbi,
      functionName: "deposit",
      args: [assets, receiver],
    });
    const call = { to: vault, value: assets.toString(), data };
    const summary = `Kintsu stake: deposit ${args.amount_mon} MON → sMON (receiver ${receiver})`;

    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: { plugin: "kintsu", action: "stake", vault, receiver },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      simulation: {
        assetChanges: [{ kind: "native", delta: `-${assets.toString()}` }],
      },
      pluginContext: { plugin: "kintsu", action: "stake", vault, receiver },
      ttlMs: args.ttl_seconds * 1000,
    });

    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;
    return {
      text: `${summary}\nApprove: ${approvalUrl}\nPoll request_id=${stored.id}`,
      structured: {
        request_id: stored.id,
        approval_url: approvalUrl,
        plugin: "kintsu",
        vault,
        receiver,
      },
    };
  },
};

const unstakeShape = {
  shares: amountSchema.describe('Amount of sMON shares to unlock, e.g. "0.5".'),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const kintsuRequestUnstakeTool: ToolDefinition<typeof unstakeShape> = {
  name: "kintsu_request_unstake",
  title: "Request to unstake sMON (Kintsu)",
  description:
    "Step 1 of the Kintsu unstake flow: calls requestUnlock(shares) to queue a withdrawal. " +
    "Kintsu batches unlocks; after the batch processes, call `kintsu_claim_unstake` with the " +
    "unlock index. No assets move on this call.",
  kind: "write",
  inputSchema: unstakeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = kintsuAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `Kintsu vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }

    const shares = parseEther(args.shares);
    const data = encodeFunctionData({
      abi: kintsuVaultAbi,
      functionName: "requestUnlock",
      args: [shares],
    });
    const call = { to: vault, value: "0", data };
    const summary = `Kintsu unstake request: queue ${args.shares} sMON for batch unlock`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "kintsu", action: "request_unstake", vault },
      ttlMs: args.ttl_seconds * 1000,
    });
    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;
    return {
      text: `${summary}\nApprove: ${approvalUrl}`,
      structured: { request_id: stored.id, approval_url: approvalUrl, plugin: "kintsu" },
    };
  },
};

const claimShape = {
  unlock_index: z.coerce.number().int().nonnegative().describe("Index returned by requestUnlock."),
  receiver: addressSchema.optional(),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const kintsuClaimUnstakeTool: ToolDefinition<typeof claimShape> = {
  name: "kintsu_claim_unstake",
  title: "Claim a processed unstake (Kintsu)",
  description:
    "Step 2 of the Kintsu unstake flow: calls redeem(unlockIndex, receiver). Only works after " +
    "the batch containing your request has been processed (see Kintsu docs for batch cadence).",
  kind: "write",
  inputSchema: claimShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = kintsuAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `Kintsu vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }

    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: kintsuVaultAbi,
      functionName: "redeem",
      args: [BigInt(args.unlock_index), receiver],
    });
    const call = { to: vault, value: "0", data };
    const summary = `Kintsu claim: redeem unlock #${args.unlock_index} to ${receiver}`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "kintsu", action: "claim", vault, unlock_index: args.unlock_index },
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

export const kintsuPositionTool: ToolDefinition<typeof positionShape> = {
  name: "kintsu_position",
  title: "Get sMON position (Kintsu)",
  description:
    "Reads the holder's sMON balance and converts to underlying MON via convertToAssets. " +
    "Returns the share price (assets per share) as a snapshot — APY requires sampling this " +
    "over time (Kintsu has no on-chain APY oracle).",
  kind: "read",
  inputSchema: positionShape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return {
        text: "No address provided and no authenticated wallet.",
        structured: { error: "no_address" },
      };
    }
    const { vault } = kintsuAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `Kintsu vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);

    const [shareBalance, sharePrice, totalAssets] = await Promise.all([
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
        abi: kintsuVaultAbi,
        functionName: "convertToAssets",
        args: [10n ** 18n],
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: kintsuVaultAbi,
        functionName: "totalAssets",
      }) as Promise<bigint>,
    ]);

    const underlying = (shareBalance * sharePrice) / 10n ** 18n;

    return {
      text:
        `${target} sMON balance: ${formatEther(shareBalance)} sMON ≈ ${formatEther(underlying)} MON\n` +
        `Share price: 1 sMON = ${formatEther(sharePrice)} MON (snapshot)\n` +
        `Vault TVL: ${formatEther(totalAssets)} MON`,
      structured: {
        holder: target,
        plugin: "kintsu",
        vault,
        share_balance_wei: shareBalance.toString(),
        underlying_wei: underlying.toString(),
        share_price_wei: sharePrice.toString(),
        total_assets_wei: totalAssets.toString(),
      },
    };
  },
};
