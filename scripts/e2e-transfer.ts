/**
 * End-to-end smoke test against Monad testnet.
 *
 * What it does:
 *   1. Builds a real ServerContext from .env.
 *   2. Creates a Privy user with an Ethereum embedded wallet
 *      (or reuses MONAD_MCP_E2E_USER_ID if set — to avoid spending a Privy
 *      seat on every run).
 *   3. Prints the wallet address + testnet faucet URL, polls until the
 *      wallet has at least 0.01 MON.
 *   4. Calls `transfer` through runTool with synthesized AuthInfo.
 *   5. Bypasses the HTTP/OAuth layer: directly approves the stored request
 *      via the Privy server SDK, just like the /submit endpoint would.
 *   6. Polls the receipt until mined; prints tx hash + explorer URL.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/e2e-transfer.ts
 *
 * To skip faucet polling (if you already funded the wallet manually) and
 * provide an existing user:
 *   MONAD_MCP_E2E_USER_ID=did:privy:... \
 *     node --env-file=.env --import tsx scripts/e2e-transfer.ts
 */
import { type Hex, formatEther, toHex } from "viem";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { MONAD_TESTNET_ID } from "../src/chains/monad.js";
import { buildServerContext } from "../src/server.js";
import { runTool } from "../src/tools/registry.js";
import { pollRequestTool } from "../src/tools/poll-request.js";
import { transferTool } from "../src/tools/transfer.js";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const MIN_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 MON
const TRANSFER_AMOUNT = "0.001";
const FAUCET_URL = "https://testnet.monad.xyz/";
const POLL_INTERVAL_MS = 5_000;
const FAUCET_WAIT_MAX_MS = 5 * 60 * 1000;

function log(msg: string, extra?: Record<string, unknown>): void {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log(`[e2e] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
}

async function main() {
  const ctx = buildServerContext();
  if (!ctx.auth) {
    throw new Error("Privy is not configured. Populate PRIVY_APP_ID + PRIVY_APP_SECRET in .env.");
  }
  if (ctx.config.defaultNetwork !== "testnet") {
    throw new Error("This script targets testnet. Set MONAD_DEFAULT_NETWORK=testnet.");
  }
  const network = "testnet" as const;
  const client = ctx.clients.publicClient(network);

  // 1. User & wallet
  let userId = process.env.MONAD_MCP_E2E_USER_ID;
  let walletAddress: `0x${string}`;
  let walletId: string;
  if (userId) {
    log("reusing existing user", { user_id: userId });
    const resolved = await ctx.auth.resolveUser(userId);
    walletAddress = resolved.walletAddress;
    walletId = resolved.walletId;
  } else {
    log("creating new Privy user + embedded wallet");
    const resolved = await ctx.auth.createUserWithWallet({});
    userId = resolved.userId;
    walletAddress = resolved.walletAddress;
    walletId = resolved.walletId;
    log("created", { user_id: userId, wallet: walletAddress });
    log("(reuse next time by exporting MONAD_MCP_E2E_USER_ID)");
  }

  log("wallet", {
    address: walletAddress,
    explorer: `https://testnet.monadexplorer.com/address/${walletAddress}`,
  });

  // 2. Faucet poll
  log(`needs ≥ ${formatEther(MIN_BALANCE_WEI)} MON. Send testnet MON to the address above.`);
  log(`Monad testnet faucet: ${FAUCET_URL}`);
  const start = Date.now();
  let balance = await client.getBalance({ address: walletAddress });
  while (balance < MIN_BALANCE_WEI) {
    if (Date.now() - start > FAUCET_WAIT_MAX_MS) {
      throw new Error(
        `Timed out after ${FAUCET_WAIT_MAX_MS / 1000}s waiting for the wallet to be funded.`,
      );
    }
    log("balance", { current: formatEther(balance), needed: formatEther(MIN_BALANCE_WEI) });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    balance = await client.getBalance({ address: walletAddress });
  }
  log("funded", { balance: formatEther(balance) });

  // 3. Synthesize AuthInfo for runTool
  const authInfo: AuthInfo = {
    token: "e2e",
    clientId: userId,
    scopes: ["monad:read", "monad:write"],
    extra: {
      userId,
      sessionId: "e2e",
      walletAddress,
      walletId,
    },
  };

  // 4. Run the transfer tool
  log("calling transfer tool", { to: BURN_ADDRESS, amount: TRANSFER_AMOUNT });
  const transferRes = await runTool(
    transferTool,
    { to: BURN_ADDRESS, amount: TRANSFER_AMOUNT },
    ctx,
    authInfo,
  );
  if (transferRes.isError) {
    throw new Error(`transfer tool failed: ${JSON.stringify(transferRes.structuredContent)}`);
  }
  const transferStruct = transferRes.structuredContent as {
    request_id: string;
    call: { to: `0x${string}`; value: string; data: `0x${string}` };
  };
  log("stored request", { request_id: transferStruct.request_id });

  // 5. Approve server-side via Privy (mirrors what /api/stored-requests/:id/submit does)
  log("submitting tx via Privy");
  const txHash = await ctx.auth.sendTransaction(walletId, {
    caip2: `eip155:${MONAD_TESTNET_ID}`,
    to: transferStruct.call.to,
    value: toHex(BigInt(transferStruct.call.value)) as Hex,
    data: transferStruct.call.data,
  });
  log("tx submitted", { tx_hash: txHash });
  await ctx.store.markApproved(transferStruct.request_id, txHash);

  // 6. Poll request status via the MCP tool — confirms the round trip
  const poll = await runTool(pollRequestTool, { request_id: transferStruct.request_id }, ctx);
  log("poll_request says", { text: poll.content[0]?.text });

  // 7. Wait for the receipt
  log("waiting for receipt");
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  log("mined", {
    status: receipt.status,
    block: receipt.blockNumber.toString(),
    gas_used: receipt.gasUsed.toString(),
    explorer: `https://testnet.monadexplorer.com/tx/${txHash}`,
  });

  if (receipt.status !== "success") {
    throw new Error(`tx reverted: ${txHash}`);
  }
  log("DONE — end-to-end transfer succeeded on Monad testnet ✅");
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("[e2e] FAILED:", err);
  process.exit(1);
});
