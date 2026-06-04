# monad-mcp — launch writeup

> An MCP server that turns any AI agent into a first-class actor on Monad — and treats the agent like one, not like a human clicking buttons.

## The one-liner

**Connect your agent to a Monad wallet and let it check balances, send funds, swap, lend, stake, bridge, and pay for services — through plain chat, with every action gated by your approval and your private key never leaving Privy.**

---

## Why this exists

The demand signal is loud: people want their agent to *do things onchain*, not just read about them. Monad — a high-throughput EVM L1 — is a natural target. But putting "agent + wallet" together surfaces the real problem nobody had solved well: **agents are not humans.**

A human is happy to click "approve" on every transaction. An agent running a DCA strategy at 2am is not. The interesting design space isn't "wrap an RPC in tools" — it's **how do you let an agent act autonomously inside a boundary you trust?**

That question shaped the whole project.

---

## The three ideas worth stealing

### 1. Stored requests + capability tokens, not blind signing

Every write tool builds an *unsigned* transaction, stashes it, and hands the agent a URL. You open it, see the asset diff, approve. The agent polls for the hash. The server never holds your key — Privy does, in a TEE.

The twist: each approval URL carries a **per-request HMAC capability token** scoped to exactly that one transaction + user + expiry. The approval page authenticates with it directly — no OAuth bounce, no session, no standing credential that outlives the request.

### 2. Session keys — the autonomy unlock

`grant_session_key` lets you authorize a **scoped spend envelope** once:

```
"Grant the agent up to 0.5 MON for 24h, only to these addresses."
```

After you approve that single grant, transfers and swaps that fit inside it **execute immediately** — no per-tx click. Scoped by spend cap, TTL, recipient allowlist, and function-selector allowlist. Revoke anytime.

This is the difference between "agent that asks permission 40 times" and "agent that runs a strategy."

### 3. Defense-in-depth: mirror the grant as a Privy policy

The MCP server enforces the grant. But what if the server is compromised? On activation, the grant is **mirrored as a Privy wallet policy** — so Privy *itself* refuses to sign transactions outside the envelope, independent of our server's own checks. Belt and suspenders for other people's money.

---

## What's in the box

**58 tools** across read and write:

| Category | Tools |
|----------|-------|
| Wallet & portfolio | balances, `get_portfolio` (USD-priced), history, receipts |
| Discovery | `resolve_token`, `get_token_price`, `check_token` (rug heuristics), `resolve_name` |
| Universal | `read_contract` / `write_contract` against *any* Monad contract via inline ABI |
| Safety | `simulate_transaction` (dry-run + revert decode) |
| Money movement | `transfer`, `pay_for_service` (x402/EIP-3009), `bridge_quote` + `bridge_execute` (LiFi) |
| Autonomy | `grant_session_key`, `list_session_keys`, `revoke_session_key` |
| Onboarding | `create_user` (provisions a Monad-ready Privy wallet in one call) |

**5 DeFi plugins**: Uniswap v3, Kintsu + FastLane (shMONAD) liquid staking, Morpho Blue lending, Kuru CLOB. The plugin interface is additive — a new protocol is ~200 lines and inherits the approval + session-key flow for free.

**Production-shaped**: stdio + Streamable HTTP transports, memory or Postgres persistence, webhook notifications, OAuth 2.1 metadata, 129 tests + live-testnet integration suite.

---

## Proof it works

Not a mock. A real transfer on Monad testnet, built by the `transfer` tool, signed by Privy, mined:

`0xa4de4e6f038ad49cd50813d848e002e4db20bcb9374d857fb0610764d665518b`

---

## Try it

Fastest taste (read-only, nothing to build): point any MCP client at the hosted endpoint `https://monad-mcp.fly.dev/mcp` — for Claude Desktop, use the `mcp-remote` shim (`["-y", "mcp-remote", "https://monad-mcp.fly.dev/mcp"]`). You get balances, portfolio, and history; the machine sleeps when idle so the first call cold-starts. Writes (transfers/swaps/session keys) need a signer, so self-host:

```bash
git clone https://github.com/pareen/monad-mcp.git
cd monad-mcp && npm install && npm run build
cp .env.example .env   # add your Privy app id/secret
npm run bootstrap:auth-key   # one-time: server signing key
```

Then point Claude Desktop at `dist/index.js` (full walkthrough in [`docs/claude-desktop.md`](./claude-desktop.md)) and ask:

> "What's my MON balance, and stake 1 MON with Kintsu."

---

## Honest gaps

- Protocol/token addresses ship as verified defaults — confirm before mainnet money.
- Privy policy mirror covers method + recipient + TTL; native spend caps stay server-authoritative (Privy aggregation windows cap at 72h).
- `bridge_execute` only signs Monad-source legs today.

Built in the open. Issues and PRs welcome.

— Built with [Claude Code](https://claude.com/claude-code)
