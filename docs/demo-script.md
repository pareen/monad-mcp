# Demo recording script

A tight ~90-second walkthrough that shows the whole arc: read → approve → autonomous. Record it in Claude Desktop with the server wired in (see [`claude-desktop.md`](./claude-desktop.md)).

## Setup (before you hit record)

- `npm run build`, server wired into Claude Desktop, `npm run start:http` running (approval URLs need it)
- A funded testnet wallet — reuse the bootstrapped E2E user (`MONAD_MCP_E2E_USER_ID` in `.env`); top it up at https://testnet.monad.xyz
- `MONAD_DEFAULT_NETWORK=testnet`
- A screen recorder going (QuickTime, or `asciinema rec` for a terminal-only cut). Capture the Claude window **and** the browser approval tab.
- Have the explorer open in a tab so you can cut to the confirmed tx.

## The 6 beats

> Keep each prompt verbatim-ish; the point is to show the model *choosing tools*, not you typing addresses.

**1. Orient — "what can you do here?"**
```
What can you do with my Monad wallet?
```
*Shows:* the tool surface. Claude lists read + write capabilities. ~5s, sets context.

**2. Read — prove it's real, no signing**
```
What's my MON balance and full portfolio on Monad testnet?
```
*Shows:* `whoami` → `get_portfolio`. Real balances, USD values, zero friction. This is the "it's actually reading the chain" moment.

**3. First write — the approval flow**
```
Send 0.01 MON to 0x000000000000000000000000000000000000dEaD.
```
*Shows:* `transfer` returns an approval URL → **cut to the browser tab** → the approval page with the asset diff → click Approve → Privy signs → Claude reports the tx hash. **Cut to the explorer** showing the confirmed tx. This is the security story: the agent proposed, *you* approved, the key never left Privy.

**4. The unlock — grant a session key**
```
Grant yourself up to 0.05 MON for the next hour so you don't have to ask me every time.
```
*Shows:* `grant_session_key` → one approval URL → you approve **once**. Mention on camera: "this also gets mirrored as a Privy wallet policy, so even a compromised server can't exceed it."

**5. Autonomy — watch it act without asking**
```
Now send three 0.005 MON tips to 0x…A, 0x…B, and 0x…C.
```
*Shows:* three `transfer` calls that **execute immediately** under the grant — tx hashes come straight back, no approval tab. This is the payoff: the difference between "asks 3 times" and "runs the task."

**6. DeFi — one more capability, then revoke**
```
Stake 0.01 MON with FastLane, then revoke that session key.
```
*Shows:* `fastlane_stake` (auto-executes under the remaining budget) → `revoke_session_key`. Ends on a responsible note: the budget is closed.

## Outro card (optional)

> "monad-mcp — your agent's gateway to Monad. Open source: github.com/pareen/monad-mcp"

## Editing notes

- Total target: 75–100s. Cut dead air during block confirmation (Monad is fast, but trim anyway).
- The two beats that sell it: **#3** (approval + explorer confirmation = "this moves real money safely") and **#5** (autonomous execution = "this is why session keys matter"). Give those the most screen time.
- Export a looping GIF of beats #3 + #5 for the landing page hero / the README, and the full clip for the X/Twitter post.
- Caption the autonomous beat: *"no approval prompt — running inside the session-key budget."*

## Where it goes

- Landing page: drop the GIF above the live demo section in `site/index.html`.
- README: embed near the top.
- Launch post: lead with the #5 autonomy clip.
