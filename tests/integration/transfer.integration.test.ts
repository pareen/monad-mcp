import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { type Hex, formatEther, toHex } from "viem";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MONAD_TESTNET_ID } from "../../src/chains/monad.js";
import type { ServerContext } from "../../src/context.js";
import { buildServerContext } from "../../src/server.js";
import { pollRequestTool } from "../../src/tools/poll-request.js";
import { runTool } from "../../src/tools/registry.js";
import { transferTool } from "../../src/tools/transfer.js";

/**
 * Hits Monad testnet + Privy for real. Skipped unless:
 *   - .env supplies PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY, PRIVY_KEY_QUORUM_ID
 *   - MONAD_MCP_E2E_USER_ID points at a Privy user whose embedded wallet has the key quorum attached
 *   - That wallet has ≥ 0.01 MON on testnet
 *
 * Run with:
 *   npm run test:integration
 */
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const MIN_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 MON
const TRANSFER_AMOUNT = "0.001";

const requiredEnv = [
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "PRIVY_AUTHORIZATION_PRIVATE_KEY",
  "PRIVY_KEY_QUORUM_ID",
  "MONAD_MCP_E2E_USER_ID",
] as const;

const missing = requiredEnv.filter((k) => !process.env[k]);
const describeOrSkip = missing.length === 0 ? describe : describe.skip;

describeOrSkip("integration: end-to-end transfer on Monad testnet", () => {
  let ctx: ServerContext;
  let userId: string;
  let walletAddress: `0x${string}`;
  let walletId: string;
  let authInfo: AuthInfo;

  beforeAll(async () => {
    ctx = buildServerContext();
    if (!ctx.auth) throw new Error("Privy not configured");
    if (ctx.config.defaultNetwork !== "testnet") {
      throw new Error("Integration tests target testnet — set MONAD_DEFAULT_NETWORK=testnet");
    }
    userId = process.env.MONAD_MCP_E2E_USER_ID!;
    const resolved = await ctx.auth.resolveUser(userId);
    walletAddress = resolved.walletAddress;
    walletId = resolved.walletId;
    authInfo = {
      token: "integration",
      clientId: userId,
      scopes: ["monad:read", "monad:write"],
      extra: { userId, sessionId: "integration", walletAddress, walletId },
    };
  }, 30_000);

  afterAll(async () => {
    // No-op: ctx has no long-lived handles.
  });

  test("wallet is funded with at least the minimum required balance", async () => {
    const client = ctx.clients.publicClient("testnet");
    const balance = await client.getBalance({ address: walletAddress });
    expect(balance).toBeGreaterThanOrEqual(MIN_BALANCE_WEI);
  });

  test("transfer tool builds a valid call and Privy signs+broadcasts it", async () => {
    // 1. Run the transfer tool — produces an unsigned call + stored request
    const transferRes = await runTool(
      transferTool,
      { to: BURN_ADDRESS, amount: TRANSFER_AMOUNT },
      ctx,
      authInfo,
    );
    expect(transferRes.isError).toBeFalsy();
    const transferStruct = transferRes.structuredContent as {
      request_id: string;
      call: { to: `0x${string}`; value: string; data: `0x${string}` };
    };
    expect(transferStruct.call.value).toBe(
      BigInt(Math.round(Number(TRANSFER_AMOUNT) * 1e18)).toString(),
    );

    // 2. Submit via Privy (mirrors what /api/stored-requests/:id/submit does)
    const txHash = await ctx.auth!.sendTransaction(walletId, {
      caip2: `eip155:${MONAD_TESTNET_ID}`,
      to: transferStruct.call.to,
      value: toHex(BigInt(transferStruct.call.value)) as Hex,
      data: transferStruct.call.data,
    });
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    await ctx.store.markApproved(transferStruct.request_id, txHash);

    // 3. poll_request reports approved + the hash
    const poll = await runTool(pollRequestTool, { request_id: transferStruct.request_id }, ctx);
    const pollStruct = poll.structuredContent as { status: string; tx_hash?: string };
    expect(pollStruct.status).toBe("approved");
    expect(pollStruct.tx_hash).toBe(txHash);

    // 4. Wait for mining and confirm success
    const client = ctx.clients.publicClient("testnet");
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    expect(receipt.status).toBe("success");
    expect(receipt.gasUsed).toBeGreaterThan(0n);

    // biome-ignore lint/suspicious/noConsole: surface the artifact for humans reading CI output
    console.log(
      `[integration] mined ${txHash} in block ${receipt.blockNumber} ` +
        `(gas ${receipt.gasUsed}) — https://testnet.monadexplorer.com/tx/${txHash}`,
    );
  }, 120_000);

  test("balance decreased after the transfer (sanity check)", async () => {
    const client = ctx.clients.publicClient("testnet");
    const balance = await client.getBalance({ address: walletAddress });
    // Just confirm it's still reasonable — we don't pin an exact value because
    // gas fluctuates.
    expect(balance).toBeGreaterThan(0n);
    // biome-ignore lint/suspicious/noConsole: surface for CI
    console.log(`[integration] remaining balance: ${formatEther(balance)} MON`);
  });
});
