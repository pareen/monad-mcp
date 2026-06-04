# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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

### Changed

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
