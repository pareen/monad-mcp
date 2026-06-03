# monad-mcp FAQ

## Basics

### What is monad-mcp?

monad-mcp is an MCP server for the Monad blockchain. It gives AI agents a typed interface for checking balances, reading contracts, resolving tokens, sending transfers, swapping, staking, lending, bridging, and paying x402 services.

The main design constraint is that the agent can propose onchain actions, but it does not receive a private key.

### Who is this for?

It is for developers and power users who want an AI agent, such as Claude, Cursor, or another MCP client, to interact with Monad from chat or an agent workflow.

Common uses include:

- Asking for wallet balances, token balances, and portfolio summaries.
- Looking up token prices, token risk signals, and transaction history.
- Simulating or reading contract calls before acting.
- Preparing transfers, swaps, staking, lending, or contract writes for user approval.
- Giving an agent limited autonomy through session-key grants.

### Which Monad networks are supported?

monad-mcp supports Monad mainnet `143` and Monad testnet `10143`.

Some plugins are mainnet-only and are skipped at boot when `MONAD_DEFAULT_NETWORK=testnet`. You can still override the network per tool where the tool supports it.

### Which clients can use it?

The server supports MCP over stdio and Streamable HTTP.

Typical clients include:

- Claude Code
- Claude Desktop
- Cursor
- Remote MCP clients that support Streamable HTTP

## Setup

### Can I try it without installing anything?

Yes, for read-only use. You can point an MCP client at the hosted endpoint:

```bash
claude mcp add --transport http monad https://monad-mcp.fly.dev/mcp
```

The hosted endpoint is intended for read tools such as balances, portfolio data, token lookup, transaction history, receipts, and contract reads.

### What requires self-hosting?

Any action that signs or submits transactions requires self-hosting with your own Privy configuration.

That includes:

- Transfers
- Swaps
- Staking
- Lending and borrowing
- Contract writes
- x402 payments
- Bridge execution
- Session-key grants

### What environment variables do I need?

For read-only local development, the defaults are enough for many tools.

For write tools, you need at least:

```bash
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
PUBLIC_BASE_URL=http://localhost:8787
MONAD_DEFAULT_NETWORK=testnet
```

For server-side wallet authorization, you also need the values produced by:

```bash
npm run bootstrap:auth-key
```

That command prints:

```bash
PRIVY_AUTHORIZATION_PRIVATE_KEY=...
PRIVY_KEY_QUORUM_ID=...
```

### Why do I need to run `npm run bootstrap:auth-key`?

Privy embedded wallets are user-owned by default. The server needs a P-256 key quorum registered with Privy and attached as an `additional_signer` when a wallet is created.

Run bootstrap before creating wallets. Wallets created before these env vars are set are stranded for this server because Privy does not let you retrofit an additional signer without existing authorization.

### Can I use wallets created before bootstrap?

Not for server-side signing through this MCP server. Create a new user or wallet after bootstrap so the required signer quorum is attached at wallet creation.

## Security

### Can the agent steal my funds?

The agent does not receive a private key and cannot sign directly. For normal write tools, it builds an unsigned transaction request and returns an approval URL. The user reviews and approves the action through the approval page.

If a session-key grant covers the action, the server may submit the transaction without another approval click, but only inside the grant's configured limits.

### Does the MCP server hold my wallet private key?

No. Wallet custody is handled by Privy. The server may hold a Privy authorization key used for server-side wallet authorization, but that is not the user's wallet private key. Treat it as sensitive infrastructure secret material.

### How do approval URLs work?

Write tools follow the stored-request pattern:

1. The agent calls a write tool.
2. The server builds an unsigned transaction payload and human-readable summary.
3. The server stores the request under a UUID.
4. The tool returns an approval URL.
5. The user opens the approval URL, reviews the request, and approves or rejects it.
6. The agent calls `poll_request` to learn the final status and transaction hash.

### What happens if the agent proposes a bad transaction?

The user can reject the approval request. The transaction is not submitted unless the user approves it or the action fits inside a previously approved session-key grant.

Use small session-key limits, target allowlists, and short expirations when trying autonomous flows.

