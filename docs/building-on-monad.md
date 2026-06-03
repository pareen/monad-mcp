# Building on Monad — nuances that trip up agents

Monad is EVM-bytecode-equivalent, but several Ethereum-mainnet assumptions are
wrong here. The server bakes this guidance into the agent's context two ways:

- the MCP **`monad://guide/*` resources** (an agent can read the relevant
  section on demand), and
- the server `instructions` string + reinforced tool descriptions.

This page mirrors those resources for humans. Authoritative source:
[docs.monad.xyz](https://docs.monad.xyz). Numbers below were verified against the
official docs as of 2026-06; a few are version-sensitive (flagged).

## Contracts & gas — `monad://guide/contracts-and-gas`
- **Contract code size limit is 128 KB** (vs Ethereum's 24 KB / EIP-170); initcode
  256 KB (vs 48 KB). **Don't split a contract into proxies/libraries just to fit
  24 KB** — deploy it whole up to 128 KB.
- **You pay `gas_limit`, not `gas_used`.** Monad orders blocks before executing
  them, so the fee is on the limit you set. **Set tight gas limits** — padding
  costs real MON. Block gas limit 200M *(was 150M — version-sensitive)*, per-tx
  30M.
- Same opcodes/tooling; a P256 precompile at `0x0100`; a few opcodes repriced.

## Real-time events — `monad://guide/realtime-events`
- Don't poll `eth_getLogs` for live data. Use WebSocket `eth_subscribe`:
  `newHeads`/`logs` (standard, at `Voted`) and Monad's `monadNewHeads`/`monadLogs`
  (speculative, at `Proposed`, ~1s earlier, with `blockId` + `commitState`).
- Commit states: `Proposed → Voted → Finalized → Verified`. Track by `blockId`,
  not block number; wait for `Finalized` before doing anything irreversible.

## RPC quirks — `monad://guide/rpc-quirks`
- **`eth_getLogs` is range-capped: ~100 blocks** on `rpc.monad.xyz` (1000 on
  Alchemy/Ankr). This server's `get_transaction_history` chunks into 100-block
  windows accordingly.
- Only **recent state** is retained (~hours); arbitrary archive state isn't
  available publicly — but tx/receipt/log/trace history is kept fully.
- **`latest` reads are speculative and can change**; use the `finalized` tag for
  irreversible decisions. No pending-tx visibility; `sendRawTransaction` defers
  validation (confirm via receipt); EIP-4844 blob txs are rejected.

## MEV & FastLane — `monad://guide/mev-and-fastlane`
- **No drop-in "private RPC"** for blanket MEV protection. Monad has no global
  mempool; FastLane's protection is app-integrated via **Atlas** (UserOperation →
  solver auction → atomic `metacall`).
- ⚠️ Atlas on Monad is **testnet-only and in flux** (Chainlink acquired Atlas in
  Jan 2026) — not a stable mainnet target yet. **shMON** (FastLane liquid staking)
  *is* live on mainnet and is supported here via the `fastlane_*` tools.

> Keep this file in sync with `src/resources/guide.ts` (the runtime source of
> truth for the MCP resources).
