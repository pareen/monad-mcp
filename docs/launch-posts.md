# Launch posts

Copy-paste-ready text for announcing monad-mcp. Swap in the demo GIF/video where noted.

---

## X / Twitter — thread

**1/**
Your AI agent can now *act* on Monad.

monad-mcp — an open-source MCP server that lets Claude (or any MCP client) check balances, swap, lend, stake, bridge, and pay onchain.

Keys never touch the server. Every action waits for your approval.

🧵 + live demo 👇

**2/**
The hard part isn't wrapping an RPC.

It's that agents aren't humans. A person clicks "approve" 40 times happily. An agent running a strategy at 2am won't.

So monad-mcp has **session keys**: authorize a budget once (cap + expiry + allowlist), and the agent transacts inside it. No more prompts.

**3/**
Security model:

🔑 Privy holds the key in a TEE — the server can't move funds
✋ Every write returns an approval link with a simulated asset diff
🛡️ Session-key grants are mirrored as Privy wallet policies — so even a compromised server can't exceed your budget

**4/**
58 tools, 5 DeFi plugins: Uniswap, Kintsu + FastLane staking, Morpho lending, Kuru CLOB.

Plus a universal read_contract/write_contract so your agent can hit *any* Monad contract.

129 tests. Verified end-to-end on testnet.

**5/**
Try the live read-only demo in your browser (real Monad RPC, no wallet needed):
🌐 https://pareen.github.io/monad-mcp

Code (MIT):
⭐ https://github.com/pareen/monad-mcp

Built on @monad_xyz + @privy_io. [demo GIF here]

---

## X / Twitter — single post (if you skip the thread)

Shipped monad-mcp 🟣

Open-source MCP server that lets your AI agent transact on Monad — swap, lend, stake, bridge, pay — with Privy-backed signing + session keys for bounded autonomy. Keys never touch the server.

58 tools · 5 DeFi plugins · live demo:
https://pareen.github.io/monad-mcp

[demo GIF]

---

## Show HN

**Title:** Show HN: monad-mcp – let AI agents transact on Monad with bounded autonomy

**Body:**

I built an MCP server that connects AI agents (Claude Desktop, Cursor, etc.) to the Monad blockchain. It does the obvious stuff — balances, transfers, swaps, lending, staking, bridging, x402 payments — but the part I actually found interesting was the autonomy/safety boundary.

A human is happy to approve every transaction. An agent running a recurring strategy is not. So instead of only "agent proposes → you click approve" (which I also support, with a simulated asset diff), there's a session-key system: you authorize a scoped budget once — spend cap, TTL, recipient allowlist, function-selector allowlist — and the agent transacts within it, no further prompts. Each grant is also mirrored as a Privy wallet policy, so even if my server were compromised it can't exceed the budget you set. Keys live in Privy's TEE; the server only ever builds unsigned transactions.

Stack: TypeScript, viem, the MCP TypeScript SDK (stdio + Streamable HTTP), Privy for embedded-wallet signing. Memory or Postgres persistence. 5 DeFi plugins (Uniswap v3, Kintsu + FastLane staking, Morpho Blue, Kuru CLOB) plus a universal read_contract/write_contract for any contract. 129 tests, verified end-to-end on testnet.

Live read-only demo (runs the read tools against real Monad RPC in your browser): https://pareen.github.io/monad-mcp
Code (MIT): https://github.com/pareen/monad-mcp

Happy to talk about the approval-token design or the session-key → Privy-policy mirroring.

---

## Reddit (r/ethdev, r/MonadDev)

**Title:** Open-sourced an MCP server for Monad — AI agents that swap/lend/stake with session-key budgets

Same body as Show HN, lightly trimmed. Lead with the demo link.

---

## Farcaster / Warpcast

gm — open-sourced monad-mcp 🟣

your agent, transacting on Monad: swap, lend, stake, bridge, pay. privy-signed, session-key budgets so it doesn't ask permission 40x. keys never touch the server.

live demo + code 👇
https://pareen.github.io/monad-mcp

---

## Notes

- Lead every channel with the **demo** (GIF or the live page), not the feature list.
- The two strongest hooks: "keys never touch the server" and "session keys so the agent doesn't ask 40 times." Pick one per post.
- Tag Monad + Privy where the platform allows; they often reshare ecosystem launches.
- Post the autonomy clip (demo beat #5) as the standalone video — it's the most novel moment.
