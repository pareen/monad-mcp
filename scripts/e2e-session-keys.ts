/**
 * End-to-end session-key test on Monad testnet.
 *
 * Exercises the headline feature: grant a scoped spend budget, then watch
 * transfers auto-execute under it (no per-tx approval) until the cap is hit,
 * at which point the next transfer falls back to the approval-URL flow.
 *
 *   1. grant_session_key  → pending grant + approval request
 *   2. activate the grant (mimics the approval-page click)
 *   3. transfer #1 + #2 under the cap → must execute_via_grant with real tx hashes
 *   4. confirm both receipts on-chain
 *   5. transfer that exceeds the remaining cap → must fall back to approval URL
 *   6. print final spend accounting
 *
 * Run: node --env-file=.env --import tsx scripts/e2e-session-keys.ts
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { buildServerContext } from "../src/server.js";
import { grantSessionKeyTool } from "../src/tools/session-keys.js";
import { runTool } from "../src/tools/registry.js";
import { transferTool } from "../src/tools/transfer.js";

const BURN = "0x000000000000000000000000000000000000dEaD";

function log(m: string, x?: unknown) {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log(`[sk] ${m}${x !== undefined ? ` ${JSON.stringify(x)}` : ""}`);
}

async function main() {
  const ctx = buildServerContext();
  if (!ctx.auth) throw new Error("Privy not configured");
  const userId = process.env.MONAD_MCP_E2E_USER_ID;
  if (!userId) throw new Error("MONAD_MCP_E2E_USER_ID not set");
  const resolved = await ctx.auth.resolveUser(userId);
  const authInfo: AuthInfo = {
    token: "sk-e2e",
    clientId: userId,
    scopes: ["monad:read", "monad:write"],
    extra: {
      userId,
      sessionId: "sk-e2e",
      walletAddress: resolved.walletAddress,
      walletId: resolved.walletId,
    },
  };
  log("wallet", resolved.walletAddress);
  const client = ctx.clients.publicClient("testnet");

  // 1. Grant a 0.01 MON budget for 1h, any recipient.
  log("granting session key: cap 0.01 MON, 1h");
  const grantRes = await runTool(
    grantSessionKeyTool,
    { spend_cap_mon: "0.01", ttl_seconds: 3600, label: "e2e-autonomy" },
    ctx,
    authInfo,
  );
  const grantId = (grantRes.structuredContent as { grant_id: string }).grant_id;
  log("grant created (pending)", { grant_id: grantId });

  // 2. Activate it — same transition the approval page triggers on click.
  await ctx.grants.activate(grantId);
  log("grant activated");

  // 3. Two transfers under the cap — must auto-execute.
  const hashes: string[] = [];
  for (const amt of ["0.002", "0.003"]) {
    const res = await runTool(transferTool, { to: BURN, amount: amt }, ctx, authInfo);
    const s = res.structuredContent as {
      executed_via_grant?: boolean;
      tx_hash?: string;
      approval_url?: string;
      grant_remaining_wei?: string;
    };
    if (!s.executed_via_grant || !s.tx_hash) {
      throw new Error(`transfer ${amt} did NOT auto-execute under grant: ${JSON.stringify(s)}`);
    }
    log(`transfer ${amt} MON auto-executed (no approval)`, {
      tx_hash: s.tx_hash,
      grant_remaining_wei: s.grant_remaining_wei,
    });
    hashes.push(s.tx_hash);
  }

  // 4. Confirm both receipts.
  for (const h of hashes) {
    const r = await client.waitForTransactionReceipt({ hash: h as `0x${string}`, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`tx ${h} reverted`);
    log("receipt confirmed", { tx: h, block: r.blockNumber.toString() });
  }

  // 5. Transfer that exceeds the remaining cap (~0.005 left) → must fall back.
  const over = await runTool(transferTool, { to: BURN, amount: "0.01" }, ctx, authInfo);
  const os = over.structuredContent as {
    executed_via_grant?: boolean;
    approval_url?: string;
    request_id?: string;
  };
  if (os.executed_via_grant) {
    throw new Error("over-cap transfer wrongly auto-executed — spend cap not enforced!");
  }
  if (!os.approval_url) throw new Error("over-cap transfer did not fall back to approval URL");
  log("over-cap transfer correctly fell back to approval URL ✓", { request_id: os.request_id });

  // 6. Final accounting.
  const grant = await ctx.grants.get(grantId);
  log("final grant state", {
    status: grant?.status,
    spent_wei: grant?.spentWei,
    cap_wei: grant?.spendCapWei,
  });
  log("DONE — session-key autonomy + spend-cap enforcement verified on testnet ✅");
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("[sk] FAILED:", err);
  process.exit(1);
});