### What are session keys?

Session keys are scoped grants that let the agent act without a per-transaction approval URL.

A grant can limit:

- Total MON spend.
- Expiration time.
- Allowed target addresses.
- Allowed function selectors.

If a write action is covered by an active grant, the tool can submit immediately. If not, it falls back to the normal approval URL flow.

### Can I revoke a session key?

Yes. Use `list_session_keys` to inspect active and recent grants, then `revoke_session_key` to cancel one.

### Should I use mainnet funds?

Start on testnet. Before using mainnet funds, verify protocol addresses, token addresses, Privy configuration, approval URLs, and session-key limits.

Use small amounts until you have tested the full flow end to end.

## Tools

### Which tools are read-only?

Read-oriented tools include:

- `get_balance`
- `get_token_balance`
- `get_portfolio`
- `get_transaction_history`
- `get_tx_receipt`
- `simulate_transaction`
- `check_token`
- `resolve_token`
- `get_token_price`
- `list_canonical_tokens`
- `resolve_name`
- `read_contract`
- `decode_return_data`
- `bridge_quote`

Some read tools can optionally use an authenticated wallet context, but they do not submit transactions.

### Which tools can move funds or change chain state?

Write-oriented tools include:

- `transfer`
- `write_contract`
- `pay_for_service`
- `bridge_execute`
- `grant_session_key`
- `revoke_session_key`
- Plugin write tools such as swaps, staking, lending, and order placement.

These require authentication and either explicit user approval or a covering session-key grant.

### Can it read arbitrary contracts?

Yes. Use `read_contract` with the target address, ABI, function name, and arguments.

### Can it write to arbitrary contracts?

Yes. Use `write_contract` with the target address, ABI, function name, and arguments. The result goes through the same approval or session-key flow as other writes.

### Can it simulate transactions before submitting?

Yes. `simulate_transaction` performs an `eth_call` dry run and returns return data or a revert reason where available.

### Can it identify risky tokens?

`check_token` applies heuristics such as canonical-list membership, bytecode presence, DEX liquidity, and pair age. It is a risk signal, not a guarantee of safety.

## DeFi Plugins

### Which protocol plugins ship with the server?

The server includes:

- Uniswap v3 for quotes, swaps, and ERC-20 approvals.
- Kintsu for MON to sMON liquid staking.
- FastLane for MON to shMON liquid staking.
- Morpho for lending and borrowing.
- Kuru for onchain CLOB markets.

### Are plugins available on testnet?

Uniswap supports testnet and mainnet when configured with the relevant contract addresses. Kintsu, FastLane, Morpho, and Kuru are mainnet-oriented in this repo and are skipped at boot when the default network is testnet.

### Can I add my own protocol plugin?

Yes. Add a folder under `src/plugins/<id>/`, export a `SkillPlugin`, register tools with `registerTool`, and add the plugin to `src/plugins/index.ts`.

Write tools only need to construct a transaction payload and use the shared stored-request approval flow.

## Production

### Is the default memory store production-ready?

The memory store is convenient for local development, but it is not suitable for multi-replica production. Use the Postgres backend for persistent stored requests and grants.

### Does the hosted endpoint support writes?

No. The hosted endpoint is for read-only use. Writes require a self-hosted signer and your own Privy credentials.

### What should I verify before deploying?

Before deploying, verify:

- `PUBLIC_BASE_URL` points at the externally reachable HTTP server.
- Privy app ID, secret, verification key, authorization private key, and key quorum ID are configured.
- The default network is intentional.
- Contract addresses for enabled plugins are correct.
- The store backend is appropriate for the deployment shape.
- Approval URLs work from a real browser.
- Testnet transfer and session-key flows pass before enabling mainnet usage.

### What are the known sharp edges?

Important operational details:

- Run `npm run bootstrap:auth-key` before provisioning wallets.
- Do not use wallets created before bootstrap for server-side writes.
- Verify protocol and token addresses before using mainnet funds.
- Prefer short-lived session keys with small caps.
- Use Postgres rather than memory storage for production or multiple replicas.
