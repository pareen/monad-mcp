// One-off: confirm the Privy credentials in .env actually reach Privy and
// authenticate. Lists the first user (or an empty page) — both are valid
// success signals. Run with `node --env-file=.env --import tsx scripts/verify-privy.ts`.
import { PrivyClient } from "@privy-io/node";

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("Missing PRIVY_APP_ID or PRIVY_APP_SECRET in env.");
  process.exit(1);
}

const client = new PrivyClient({ appId, appSecret });

try {
  const iter = client.users().list({ limit: 1 });
  let count = 0;
  for await (const user of iter) {
    count++;
    // biome-ignore lint/suspicious/noConsole: smoke script
    console.log("first user id:", user.id);
    break;
  }
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.log(`OK — credentials accepted, listed ${count} user(s).`);
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: smoke script
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
}
