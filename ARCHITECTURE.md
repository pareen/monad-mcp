# Architecture

## Directory layout

```
src/
├── index.ts               # stdio entrypoint (for Claude Desktop, Cursor)
├── server-http.ts         # Streamable HTTP entrypoint (for remote MCP clients)
├── server.ts              # buildServer() — McpServer factory + tool registration
├── config.ts              # env → typed Config, validated with zod
├── context.ts             # ServerContext / ToolContext types
├── logger.ts              # structured stderr logger
├── errors.ts              # MonadMcpError + typed subclasses
│
├── chains/
│   └── monad.ts           # viem chain definitions for 143 / 10143
├── viem/
│   └── clients.ts         # PublicClient factory per network
│
├── auth/
│   ├── privy.ts           # PrivyAuthBridge — verify tokens, resolve wallets, send tx
│   ├── verifier.ts        # OAuthTokenVerifier adapter for the MCP SDK middleware
│   └── oauth.ts           # OAuth 2.1 protected-resource + AS metadata routes
│
├── store/
│   ├── types.ts           # RequestStore interface + StoredRequest type
│   ├── memory.ts          # MemoryRequestStore (process-local, dev default)
│   └── index.ts
├── grants/
│   ├── types.ts           # GrantStore interface + SessionGrant type
│   ├── memory.ts          # MemoryGrantStore (process-local)
│   └── index.ts
│
├── approval/
│   ├── page.ts            # renderApprovalPage() — server-rendered approval UI
│   └── routes.ts          # /approve/:id + /api/stored-requests/:id/*
│
├── tools/                 # core tools
│   ├── registry.ts        # ToolDefinition + runTool + registerTool
│   ├── schemas.ts         # shared zod schemas (network, address, amount, txHash)
│   ├── abi.ts             # ERC-20 ABI
│   ├── format.ts          # display helpers
│   ├── get-address.ts
│   ├── get-balance.ts
│   ├── get-token-balance.ts
│   ├── get-transaction-history.ts
│   ├── get-tx-receipt.ts
│   ├── poll-request.ts
│   ├── transfer.ts
│   ├── grant-exec.ts      # session-grant routing for write tools
│   ├── session-keys.ts    # grant_session_key, list_session_keys, revoke_session_key
│   ├── create-user.ts     # Privy user + embedded-wallet provisioning
│   ├── whoami.ts          # introspection
│   └── index.ts           # registerCoreTools()
│
└── plugins/               # skill plugins
    ├── types.ts           # SkillPlugin interface
    ├── index.ts           # builtinPlugins + registerPlugins()
    ├── uniswap/           # v3 quote + swap + erc20 approve
    │   ├── abi.ts         # QuoterV2 + SwapRouter02 ABIs
    │   ├── config.ts      # env-driven address resolution
    │   ├── quote.ts       # uniswap_quote
    │   ├── swap.ts        # uniswap_swap (grant-routed)
    │   ├── approve.ts     # approve_erc20
    │   └── index.ts
    ├── kintsu/            # MON → sMON liquid staking
    │   ├── abi.ts         # ERC-7535 vault ABI
    │   ├── config.ts
    │   ├── tools.ts       # stake / request_unstake / claim_unstake / position
    │   └── index.ts
    ├── fastlane/          # MON → shMON liquid staking (shMONAD, ERC-4626 sync)
    │   ├── abi.ts
    │   ├── config.ts
    │   ├── tools.ts       # stake / request_redeem / claim_redeem / position
    │   └── index.ts
    ├── morpho/            # Morpho Blue lending
    │   ├── abi.ts         # canonical Blue singleton ABI
    │   ├── config.ts      # blue + adaptiveCurveIrm + metamorpho factory
    │   ├── market.ts      # marketId() = keccak256(abi.encode(MarketParams))
    │   ├── schemas.ts     # zod MarketParams shape
    │   ├── tools.ts       # supply / withdraw / borrow / repay / position / market
    │   └── index.ts
    └── kuru/              # fully-on-chain CLOB
        ├── abi.ts         # OrderBook (per-market contract)
        ├── config.ts      # known markets + router
        ├── tools.ts       # best_bid_ask / market_params / place_limit / cancel / market_swap
        └── index.ts
```

## Lifecycle of a write tool call

