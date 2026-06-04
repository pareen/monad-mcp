# monad-mcp

MCP server for the [Monad](https://monad.xyz) blockchain. Your agent's gateway to balances, transfers, swaps, and DeFi on Monad — with signing handled by a [Privy](https://privy.io) embedded wallet, never by the agent.

Built around a simple shape — stored requests + approval URLs + skill plugins — on Monad mainnet `143` / testnet `10143`, with [Privy](https://privy.io) as the wallet provider.

**🌐 Landing page + live read-only demo:** [pareen.github.io/monad-mcp](https://pareen.github.io/monad-mcp) — query real Monad balances in your browser, exactly what the agent sees.

**🔌 Connect it — no install, no terminal.** In **Claude Desktop** or **ChatGPT**,
add a custom connector and paste this URL:

```
https://monad-mcp.fly.dev/mcp
```

That's the whole setup — read tools (balances, prices, portfolios, token checks)
work immediately. Step-by-step for each app: [docs/connect-claude.md](docs/connect-claude.md).

Prefer the terminal? One line in [Claude Code](https://claude.com/claude-code):

```bash
claude mcp add --transport http monad https://monad-mcp.fly.dev/mcp   # hosted
claude mcp add monad -- npx -y monad-mcp                              # or run it locally
```

The hosted endpoint runs in **split** mode: **read tools are public** (paste the URL,
no login — safe to share) and **write tools are gated** behind a Privy sign-in,
returning `auth_required` until you authenticate. The hosted sign-in path is wired
but still being verified end-to-end, so the tested route for transactions is your
own Privy-signed instance — see [docs/connect-claude.md](docs/connect-claude.md#sending-transactions-writes), [docs/FAQ.md](docs/FAQ.md) for common security/setup questions, and [docs/DEPLOY.md](docs/DEPLOY.md).

**🧭 Monad ≠ Ethereum:** the server ships agent-facing guidance on Monad's quirks (128 KB contracts, `gas_limit` billing, speculative `latest`, `eth_getLogs` caps, FastLane/MEV) as `monad://guide/*` MCP resources — see [docs/building-on-monad.md](docs/building-on-monad.md).

## What's in the box

**Core tools** (work on any address; auth required only where noted):

| Tool | Auth | What it does |
|------|------|--------------|
| `create_user` | none | Provision a Privy user + Monad-ready embedded wallet. Self-serve onboarding. |
| `whoami` | required | User id, wallet address, and active session-key grants. |
| `get_address` | required | Returns the connected wallet's address. |
| `get_balance` | optional | Native MON balance. |
| `get_token_balance` | optional | ERC-20 balance with decimals + symbol. |
| `get_portfolio` | optional | All canonical token balances × USD prices via DexScreener. |
| `get_transaction_history` | optional | Recent ERC-20 transfers via RPC log scan + explorer URL. |
| `get_tx_receipt` | none | Receipt for a tx hash. |
| `simulate_transaction` | optional | Dry-run a call (eth_call), returns return data or revert reason. |
| `check_token` | none | Risk heuristics: canonical-list membership, bytecode, DEX liquidity, pair age. |
| `resolve_token` | none | Symbol/name/alias → token address (canonical list + DexScreener fallback). |
| `get_token_price` | none | USD price from the deepest-liquidity DexScreener pair on Monad. |
| `list_canonical_tokens` | none | Built-in list of well-known Monad tokens. |
| `resolve_name` | none | Pass through 0x addresses; ENS-style name resolution when MNS is configured. |
| `read_contract` | none | Call any view/pure function on any Monad contract (ABI provided inline). |
| `decode_return_data` | none | Decode hex return data against an ABI. |
| `bridge_quote` | optional | LiFi aggregator quote from any chain into Monad. |
| `poll_request` | none | Status of a pending approval request. |
| `transfer` | required | Native MON or ERC-20 transfer. Auto-executes under a session grant, else → approval URL. |
| `write_contract` | required | Send a tx to any contract (any non-view function). |
| `pay_for_service` | required | x402 (HTTP 402) — signs an EIP-3009 USDC authorization via Privy and retries with X-PAYMENT. |
| `bridge_execute` | required | Submit the source-chain tx returned by `bridge_quote` (Monad sources only). |
| `grant_session_key` | required | Authorize the agent to spend up to N MON without per-tx approvals. |
| `list_session_keys` | required | Show active + recent grants. |
| `revoke_session_key` | required | Cancel a grant immediately. |

**Skill plugins** (additive, drop in your own under `src/plugins/`):

- **Uniswap** (`uniswap_quote`, `uniswap_swap`, `approve_erc20`) — exact-input single-hop swaps on Uniswap v3 (testnet + mainnet).
- **Kintsu** (`kintsu_stake`, `kintsu_request_unstake`, `kintsu_claim_unstake`, `kintsu_position`) — liquid staking MON → sMON via Kintsu's ERC-7535 vault. Two-step unstake with batch processing.
- **FastLane** (`fastlane_stake`, `fastlane_unstake`, `fastlane_position`) — liquid staking MON → shMON via FastLane's shMONAD ERC-4626 vault. Payable native deposit, synchronous redeem (no epoch wait); shMON keeps earning staking + MEV rewards.
- **Morpho** (`morpho_supply`, `morpho_withdraw`, `morpho_borrow`, `morpho_repay`, `morpho_position`, `morpho_market`) — lending on Morpho Blue's singleton. Caller passes MarketParams inline; plugin derives the market id.
- **Kuru** (`kuru_best_bid_ask`, `kuru_market_params`, `kuru_place_limit`, `kuru_cancel_orders`, `kuru_market_swap`) — fully-on-chain CLOB. Ships with known mainnet markets (MON/USDC, MON/AUSD, WETH/USDC); accepts raw addresses for new ones.

All write tools across plugins auto-route through a covering session-key grant (see "Session keys" below); otherwise they return an approval URL.

Mainnet-only plugins (Kintsu / FastLane / Morpho / Kuru) are skipped at boot when `MONAD_DEFAULT_NETWORK=testnet`. Override per-tool with `network: "mainnet"`.

## Quickstart

### 1. Install + configure

```bash
git clone https://github.com/you/monad-mcp.git
cd monad-mcp
npm install
cp .env.example .env
```

Edit `.env`. Minimum config to do anything useful with write tools:

```bash
PRIVY_APP_ID=clxxxxxxxxxxx          # from https://dashboard.privy.io
PRIVY_APP_SECRET=...                # from the same place
PRIVY_VERIFICATION_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"  # optional but recommended

# Where this server is reachable from a browser (used in approval URLs).
PUBLIC_BASE_URL=http://localhost:8787
PORT=8787

# Which Monad network to default to when a tool call omits `network`.
MONAD_DEFAULT_NETWORK=testnet
```

For the Uniswap plugin, supply contract addresses (verify against the canonical Uniswap deployment for Monad before using):

```bash
UNISWAP_MAINNET_QUOTER_V2=0x...
UNISWAP_MAINNET_SWAP_ROUTER_02=0x...
UNISWAP_TESTNET_QUOTER_V2=0x...
UNISWAP_TESTNET_SWAP_ROUTER_02=0x...
```

### 2. Privy app setup

In the Privy dashboard:

1. Create an app. Enable **embedded wallets** under "Wallets".
2. Under "Networks", add Monad mainnet (chainId `143`) and/or testnet (chainId `10143`) as an EVM chain.
3. Copy the App ID + App Secret into `.env`.
4. Copy the JWT verification key (PEM-encoded ES256 public key) into `PRIVY_VERIFICATION_KEY` for fastest token verification. If omitted, the server falls back to JWKS over the network.
5. (Optional) Configure wallet policies (spend limits, allowlists) to gate what the agent can do.

### 2a. Bootstrap server-side wallet authorization (one-time)

Privy embedded wallets are user-owned by default — the server cannot sign for them. The MCP server needs a P-256 key quorum registered with Privy, attached as an `additional_signer` on every wallet it provisions. Bootstrap it:

```bash
npm run bootstrap:auth-key
# Generates a P-256 keypair, registers it as a Privy key quorum, prints two env vars.
# Paste PRIVY_AUTHORIZATION_PRIVATE_KEY and PRIVY_KEY_QUORUM_ID into .env.
```

After bootstrap, every `create_user` call attaches the quorum at wallet creation, and every `transfer`/`swap` includes the private key in `authorization_context`. **Important**: wallets minted *before* you set these env vars are stranded — Privy doesn't let you retrofit an `additional_signer` (updating authorization requires existing authorization). Always bootstrap first.

### 3. Run

```bash
# Stdio mode for Claude Desktop, Cursor, etc.
npm run build
npm start

# HTTP / Streamable HTTP mode for remote MCP clients (Claude Web, ChatGPT).
npm run start:http
# Server listens on http://localhost:8787/mcp
```

### 4. Wire it into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`. The `--env-file` flag loads `PRIVY_*`, `MONAD_*`, and `PUBLIC_BASE_URL` from your `.env` into the spawned process:

```json
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

You'll also need the HTTP server running (`npm run start:http`) for the approval flow — the stdio MCP returns approval URLs that point at the HTTP server. See [docs/claude-desktop.md](docs/claude-desktop.md) for the full dogfood walkthrough (bootstrap, funding, first transfer).

> **Public reads, no self-hosting:** to use the read tools (balances, portfolio, history) without building anything, point Claude Desktop at the hosted endpoint via the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) shim — `"args": ["-y", "mcp-remote", "https://monad-mcp.fly.dev/mcp"]`. Writes (transfers/swaps) are gated behind a Privy sign-in; the verified path for them is a self-hosted signer.

### 5. Try a prompt

```
What's the balance of 0x000…0000 on Monad testnet?
Send 0.01 MON to 0xabc… on Monad testnet.
```

For the second prompt the agent calls `transfer`, hands you a link like `http://localhost:8787/approve/<uuid>`, and you approve in your browser. The agent polls `poll_request` and reports the tx hash.

## Architecture

```
agent (Claude / ChatGPT / Cursor)
   │
   │  MCP over stdio OR Streamable HTTP (with OAuth 2.1 bearer)
   ▼
monad-mcp server
   │
   ├── core tools           viem → Monad RPC (mainnet 143 / testnet 10143)
   ├── skill plugins        Uniswap / Kuru / Kintsu / Morpho (additive)
   │
   ├── auth bridge          Privy server SDK (verify access token, resolve embedded wallet)
   │
   └── stored requests      pending tx ↔ approval URL ↔ user signature
                            ▲
                            │
                            └── /approve/:id  →  Privy hosted signing  →  tx hash
```

Write tools follow the **stored request pattern**:
1. Tool builds an unsigned `{ to, value, data }` payload and a human-readable summary.
2. Server stores it under a UUID and returns `https://your-server/approve/<uuid>` to the agent.
3. User opens the URL — page shows the summary + asset diff + signs via their Privy embedded wallet.
4. Server records the tx hash; agent polls `poll_request` and continues.

The agent never touches a private key. Privy's TEE-backed key custody + wallet policies are the security envelope.

## Adding your own skill plugin

Plugins live in `src/plugins/<id>/` and export a `SkillPlugin`:

```ts
import type { SkillPlugin } from "../types.js";
import { registerTool } from "../../tools/registry.js";

export const myPlugin: SkillPlugin = {
  id: "myproto",
  name: "MyProto on Monad",
  description: "What it does in one sentence.",
  networks: ["mainnet", "testnet"],
  register(mcp, server) {
    registerTool(mcp, server, myReadTool);
    registerTool(mcp, server, myWriteTool);
  },
};
```

Register it in `src/plugins/index.ts`. Write tools just need to construct a `{ to, value, data }` payload and call `server.store.create(...)` — the approval flow is shared.

## Testing

```bash
npm test                # vitest unit tests (no network) — 56 tests
npm run test:integration  # integration tests against live testnet RPC + Privy
npm run typecheck
npm run lint
```

56 unit tests cover the chain config, both stores (requests + grants), tool registry (auth gating, schema validation), every core tool, every session-key surface, and the Uniswap plugin's quote sweep.

The integration suite runs `transfer` end-to-end on Monad testnet through the Privy server SDK: build → sign → broadcast → poll receipt. Gated on `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `PRIVY_KEY_QUORUM_ID`, and `MONAD_MCP_E2E_USER_ID` being set + the wallet being funded; cleanly skips otherwise so it doesn't break CI without secrets.

## Security model

- **Keys**: Privy holds the key in a TEE. The MCP server never sees a private key.
- **Authorization to act**: every write tool builds a stored request; nothing happens until the user clicks Approve on the approval page.
- **Token scope**: the OAuth 2.1 bearer in the MCP transport identifies *which user*; it does not authorize *which tx* — that's gated by the explicit approval click + Privy wallet policies.
- **Stale link defense**: stored requests expire after `ttl_seconds` (default 5 min); expired requests can't be approved.
- **CSRF on /reject**: rejection is intentionally permissionless — worst case, a stale link can't be re-used. Approval requires a Bearer token tied to the requesting user.

For production, the stored-request and grant stores already support a Postgres backend (set `STORE_BACKEND=postgres`); still on the hardening list are rate limiting on `/approve` and `/submit`, and per-tool spend caps via Privy policies.

## Session keys: skipping per-tx approvals

By default every write tool returns an approval URL the user has to click. That's fine for one-shot prompts, fatal for anything agentic ("DCA $100 into MON every Friday", "rebalance my LP weekly"). The fix is `grant_session_key`:

```
> Grant the agent up to 0.5 MON for the next 24h to send to 0xabc…

agent calls grant_session_key({
  spend_cap_mon: "0.5",
  ttl_seconds: 86400,
  allowed_targets: ["0xabc..."],
})
→ returns an approval URL. User clicks once.

> Now send 0.01 MON to 0xabc…

agent calls transfer({ to: "0xabc...", amount: "0.01" })
→ no approval URL. Tool returns the tx hash immediately,
  grant remaining: 0.49 MON.
```

Grants are scoped by:
- **`spend_cap_mon`** — total native MON the agent can spend (running total tracked across calls)
- **`ttl_seconds`** — grant expiry window (max 30 days)
- **`allowed_targets`** — optional recipient/contract allowlist (empty = any)
- **`allowed_selectors`** — optional 4-byte function selector allowlist (e.g. `0xa9059cbb` = ERC-20 transfer only)

Coverage is checked against every write call; if the grant doesn't cover (wrong target, wrong selector, would exceed cap), the tool falls back to the approval-URL flow. Revoke any time with `revoke_session_key`.

**Limits**: v1 tracks native-MON spend cap only. ERC-20 token amounts aren't deducted from the cap — instead, restrict ERC-20 access by listing the token contract in `allowed_targets`. Per-token spend caps are a v2 add.

## End-to-end testing on Monad testnet

```bash
# 1. Provision a test user + embedded wallet (one-time, costs a Privy seat).
npm run e2e:create-user
# Prints: user_id, wallet_address, faucet URL. Save user_id to .env.

# 2. Fund the printed wallet at https://testnet.monad.xyz/

# 3. Run the round-trip transfer test.
npm run e2e:transfer
# Builds a transfer through runTool, signs+broadcasts via Privy, waits for receipt.

# 4. Sanity-check Privy creds reach the API.
npm run verify:privy
```

The e2e script reuses `MONAD_MCP_E2E_USER_ID` from env so you don't burn a new Privy seat on each run.

## What's next

- Browser-first signing path (Privy web SDK in the approval page → no server-side `sendTransaction` round-trip).
- More plugins — Neverland lending (Aave V3 fork on Monad), additional DEXes/perps.
- Block-explorer integration once Monad's explorer API stabilizes (`get_transaction_history` will return full decoded history).
- x402 payment support (pay for x402-enabled services).
- Per-token (ERC-20) spend caps on session grants — today's cap is a single native-MON budget per grant.
- Universal contract reader/writer for "talk to any Monad contract" without writing a per-protocol plugin.

## License

MIT — see `LICENSE`.
