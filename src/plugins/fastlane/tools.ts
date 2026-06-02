import { encodeFunctionData, formatEther, parseEther } from "viem";
import { z } from "zod";
import { approvalUrlFor } from "../../tools/approval-url.js";
import { tryExecuteViaGrant } from "../../tools/grant-exec.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { addressSchema, amountSchema, optionalNetwork } from "../../tools/schemas.js";
import { shmonadVaultAbi } from "./abi.js";
import { fastlaneAddressesFor } from "./config.js";

const stakeShape = {
  amount_mon: amountSchema.describe('Amount of MON to stake, e.g. "1.5".'),
  receiver: addressSchema
    .optional()
    .describe("Address to receive shMON. Defaults to the staking wallet."),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const fastlaneStakeTool: ToolDefinition<typeof stakeShape> = {
  name: "fastlane_stake",
  title: "Stake MON for shMON (FastLane shMONAD)",
  description:
    "Deposits MON into the FastLane shMONAD vault, minting shMON. shMONAD is an ERC-4626 vault " +
    "with a payable native deposit — the MON travels as msg.value, so `assets` must equal it. " +
    "Auto-executes under an active session-key grant; otherwise returns an approval URL.",
  kind: "write",
  inputSchema: stakeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = fastlaneAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `FastLane shMONAD vault not configured for Monad ${ctx.network}. Set FASTLANE_${ctx.network.toUpperCase()}_VAULT.`,
        structured: { error: "vault_not_configured", network: ctx.network },
      };
    }

    const assets = parseEther(args.amount_mon);
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: shmonadVaultAbi,
      functionName: "deposit",
      args: [assets, receiver],
    });
    const call = { to: vault, value: assets.toString(), data };
    const summary = `FastLane stake: deposit ${args.amount_mon} MON → shMON (receiver ${receiver})`;

    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: { plugin: "fastlane", action: "stake", vault, receiver },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      simulation: { assetChanges: [{ kind: "native", delta: `-${assets.toString()}` }] },
      pluginContext: { plugin: "fastlane", action: "stake", vault, receiver },
      ttlMs: args.ttl_seconds * 1000,
    });
    const approvalUrl = approvalUrlFor(ctx.server, stored);
    return {
      text: `${summary}\nApprove: ${approvalUrl}`,
      structured: { request_id: stored.id, approval_url: approvalUrl, plugin: "fastlane", vault },
    };
  },
};

const unstakeShape = {
  shares: amountSchema.describe('Amount of shMON shares to redeem, e.g. "0.5".'),
  receiver: addressSchema
    .optional()
    .describe("Address to receive the unstaked MON. Defaults to the staking wallet."),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const fastlaneUnstakeTool: ToolDefinition<typeof unstakeShape> = {
  name: "fastlane_unstake",
  title: "Unstake shMON for MON (FastLane shMONAD)",
  description:
    "Redeems shMON shares back to MON via the ERC-4626 redeem(shares, receiver, owner). Unlike " +
    "epoch-based LSTs, shMONAD redemption is synchronous — the MON is returned in the same tx. " +
    "Auto-executes under a session-key grant; otherwise returns an approval URL.",
  kind: "write",
  inputSchema: unstakeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const { vault } = fastlaneAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `FastLane shMONAD vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }

    const shares = parseEther(args.shares);
    const receiver = (args.receiver ?? ctx.walletAddress) as `0x${string}`;
    const data = encodeFunctionData({
      abi: shmonadVaultAbi,
      functionName: "redeem",
      args: [shares, receiver, ctx.walletAddress],
    });
    const call = { to: vault, value: "0", data };
    const summary = `FastLane unstake: redeem ${args.shares} shMON → MON (receiver ${receiver})`;

    const viaGrant = await tryExecuteViaGrant({ ctx, call, summary });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { plugin: "fastlane", action: "unstake", vault, receiver },
      ttlMs: args.ttl_seconds * 1000,
    });
    const approvalUrl = approvalUrlFor(ctx.server, stored);
    return {
      text: `${summary}\nApprove: ${approvalUrl}`,
      structured: { request_id: stored.id, approval_url: approvalUrl, plugin: "fastlane", vault },
    };
  },
};

const positionShape = {
  address: addressSchema.optional(),
  network: optionalNetwork,
};

export const fastlanePositionTool: ToolDefinition<typeof positionShape> = {
  name: "fastlane_position",
  title: "Get shMON position (FastLane shMONAD)",
  description:
    "Reads the holder's shMON balance and converts to underlying MON via convertToAssets, plus " +
    "the vault's total assets. Share price is a snapshot — APY requires sampling over time.",
  kind: "read",
  inputSchema: positionShape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return { text: "No address provided.", structured: { error: "no_address" } };
    }
    const { vault } = fastlaneAddressesFor(ctx.network);
    if (!vault) {
      return {
        text: `FastLane shMONAD vault not configured for Monad ${ctx.network}.`,
        structured: { error: "vault_not_configured" },
      };
    }
    const client = ctx.server.clients.publicClient(ctx.network);
    const [shareBalance, sharePrice, totalAssets] = await Promise.all([
      client.readContract({
        address: vault,
        abi: shmonadVaultAbi,
        functionName: "balanceOf",
        args: [target],
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: shmonadVaultAbi,
        functionName: "convertToAssets",
        args: [10n ** 18n],
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: shmonadVaultAbi,
        functionName: "totalAssets",
      }) as Promise<bigint>,
    ]);
    const underlying = (shareBalance * sharePrice) / 10n ** 18n;

    return {
      text:
        `${target} shMON balance: ${formatEther(shareBalance)} shMON ≈ ${formatEther(underlying)} MON\n` +
        `Share price: 1 shMON = ${formatEther(sharePrice)} MON (snapshot)\n` +
        `Vault TVL: ${formatEther(totalAssets)} MON`,
      structured: {
        holder: target,
        plugin: "fastlane",
        vault,
        share_balance_wei: shareBalance.toString(),
        underlying_wei: underlying.toString(),
        share_price_wei: sharePrice.toString(),
        total_assets_wei: totalAssets.toString(),
      },
    };
  },
};
