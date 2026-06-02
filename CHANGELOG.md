# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

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
