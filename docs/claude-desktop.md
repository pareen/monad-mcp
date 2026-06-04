# Wiring monad-mcp into Claude Desktop

This is the dogfood path: get the server running on your laptop, point Claude Desktop at it, and have a real conversation that moves real testnet MON.

> **Just want to kick the tires (read-only)?** There's a hosted demo endpoint at `https://monad-mcp.fly.dev/mcp` that serves the **read tools only** — balances, portfolio, token lookups, transaction history. The write/approval flow this guide is about (transfers, swaps, session keys) needs a Privy signer and is **not** available on the hosted URL, so for that you must self-host with the steps below. The hosted machine also sleeps after ~5 min idle, so the first call may cold-start.
>
> Because Claude Desktop only speaks stdio, point it at the remote URL through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) shim:
>
> ```json
> {
>   "mcpServers": {
>     "monad": {
>       "command": "npx",
>       "args": ["-y", "mcp-remote", "https://monad-mcp.fly.dev/mcp"]
>     }
>   }
> }
> ```
>
> The rest of this doc is the full self-hosted path — required for writes, and what you want for a stable, always-on setup.

## 0. Prereqs

- Node ≥ 20.10
- Claude Desktop installed and signed in
- Privy app created at https://dashboard.privy.io (App ID + App Secret in `.env`)
- Bootstrap completed: `npm run bootstrap:auth-key` — `PRIVY_AUTHORIZATION_PRIVATE_KEY` + `PRIVY_KEY_QUORUM_ID` in `.env`
- Test user provisioned: `npm run e2e:create-user` and the printed address funded from the testnet faucet
- HTTP server reachable for approval URLs (run separately: `npm run start:http`)

## 1. Build

```bash
npm install
npm run build
```

This emits `dist/index.js` (the stdio entrypoint) and `dist/server-http.js` (approval-flow webserver).

## 2. Add to Claude Desktop config

Open the config:

```bash
# macOS
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
# (Linux: ~/.config/Claude/claude_desktop_config.json)
# (Windows: %APPDATA%/Claude/claude_desktop_config.json)
```

Add the `monad` entry (keep any existing `mcpServers` you already had):

```jsonc
{
  "mcpServers": {
    "monad": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/monad-mcp/.env",
        "/absolute/path/to/monad-mcp/dist/index.js"
      ]
    }
  }
}
```

> The `--env-file` flag loads `PRIVY_*`, `MONAD_*`, and `NOTIFICATION_*` from `.env` into the spawned process. Without it, the server boots in read-only-no-Privy mode and write tools fail.

Quit Claude Desktop completely (⌘Q on macOS — closing the window isn't enough) and reopen it.

## 3. Run the HTTP server in another terminal

Approval URLs (e.g. `http://localhost:8787/approve/<id>`) need the HTTP server up:

```bash
npm run start:http
# → monad-mcp http server listening on http://localhost:8787
```

If you want the approval flow to work without needing your laptop awake at a specific URL, expose it via `ngrok http 8787` and set `PUBLIC_BASE_URL=https://<your-ngrok-domain>` in `.env` before booting.

## 4. Confirm Claude sees the tools

In a Claude Desktop chat, type:

> What MCP servers are connected?

You should see `monad` listed with 28 tools across read/write categories. If it's missing, check Claude Desktop's MCP log at `~/Library/Logs/Claude/mcp-server-monad.log` for boot errors — most often a missing env var or a port conflict on the HTTP side.

## 5. First prompts

Smoke tests (read-only, no funds moved):

> What's the balance of 0x7E274bCA90eEfa81761080e074AFb1D354a0c552 on Monad testnet?

> List the canonical Monad tokens.

> Get a portfolio for 0x7E274bCA90eEfa81761080e074AFb1D354a0c552.

Once those work, try a transfer:

> Send 0.001 MON from my wallet to 0x000000000000000000000000000000000000dEaD on Monad testnet.

Claude will call `whoami` to find your wallet (if it's the authenticated user), then `transfer`, hand you an approval URL like `http://localhost:8787/approve/<uuid>`. Click it, review, approve. Claude then polls `poll_request` and reports the tx hash.

Try a session-key grant for agentic flows:

> Grant the agent up to 0.05 MON for the next 24 hours, no recipient restriction.

That returns an approval URL. After you approve, subsequent transfers under the cap auto-execute and return tx hashes immediately — no second click.

## 6. Known issues

- **MCP client doesn't auto-handle OAuth for stdio**: Claude Desktop doesn't go through the Privy OAuth flow on stdio — it assumes the local user is the one running the server. In dev that's fine; in production you'd run the HTTP transport with bearer auth.
- **HTTP server lifecycle**: Approval URLs only work while `npm run start:http` is running. For a hands-off setup, run it as a launchd service (macOS) or systemd unit (Linux).
- **Stranded wallets**: Wallets minted before the bootstrap step (i.e. without `additional_signers`) can't be signed for from the server. Always run `npm run bootstrap:auth-key` first.

## 7. Iterating

Code edits → `npm run build` → restart Claude Desktop (⌘Q + reopen). Stdio MCP servers don't hot-reload.

For faster iteration without Claude Desktop, use the integration test or run a prompt directly against the stdio server with `npx @modelcontextprotocol/inspector dist/index.js`.