```
1. Agent calls `transfer({to, amount})` over MCP
        ↓
2. Streamable HTTP transport authenticates via Bearer token
   → privyTokenVerifier() validates → AuthInfo.extra has {userId, walletAddress, walletId}
        ↓
3. McpServer dispatches to registerTool wrapper → runTool(def, args, ctx, authInfo)
   - input validated with zod
   - "write" tools gated on walletAddress presence
        ↓
4. Tool handler builds {to, value, data} via viem encodeFunctionData
   - looks up token decimals/symbol for human-readable summary
   - estimateGas for the simulation hint
   - store.create({...}) → returns UUID
        ↓
5. Tool returns text + structured content with approval_url
        ↓
6. Agent shows the URL to the user; user opens browser
        ↓
7. GET /approve/:id → renderApprovalPage(stored) → user sees summary + asset diff
        ↓
8. User clicks "Approve & sign" → POST /api/stored-requests/:id/submit (with Bearer)
   - verifies token, ensures user owns the request
   - calls Privy: client.wallets().ethereum().sendTransaction(walletId, {caip2, to, value, data})
   - store.markApproved(id, txHash)
        ↓
9. Agent polls `poll_request({id})` → returns approved + tx_hash + explorer URL
```

## Why `runTool` is separate from `registerTool`

The MCP SDK's `mcp.registerTool(...)` registers a callback with the protocol layer. To unit-test our behavior (auth gating, network resolution, schema validation, error formatting) without spinning up a transport, we factored the logic into a plain function `runTool(def, args, ctx, authInfo)`. `registerTool` is now a thin shim that calls `runTool` from inside the MCP callback. Tests call `runTool` directly.

## Session-key grants

```
1. Agent calls grant_session_key({ spend_cap_mon, ttl, allowed_targets? })
        ↓
2. Server creates a `pending` SessionGrant + a "grant_activation" StoredRequest
        ↓
3. User clicks approval URL → submit endpoint detects pluginContext.kind === "grant_activation"
        ↓
4. grants.activate(id) flips status to "active"
        ↓
5. Subsequent transfer / swap calls hit grants.findCovering(userId, call, network)
   - Active grant covering target + selector + cap?
        ↓                              ↓
       yes                             no
        ↓                              ↓
6a. grants.recordSpend(id, value)     6b. fall through to stored-request flow,
    → atomic charge, throws if depleted    return approval URL
7a. auth.sendTransaction(walletId, ...)
    → returns tx hash synchronously
8a. tool result includes tx_hash + grant remaining
```

If Privy submission fails after the charge, `grants.refundSpend` clamps the cap back. Net: a grant can over-charge briefly (between charge and refund) but the user-visible cap is eventually consistent.

## Stored requests

`MemoryRequestStore` is process-local — fine for a single-instance dev server. For production with multiple replicas, swap in a Postgres or Redis adapter that satisfies `RequestStore`:

```ts
export interface RequestStore {
  create(input: CreateStoredRequestInput): Promise<StoredRequest>;
  get(id: string): Promise<StoredRequest | null>;
  markApproved(id: string, txHash: `0x${string}`): Promise<StoredRequest>;
  markRejected(id: string, reason?: string): Promise<StoredRequest>;
  markExpired(id: string): Promise<StoredRequest>;
}
```

Auto-expiry currently happens lazily on `get()` — for production, add a background sweep that calls `markExpired` to free memory / row space.

## Auth model

```
MCP client          monad-mcp server          Privy
   │                       │                    │
   │  POST /mcp            │                    │
   │  Authorization:       │                    │
   │  Bearer <privy_tok>   │                    │
   │ ────────────────────▶ │                    │
   │                       │  verifyAccessToken │
   │                       │ ─────────────────▶ │
   │                       │  ◀──── userId      │
   │                       │  client.users()._get(userId)
   │                       │ ─────────────────▶ │
   │                       │  ◀──── linked_accounts (embedded wallet)
   │                       │
   │                       │  AuthInfo flows into every tool handler
   │                       │
```

The bearer token comes from the MCP client's OAuth flow against Privy. The `.well-known/oauth-protected-resource` endpoint advertises Privy as the authorization server.

## Plugin contract

```ts
interface SkillPlugin {
  id: string;
  name: string;
  description: string;
  networks: Array<"mainnet" | "testnet">;
  register(mcp: McpServer, server: ServerContext): void;
}
```

Plugins are loaded statically in `src/plugins/index.ts` for v1. The interface is designed so they can be loaded out-of-process later (a la Base MCP's markdown specs).

## Tradeoffs

- **Memory store by default**: dev ergonomics > horizontal scale until needed.
- **Server-side submit path**: simpler for v1, but means Privy receives the unsigned tx and submits. Browser-first signing (Privy web SDK in the approval page) is a Phase-2 swap that keeps the same public API.
- **Static plugin loading**: explicit imports beat dynamic discovery for type safety and bundling. Revisit if we ever want third parties to ship plugins as separate npm packages.
- **Stateless HTTP transport**: one transport per process, auth per request. We don't need sessions because Privy tokens carry the identity. If we later add long-running tool tasks via SDK's experimental `tasks` API, we'd flip to stateful.
