import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Agent-facing guidance on Monad-specific behavior that trips up tools/agents
 * carrying Ethereum assumptions. Served as MCP resources (monad://guide/*) so a
 * client can pull the relevant section on demand, and summarized in the server
 * `instructions` string. Facts are sourced from the official Monad docs
 * (docs.monad.xyz) as of 2026-06; version-sensitive numbers are flagged inline.
 *
 * Keep the human-readable mirror at docs/building-on-monad.md roughly in sync.
 */

const CONTRACTS_AND_GAS = `# Building & deploying contracts on Monad

Monad is EVM-bytecode-equivalent but **relaxes several Ethereum limits**. Don't
carry Ethereum-mainnet assumptions over blindly.

## Contract size — do NOT split contracts to fit 24 KB
- **Max deployed contract code size: 128 KB** (131,072 bytes) — vs Ethereum's
  24 KB (EIP-170).
- **Max initcode size: 256 KB** (262,144 bytes) — vs Ethereum's 48 KB (EIP-3860).

A very common waste: agents split a contract into proxies/libraries/diamonds
purely to dodge the 24 KB EIP-170 ceiling. On Monad that's unnecessary up to
128 KB — deploy it as one contract unless you need modularity for other reasons.

## EVM compatibility
- Same opcode set and tooling (Solidity/Vyper/standard EVM bytecode deploy
  unchanged). A few opcodes/precompiles are **repriced** (gas cost differs, not
  semantics).
- Adds a **P256 / secp256r1 verify precompile at \`0x0100\`** (RIP-7212 style).
- Under EIP-7702 delegated accounts, \`CREATE\`/\`CREATE2\` are restricted.

## Gas model — bill is on gas_limit, not gas_used
- **Block gas limit: 200M.** **Per-transaction gas limit: 30M** (one tx can't
  fill a block). Target ~160M (80% full).
- **You pay \`gas_limit * price\`, not \`gas_used * price\`.** Under Monad's
  asynchronous execution, blocks are ordered before they're executed, so the fee
  is charged on the limit you set. **Set tight, accurate gas limits** — padding
  the limit "to be safe" costs real MON here, unlike on Ethereum.
- EIP-1559-compatible tx format; base fee rises more slowly and falls faster than
  Ethereum's. \`eth_maxPriorityFeePerGas\` currently returns a hardcoded 2 gwei.

> Version note: the block gas limit (200M) has changed over time (was 150M).
> Re-check docs.monad.xyz before hardcoding it.

Sources: https://docs.monad.xyz/developer-essentials/differences ·
https://docs.monad.xyz/developer-essentials/gas-pricing
`;

const REALTIME_EVENTS = `# Real-time events on Monad (beyond eth_getLogs polling)

At ~400 ms blocks and high throughput, polling \`eth_getLogs\` in a loop can't
keep up and is rate-limited (see the rpc-quirks guide). Use Monad's push-based
real-time stream instead.

## WebSocket eth_subscribe (recommended for remote agents)
Connect to a \`wss://\` endpoint (e.g. mainnet \`wss://rpc.monad.xyz\`, testnet
\`wss://testnet-rpc.monad.xyz\`) and \`eth_subscribe\`. Four subscription types:

| Type | Fires at | Notes |
|------|----------|-------|
| \`newHeads\` | block **Voted** | Geth-standard |
| \`logs\` | matching logs, **Voted** | Geth-standard |
| \`monadNewHeads\` | block **Proposed** (speculatively executed) | Monad extension, ~1s earlier, speculative |
| \`monadLogs\` | matching logs, **Proposed** | Monad extension, ~1s earlier, speculative |

The two \`monad*\` variants carry extra fields:
- **\`blockId\`** — identifies a specific block *proposal* (distinct from block
  number; multiple proposals can share a height).
- **\`commitState\`** — \`Proposed\` → \`Voted\` → \`Finalized\` → \`Verified\`.

## Don't treat speculative data as final
Monad has no silent Geth-style reorgs — it gives you an explicit commit-state
machine. Rule: **track by \`blockId\`, not block number.** When a block is
finalized, abandon any other proposed block at the same height with a different
\`blockId\`. For irreversible actions (payouts, accounting), wait for
\`Finalized\` / read at the \`finalized\` tag; use the speculative stream only for
low-latency UX you can later reconcile.

## Co-located sidecars: Execution Events SDK
If you run your own node, the execution daemon writes raw event records (logs,
internal calls, accessed accounts, …) to a shared-memory ring buffer. A sidecar
on the same host reads them ~microseconds later via \`libmonad_event\` (C/Rust) —
the lowest-latency path, but poll-based: keep up or the ring overwrites.

Sources: https://docs.monad.xyz/reference/websockets ·
https://docs.monad.xyz/execution-events ·
https://docs.monad.xyz/monad-arch/realtime-data/spec-realtime
`;

const RPC_QUIRKS = `# Monad RPC quirks & limits

The public RPC URLs are vanity endpoints fanning out to several providers, so
exact limits vary per endpoint. Defaults below are for \`rpc.monad.xyz\`
(QuickNode). For production, use a dedicated provider.

## eth_getLogs is range-capped (small!)
- **~100 blocks per query** on \`rpc.monad.xyz\` (QuickNode) and
  \`rpc-mainnet.monadinfra.com\`; **~1000 blocks** on Alchemy/Ankr endpoints.
  Alchemy also caps results at 10,000 logs.
- Blocks are frequent (~0.4 s) and large, so wide ranges time out. Scan in small
  windows. (This server's \`get_transaction_history\` chunks into ~100-block
  windows for exactly this reason, and bounds total lookback — for deep history
  use the block explorer or a dedicated indexer.)

## Limited historical state — but full event/tx history
- A full node keeps only **recent state** (~40k blocks on a 2 TB SSD ≈ a few
  hours; varies). **Arbitrary-far-back state is not available from any public
  provider yet** — historical \`eth_call\`/\`getBalance\`/\`getStorageAt\` only work
  within the retained window (\`rpc2.monad.xyz\` Goldsky and
  \`rpc-mainnet.monadinfra.com\` serve the widest).
- **Transactions, receipts, logs, and traces ARE retained for all history** — so
  \`eth_getLogs\` and receipt/tx lookups reach back arbitrarily far even though
  *state* does not.

## Finality / block tags — \`latest\` is speculative
- \`latest\` → **Proposed** (speculative, not yet voted). **An identical read
  against \`latest\` can change on a later request.** Don't make irreversible
  decisions on it.
- \`safe\` → **Voted** (quorum certificate). \`finalized\` → **Finalized**
  (irreversible without a hard fork). Read at \`finalized\` for accounting/payouts.

## No mempool / pending visibility
- \`eth_getTransactionByHash\` returns \`null\` for a not-yet-included tx (no
  pending view). \`eth_subscribe\` supports neither \`newPendingTransactions\` nor
  \`syncing\`.
- **Deferred validation:** \`eth_sendRawTransaction\` may accept a tx with a nonce
  gap or insufficient balance and only fail later (async execution). Always
  confirm via the receipt rather than assuming acceptance == success.
- **EIP-4844 blob transactions are rejected.**

## Rate limits
Vary per provider (≈15–25 rps, or 300 per 10 s; batch sizes 1–100). Public
endpoints are fine for light use; move to a dedicated RPC for anything sustained.

Sources: https://docs.monad.xyz/reference/rpc-limits ·
https://docs.monad.xyz/reference/rpc-differences ·
https://docs.monad.xyz/developer-essentials/historical-data
`;

const MEV_AND_FASTLANE = `# MEV & transaction inclusion on Monad (FastLane)

## There is no drop-in "private RPC" for blanket MEV protection
Unlike Flashbots Protect / private-mempool RPCs on other chains, you cannot point
a wallet at a FastLane endpoint to get blanket frontrun/sandwich protection on
Monad today.

- Monad has **no global mempool**: validators keep **local mempools** and RPC
  nodes forward your tx to upcoming leaders. A protocol-level MEV sidecar scores
  txs by their MEV; this is Monad infra, not an endpoint you call.
- FastLane's MEV protection is **application-integrated via Atlas**: a dApp
  collects a signed \`UserOperation\`, an auctioneer runs a solver auction, and a
  bundler wraps it into one atomic on-chain \`metacall\`. You benefit only by
  transacting **through an Atlas-integrated dApp**, not by swapping your RPC.

## Status (flag — verify before building)
- **Atlas on Monad is testnet-only**, and **Chainlink acquired Atlas from
  FastLane in Jan 2026**, redirecting it toward Chainlink SVR. Treat
  Atlas-on-Monad as in flux — not a stable mainnet primitive right now.
- **shMON** (FastLane liquid staking) **is live on Monad mainnet** and is
  supported by this server's \`fastlane_*\` tools. That's the FastLane product you
  can rely on today.

## Practical guidance for an agent
1. For your own transactions: submit through normal Monad RPC (it's forwarded to
   leaders); there's no FastLane drop-in to recommend on mainnet yet.
2. For MEV protection / rebates: only available when you transact through a
   dApp that has integrated Atlas.
3. For yield on idle MON: use the \`fastlane_*\` (shMON) tools.

Sources: https://docs.monad.xyz/monad-arch/consensus/local-mempool ·
https://docs.shmonad.xyz/products/mev-protection/overview/ ·
https://www.atlasevm.com/
`;

const INDEX = `# Building on Monad — agent guide

Monad-specific behavior that differs from Ethereum mainnet. Read the section you
need:

- **monad://guide/contracts-and-gas** — 128 KB contract size (don't split for
  24 KB), 200M/30M gas, and the gas_limit (not gas_used) billing model.
- **monad://guide/realtime-events** — WebSocket \`eth_subscribe\` +
  \`monadNewHeads\`/\`monadLogs\` speculative streams; commit-state reconciliation.
- **monad://guide/rpc-quirks** — \`eth_getLogs\` 100–1000 block cap, limited state
  history, \`latest\` = speculative, no pending-tx visibility, deferred validation.
- **monad://guide/mev-and-fastlane** — no drop-in private RPC; Atlas (testnet,
  in flux) vs shMON (live mainnet).

Authoritative source: https://docs.monad.xyz
`;

interface GuideDoc {
  uri: string;
  name: string;
  title: string;
  description: string;
  text: string;
}

const GUIDES: GuideDoc[] = [
  {
    uri: "monad://guide",
    name: "monad-guide-index",
    title: "Building on Monad — index",
    description:
      "Index of Monad-specific guidance for agents (contracts, gas, events, RPC quirks, MEV).",
    text: INDEX,
  },
  {
    uri: "monad://guide/contracts-and-gas",
    name: "monad-guide-contracts-and-gas",
    title: "Monad: contracts & gas",
    description:
      "Monad raises contract size to 128 KB (don't split for 24 KB); 200M/30M gas limits; you pay gas_limit not gas_used.",
    text: CONTRACTS_AND_GAS,
  },
  {
    uri: "monad://guide/realtime-events",
    name: "monad-guide-realtime-events",
    title: "Monad: real-time events",
    description:
      "Push-based events via WebSocket eth_subscribe and Monad's speculative monadNewHeads/monadLogs; commit-state reconciliation.",
    text: REALTIME_EVENTS,
  },
  {
    uri: "monad://guide/rpc-quirks",
    name: "monad-guide-rpc-quirks",
    title: "Monad: RPC quirks & limits",
    description:
      "eth_getLogs 100–1000 block cap, limited historical state, latest=speculative finality, no pending-tx visibility, deferred validation.",
    text: RPC_QUIRKS,
  },
  {
    uri: "monad://guide/mev-and-fastlane",
    name: "monad-guide-mev-and-fastlane",
    title: "Monad: MEV & FastLane",
    description:
      "No drop-in private RPC; FastLane MEV protection is app-integrated via Atlas (testnet, in flux); shMON staking is live mainnet.",
    text: MEV_AND_FASTLANE,
  },
];

/** Register the Monad guide as MCP resources (monad://guide/*). */
export function registerGuideResources(mcp: McpServer): void {
  for (const g of GUIDES) {
    mcp.registerResource(
      g.name,
      g.uri,
      { title: g.title, description: g.description, mimeType: "text/markdown" },
      (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: g.text }],
      }),
    );
  }
}

/** Exported for tests + the docs mirror. */
export const guideDocs = GUIDES;
