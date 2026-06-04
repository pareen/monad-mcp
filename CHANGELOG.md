# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.1] — 2026-06-04

### Added
- `mcpName` field in `package.json` (`io.github.pareen/monad-mcp`) so the
  published npm package links back to the MCP registry entry — required for
  `mcp-publisher` to validate and list the server.

## [0.2.0] — 2026-06-04

### Fixed

**Auth**
- Hosted `/mcp` no longer `401`s read-only calls. When Privy is configured the
  endpoint previously gated *every* request (including `initialize`/`tools/list`)
  behind a bearer token, silently breaking the advertised zero-auth read flow for
  clients that can't do interactive OAuth. Reads are now public again; only write
  tools require a token.

### Added

**Nad Name Service (.nad) resolution**
- `.nad` names now resolve to addresses on-chain via [nad.domains](https://nad.domains).
  `transfer` accepts a `.nad` name as the recipient (e.g. "send 2 MON to keone.nad"),
  resolving it before building the unsigned tx and showing `name (0x…)` in the approval
  summary. The read tools `get_balance`, `get_token_balance`, `get_portfolio`, and
  `get_transaction_history` likewise accept a `.nad` name wherever they took an address.
- `resolve_name` now performs real NNS lookups in both directions: `.nad` → address
  (forward) and address → primary `.nad` name (reverse). The `MONAD_NAME_SERVICE_RESOLVER`
  env var is demoted to a fallback for non-`.nad` ENS-style suffixes — `.nad` needs no config.
- New module `src/nns/` calls the NadNameService core contract
  (`getResolvedAddress` / `getPrimaryNameForAddress`) directly; addresses verified
  on-chain against Monad mainnet.
- Names always resolve against the mainnet NNS registry regardless of the tool's
  target network (resolved addresses are chain-agnostic), so `.nad` sends work on
  the default testnet config with no `network` override — the tx still executes on
  the targeted network.

**Auth**
- `optionalBearerAuth` middleware (`src/auth/optional-bearer.ts`): verifies a
  bearer token when present (unlocking write tools), passes anonymous requests
  through to the per-tool gate, and returns a `401` + `WWW-Authenticate` challenge
  only for a malformed/expired token.
- `MONAD_MCP_REQUIRE_AUTH=true` env flag to restore strict mode (a token required
  for every call, reads included).

**Approvals**
- Client-side signing on the approval page: it now loads the Privy web SDK and
  signs + broadcasts the transaction with the user's own browser wallet, so the
  flow works for any wallet the user controls — including browser-login wallets the
  server has no signer for (previously "stranded"). The user holds the key and pays
  gas; the server never signs.
- `POST /api/stored-requests/:id/confirm` records a client-signed tx hash after an
  on-chain integrity check (`from`/`to`/`value`/`calldata` must match the approved
  request; a different tx is rejected, a not-yet-indexed one is accepted for
  propagation lag). Authenticated by Privy bearer or the per-request approval token.

### Changed

**Approvals**
- The server-submit path (`/submit`, server-side signing via the Privy node SDK) is
  now reserved for grant-activation requests, which have no browser transaction to
  sign. Real transfers/contract calls sign client-side by default.

**Site**
- Reworked the landing page around *connecting* the MCP to a client: a tabbed
  "Pick your client" panel (Claude Code, Claude Desktop, ChatGPT, claude.ai) with
  copy-to-clipboard commands and the hosted read-only URL front and center.
- Added a developer/self-host subpage (`site/dev.html`) — the write-enabled "dev
  version" walkthrough (Privy bootstrap, approval server, session keys, deploy your
  own endpoint) — and a summary section linking to it from the main page.
- Added a public FAQ section and a longer `docs/FAQ.md` covering setup, security,
  read-only hosted usage, self-hosted writes, session keys, plugins, and production
  checks.
- Extracted a shared stylesheet (`site/styles.css`) used by both pages.
- Corrected the live demo's tool count to 46 (26 read / 20 write across 5 DeFi
  plugins) and fixed the dead mainnet explorer URL (`monadexplorer.com`).

## [0.1.0] — 2026-06-02

First public release. An MCP server that gives AI agents a secure gateway to the
Monad blockchain, with Privy-backed signing and session keys.

### Added

**Server & transport**
- stdio + Streamable HTTP transports (Claude Desktop, Cursor, Claude Web, ChatGPT)
- viem clients for Monad mainnet (143) and testnet (10143)
- Memory and Postgres persistence backends, env-switched (`STORE_BACKEND`)
- Webhook notifications on stored-request lifecycle events

**Auth & signing**
- Privy integration: OAuth 2.1 metadata, access-token verification, embedded-wallet
  resolution, server-side signing via a P-256 key quorum (`authorization_context`)
- `create_user` self-serve onboarding (provisions a Monad-ready embedded wallet)
- Stored-requests approval flow with per-request HMAC capability tokens
- Session-key grants (spend cap / TTL / target + selector allowlists) with
  auto-execution and a Privy wallet-policy mirror for defense-in-depth

**Core tools** (35): balances, portfolio, history, receipts, token resolve/price,
`check_token`, `resolve_name`, universal `read_contract` / `write_contract`,
`simulate_transaction`, `transfer`, `pay_for_service` (x402/EIP-3009),
`bridge_quote` / `bridge_execute` (LiFi), session-key management, `poll_request`,
`whoami`

**DeFi plugins** (23 tools): Uniswap v3, Kintsu liquid staking, FastLane shMONAD
liquid staking, Morpho Blue lending, Kuru CLOB

**Quality**
- 129 unit tests + integration suites (live testnet transfer, Postgres),
  typecheck + Biome lint clean
- Verified end-to-end on Monad testnet:
  `0xa4de4e6f038ad49cd50813d848e002e4db20bcb9374d857fb0610764d665518b`

**Site**
- Landing page with a live in-browser read-tool demo, deployed to GitHub Pages

### Notes

- An aPriori liquid-staking plugin shipped during development was removed before
  release after aPriori was flagged as a scam; FastLane shMONAD fills that slot.
- Protocol/token addresses ship as verified defaults, overridable via env —
  verify before mainnet use.
