# Connect monad-mcp to Claude (or any MCP client)

The fastest ways to point your AI agent at monad-mcp. **Read tools work with zero
setup** — balances, prices, token info, contract reads, transaction history. You
only need a Privy app if you want the agent to *send* transactions (transfer,
swap, stake, etc.); see [Unlocking write tools](#unlocking-write-tools) at the end.

Pick whichever row matches you:

| You want… | Use | Needs install? |
|-----------|-----|----------------|
| The quickest thing in Claude Code | [Option A — npx](#option-a--npx-one-liner-easiest) | No (npx downloads it) |
| A shareable URL anyone can paste | [Option B — hosted URL](#option-b--hosted-url-read-only) | No |
| Claude Desktop | [Option C — Claude Desktop](#option-c--claude-desktop) | No (npx) |
| To hack on the code | [Option D — from source](#option-d--from-source) | Yes (clone + build) |

---

## Option A — npx one-liner (easiest)

In a terminal, with [Claude Code](https://claude.com/claude-code) installed:

```bash
claude mcp add monad -- npx -y monad-mcp
```

That's it. Restart Claude Code and ask:

> What's the balance of `0x7E274bCA90eEfa81761080e074AFb1D354a0c552` on Monad testnet?

To default to mainnet instead of testnet, add an env var:

```bash
claude mcp add monad --env MONAD_DEFAULT_NETWORK=mainnet -- npx -y monad-mcp
```

Remove it any time with `claude mcp remove monad`.

---

## Option B — hosted URL (read-only)

There's a live public HTTPS endpoint you can hand to anyone — no install at all:

```
https://monad-mcp.fly.dev/mcp
```

**Claude Code:**

```bash
claude mcp add --transport http monad https://monad-mcp.fly.dev/mcp
```

**Claude Desktop / claude.ai / ChatGPT (custom connector):**
Add a connector and paste `https://monad-mcp.fly.dev/mcp`.

This public endpoint is **read-only** — write tools return "requires a connected
wallet" because no signing keys are attached. That's intentional: it's safe to
share. (To run your *own* endpoint with write access, deploy with Privy creds.)

Sanity-check it's alive:

```bash
curl https://monad-mcp.fly.dev/health
# {"ok":true,"version":"0.1.0","default_network":"testnet","privy_enabled":false}
```

---

## Option C — Claude Desktop

Open the config file:

```bash
# macOS
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
# Linux:   ~/.config/Claude/claude_desktop_config.json
# Windows: %APPDATA%/Claude/claude_desktop_config.json
```

Add a `monad` entry (keep any servers you already have):

```json
{
  "mcpServers": {
    "monad": {
      "command": "npx",
      "args": ["-y", "monad-mcp"],
      "env": {
        "MONAD_DEFAULT_NETWORK": "testnet"
      }
    }
  }
}
```

Quit Claude Desktop completely (**⌘Q** on macOS — closing the window isn't enough)
and reopen it. Then: *"What MCP servers are connected?"* — you should see `monad`.

---

## Option D — from source

For contributors, or before the npm package is published:

```bash
git clone https://github.com/pareen/monad-mcp.git
cd monad-mcp
npm install
npm run build
```

Then point Claude Code at the built entrypoint (use the **absolute** path):

```bash
claude mcp add monad -- node /absolute/path/to/monad-mcp/dist/index.js
```

…or the equivalent Claude Desktop config:

```json
{
  "mcpServers": {
    "monad": {
      "command": "node",
      "args": ["/absolute/path/to/monad-mcp/dist/index.js"],
      "env": { "MONAD_DEFAULT_NETWORK": "testnet" }
    }
  }
}
```

---

## First prompts to try (all read-only)

> What's the balance of `0x7E274bCA90eEfa81761080e074AFb1D354a0c552` on Monad testnet?

> List the canonical Monad tokens.

> What's the USD price of MON right now?

> Get a portfolio for `0x7E274bCA90eEfa81761080e074AFb1D354a0c552`.

---

## Unlocking write tools

Transfers, swaps, staking, and other state-changing tools need a
[Privy](https://dashboard.privy.io) embedded wallet so the *user* (never the
agent) signs. Setup is more involved — Privy app, a one-time
`npm run bootstrap:auth-key`, and the approval webserver running. The full
walkthrough is in [claude-desktop.md](./claude-desktop.md). Pass the Privy
credentials as env vars on whichever option above you chose, e.g.:

```bash
claude mcp add monad \
  --env PRIVY_APP_ID=clxxxx \
  --env PRIVY_APP_SECRET=xxxx \
  --env MONAD_DEFAULT_NETWORK=testnet \
  -- npx -y monad-mcp
```

Until those are set, the server runs happily in read-only mode and write tools
return a clear "sign in via Privy" message rather than failing silently.
