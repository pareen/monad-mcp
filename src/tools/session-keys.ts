import { parseEther } from "viem";
import { z } from "zod";
import { AuthRequiredError, WalletNotFoundError } from "../errors.js";
import type { SessionGrant } from "../grants/types.js";
import { approvalUrlFor } from "./approval-url.js";
import type { ToolDefinition } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const grantShape = {
  spend_cap_mon: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe(
      'Maximum total MON the agent can spend under this grant, as a decimal string e.g. "1.5".',
    ),
  ttl_seconds: z.coerce
    .number()
    .int()
    .positive()
    .max(30 * 24 * 3600)
    .default(24 * 3600)
    .describe("How long this grant stays active, in seconds. Max 30 days."),
  label: z.string().min(1).max(100).default("agent-session").describe("Human-readable label."),
  allowed_targets: z
    .array(addressSchema)
    .optional()
    .describe(
      "Optional allowlist of recipient/contract addresses. If unset, the grant covers any target.",
    ),
  allowed_selectors: z
    .array(z.string().regex(/^0x[a-fA-F0-9]{8}$/))
    .optional()
    .describe(
      "Optional allowlist of 4-byte function selectors (e.g. '0xa9059cbb' for ERC-20 transfer).",
    ),
  network: optionalNetwork,
  /** TTL for the click-approval link (separate from the grant TTL). */
  approval_ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const grantSessionKeyTool: ToolDefinition<typeof grantShape> = {
  name: "grant_session_key",
  title: "Grant a session-key spend cap",
  description:
    "Asks the user to authorize a scoped spend cap so the agent can execute write tools " +
    "(transfers, swaps) WITHOUT a per-tx approval URL — within the grant's envelope. " +
    "Returns an approval URL. After the user approves, transfers and swaps that fit inside " +
    "the cap auto-execute and return the tx hash immediately.",
  kind: "write",
  inputSchema: grantShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) {
      throw new Error("unreachable: write-tool auth checked by registry");
    }

    const capWei = parseEther(args.spend_cap_mon);
    const grant = await ctx.server.grants.create({
      userId: ctx.userId,
      walletAddress: ctx.walletAddress,
      network: ctx.network,
      label: args.label,
      spendCapWei: capWei.toString(),
      allowedTargets: args.allowed_targets,
      allowedSelectors: (args.allowed_selectors ?? []) as `0x${string}`[],
      ttlMs: args.ttl_seconds * 1000,
    });

    // Build a stored request whose body, when approved, activates the grant.
    // Reusing the approval flow gives us the same UX (link in a browser).
    const summary = `Grant agent up to ${args.spend_cap_mon} MON for ${args.label} — expires ${new Date(grant.expiresAt).toISOString()}`;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      // Sentinel call — not actually submitted on-chain. The /submit endpoint
      // recognizes the grant pluginContext and activates instead of sending.
      call: {
        to: ctx.walletAddress,
        value: "0",
        data: "0x" as `0x${string}`,
      },
      pluginContext: {
        kind: "grant_activation",
        grant_id: grant.id,
        spend_cap_wei: grant.spendCapWei,
        allowed_targets: grant.allowedTargets,
        allowed_selectors: grant.allowedSelectors,
        grant_expires_at: grant.expiresAt,
        label: grant.label,
      },
      ttlMs: args.approval_ttl_seconds * 1000,
    });

    // Stash the request id on the grant so we can clean up on revoke.
    grant.approvalRequestId = stored.id;

    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;

    return {
      text: `Session-key grant prepared: ${summary}\nApprove here:\n${approvalUrl}\nOnce approved, the agent can spend up to ${args.spend_cap_mon} MON in transfers/swaps without per-tx approvals. Poll grant status with \`list_session_keys\`.`,
      structured: {
        grant_id: grant.id,
        request_id: stored.id,
        approval_url: approvalUrl,
        spend_cap_wei: grant.spendCapWei,
        spend_cap_mon: args.spend_cap_mon,
        label: grant.label,
        allowed_targets: grant.allowedTargets,
        allowed_selectors: grant.allowedSelectors,
        expires_at: grant.expiresAt,
      },
    };
  },
};

const listShape = {};
export const listSessionKeysTool: ToolDefinition<typeof listShape> = {
  name: "list_session_keys",
  title: "List session-key grants",
  description: "Lists session-key grants for the authenticated user, newest first.",
  kind: "read",
  inputSchema: listShape,
  handler: async (_args, ctx) => {
    if (!ctx.userId) throw new AuthRequiredError();
    const grants = await ctx.server.grants.listForUser(ctx.userId);
    return {
      text:
        grants.length === 0
          ? "No session-key grants for this user."
          : grants.map(formatGrantLine).join("\n"),
      structured: { grants: grants.map(formatGrantStruct) },
    };
  },
};

const revokeShape = {
  grant_id: z.string().uuid().describe("ID returned by `grant_session_key`."),
};
export const revokeSessionKeyTool: ToolDefinition<typeof revokeShape> = {
  name: "revoke_session_key",
  title: "Revoke a session-key grant",
  description: "Revokes a grant immediately. Subsequent agent calls fall back to per-tx approvals.",
  kind: "write",
  inputSchema: revokeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId) throw new AuthRequiredError();
    const grant = await ctx.server.grants.get(args.grant_id);
    if (!grant) {
      return {
        text: `Grant ${args.grant_id} not found.`,
        structured: { error: "not_found" },
      };
    }
    if (grant.userId !== ctx.userId) {
      throw new WalletNotFoundError("That grant is owned by another user.");
    }
    const revoked = await ctx.server.grants.revoke(args.grant_id);
    // Detach + delete the mirror policy if it exists (best-effort).
    if (revoked.privyPolicyId && ctx.server.auth) {
      try {
        const resolved = await ctx.server.auth.resolveUser(ctx.userId);
        const { PolicyMirror } = await import("../auth/policy-mirror.js");
        const mirror = new PolicyMirror(ctx.server.auth, ctx.server.logger);
        await mirror.unmirror(revoked, resolved.walletId);
        await ctx.server.grants.setPrivyPolicyId(revoked.id, null);
      } catch (err) {
        ctx.server.logger.warn("revoke: policy unmirror failed", {
          grant_id: revoked.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      text: `Grant ${revoked.id} revoked.`,
      structured: { grant_id: revoked.id, status: revoked.status },
    };
  },
};

function formatGrantLine(g: SessionGrant): string {
  const remaining = BigInt(g.spendCapWei) - BigInt(g.spentWei);
  return (
    `${g.id}  ${g.status.padEnd(8)}  ${g.label}  ` +
    `cap=${g.spendCapWei} spent=${g.spentWei} remaining=${remaining}  ` +
    `expires=${new Date(g.expiresAt).toISOString()}`
  );
}

function formatGrantStruct(g: SessionGrant) {
  return {
    id: g.id,
    status: g.status,
    label: g.label,
    spend_cap_wei: g.spendCapWei,
    spent_wei: g.spentWei,
    remaining_wei: (BigInt(g.spendCapWei) - BigInt(g.spentWei)).toString(),
    allowed_targets: g.allowedTargets,
    allowed_selectors: g.allowedSelectors,
    expires_at: g.expiresAt,
    approved_at: g.approvedAt,
    revoked_at: g.revokedAt,
    network: g.network,
  };
}
