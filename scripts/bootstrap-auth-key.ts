/**
 * One-time setup for server-side wallet authorization.
 *
 * Privy embedded wallets created without an additional signer are user-owned
 * and cannot be signed for from the server. This script:
 *
 *   1. Generates a P-256 keypair on this machine.
 *   2. Creates a Privy key quorum holding the public key.
 *   3. Prints the env vars you need to paste into .env.
 *
 * After you paste the env vars, run `npm run e2e:create-user` to provision a
 * fresh user/wallet with the key quorum attached at creation time. Old
 * user-only wallets cannot be retrofitted (Privy requires authorization to
 * update authorization).
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/bootstrap-auth-key.ts
 */
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";

async function main() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Missing PRIVY_APP_ID / PRIVY_APP_SECRET in env.");

  if (process.env.PRIVY_KEY_QUORUM_ID && process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY) {
    // biome-ignore lint/suspicious/noConsole: setup script
    console.log("Already bootstrapped (PRIVY_KEY_QUORUM_ID set). Nothing to do.");
    return;
  }

  const client = new PrivyClient({ appId, appSecret });

  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("Generating P-256 keypair…");
  const keypair = await generateP256KeyPair();

  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("Creating key quorum with the public key…");
  const quorum = await client.keyQuorums().create({
    authorization_threshold: 1,
    public_keys: [keypair.publicKey],
    display_name: "monad-mcp-server",
  });

  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("\n=== Paste into .env ===");
  // biome-ignore lint/suspicious/noConsole: setup script
  console.log(`PRIVY_AUTHORIZATION_PRIVATE_KEY=${keypair.privateKey}`);
  // biome-ignore lint/suspicious/noConsole: setup script
  console.log(`PRIVY_KEY_QUORUM_ID=${quorum.id}`);
  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("=======================\n");
  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("Next: paste those into .env, then `npm run e2e:create-user` to mint a fresh wallet that has the key quorum attached.");
  // biome-ignore lint/suspicious/noConsole: setup script
  console.log("Old user-only wallets (e.g. the previous test wallet) can't be retrofitted.");
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: setup script
  console.error("FAILED:", err);
  process.exit(1);
});
