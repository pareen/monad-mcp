/**
 * Creates a single Privy user with an Ethereum embedded wallet, prints
 * everything you need to fund + reuse it. Use this once, then export
 * MONAD_MCP_E2E_USER_ID for the e2e-transfer script.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/create-test-user.ts
 */
import { buildServerContext } from "../src/server.js";

async function main() {
  const ctx = buildServerContext();
  if (!ctx.auth) {
    throw new Error("Privy is not configured. Populate PRIVY_APP_ID + PRIVY_APP_SECRET in .env.");
  }
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log("Creating Privy user with embedded Ethereum wallet…");
  const resolved = await ctx.auth.createUserWithWallet({});
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log(JSON.stringify(
    {
      user_id: resolved.userId,
      wallet_address: resolved.walletAddress,
      wallet_id: resolved.walletId,
      email: resolved.email,
      explorer_testnet: `https://testnet.monadexplorer.com/address/${resolved.walletAddress}`,
      faucet: "https://testnet.monad.xyz/",
      reuse_env: `MONAD_MCP_E2E_USER_ID=${resolved.userId}`,
    },
    null,
    2,
  ));
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("FAILED:", err);
  process.exit(1);
});
