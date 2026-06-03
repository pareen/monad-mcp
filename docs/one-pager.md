# monad-mcp — technical one-pager

> A key-custody-safe bridge between AI agents and Monad DeFi. Agents *propose*; users (or pre-authorized session grants) *approve*; Privy *signs*. Base MCP's proven shape, retargeted to Monad, extensible via drop-in protocol plugins.

**Live demo:** [pareen.github.io/monad-mcp](https://pareen.github.io/monad-mcp) — read-only, queries real Monad balances, exactly what the agent sees.

---

## What it is

An **MCP server** that gives an AI agent (Claude, ChatGPT, Cursor) a safe, typed interface to the **Monad blockchain** — balances, transfers, swaps, lending, staking, on-chain order books — **without ever handing the agent a private key**. Signing is delegated to a **Privy embedded wallet**; the agent only ever builds *unsigned* intents and hands the user a URL to approve.

Architecturally it's a deliberate clone of **Base MCP** — same primitives (stored requests, approval URLs, skill plugins) — retargeted at Monad (mainnet `143` / testnet `10143`) with Privy as the wallet provider instead of Base Account.

---

## The core security idea: the agent never signs

Every state-changing call follows the **stored-request pattern**:

```
agent calls transfer({to, amount})
   → server builds {to, value, data} + human-readable summary, stores under a UUID
   → returns https://server/approve/<uuid> to the agent
   → user opens URL, sees summary + asset diff, signs via Privy embedded wallet
   → server records tx hash; agent polls poll_request and continues
```

The agent's blast radius is "can *propose* a transaction," never "can *move* funds." Privy's TEE-backed key custody + wallet policies (spend limits, allowlists) are the actual security envelope. The agent is untrusted by construction.

**Escape hatch for UX:** `grant_session_key` lets a user pre-authorize "spend up to N MON, to these targets, for this TTL." Write tools then check `grants.findCovering(...)`; if a grant covers the call, the server signs and submits **synchronously** (atomic spend-charge, with refund-on-failure) — no per-tx approval. Otherwise it falls back to the approval URL. The cap is best-effort eventually consistent.

---

## Surface area

- **~25 core tools** — read (`get_balance`, `get_portfolio`, `get_transaction_history`, `simulate_transaction`, `read_contract`, token resolution/pricing via DexScreener, risk heuristics via `check_token`) and write (`transfer`, `write_contract`, `pay_for_service` via x402/EIP-3009 USDC, `bridge_execute` via LiFi).
- **Skill plugins** (additive, drop a folder in `src/plugins/`): **Uniswap** v3 swaps, **Kintsu** (sMON, ERC-7535) and **FastLane** (shMON, ERC-4626) liquid staking, **Morpho Blue** lending, **Kuru** on-chain CLOB. Mainnet-only plugins are skipped at boot on testnet.

---

## How it's built

- **TypeScript + viem** for all chain I/O; **zod** for env config and every tool's input schema.
- **Two entrypoints, one server factory** (`buildServer()`): **stdio** (Claude Desktop, Cursor) and **Streamable HTTP** (remote clients like Claude Web/ChatGPT) with **OAuth 2.1 bearer** auth. `.well-known/oauth-protected-resource` advertises Privy as the authorization server; the bearer token *is* the user identity, so the HTTP transport is stateless.
- **Auth bridge** verifies the Privy access token (PEM ES256 key, JWKS fallback), resolves the user's embedded wallet, and threads `{userId, walletAddress, walletId}` into every tool handler.
- **Testability seam:** tool logic lives in a plain `runTool(def, args, ctx, authInfo)`; `registerTool` is a thin MCP shim over it, so unit tests exercise auth-gating/validation/error-formatting without a transport.
- **Stores are interfaces** (`RequestStore`, `GrantStore`) with in-memory implementations for dev — swap in Postgres/Redis for multi-replica prod.

---

## Notable design tradeoffs (v1)

- **Memory store by default** — dev ergonomics over horizontal scale until needed.
- **Server-side submit path** — Privy receives the unsigned tx and submits it. Browser-first signing (Privy web SDK in the approval page) is a clean Phase-2 swap that keeps the public API identical.
- **Static plugin loading** — explicit imports for type safety/bundling; the `SkillPlugin` interface is shaped so plugins can later load out-of-process or as separate npm packages.
- **One-time bootstrap gotcha:** the server needs a P-256 key quorum registered with Privy as an `additional_signer` on each wallet it provisions. Wallets minted before bootstrap are **stranded** — Privy won't retrofit a signer — so you must `npm run bootstrap:auth-key` *first*.

---

## TL;DR

A key-custody-safe bridge between AI agents and Monad DeFi: agents propose, users (or pre-authorized session grants) approve, Privy signs. Base MCP's proven shape, retargeted to Monad, extensible via drop-in protocol plugins.
