# monad-mcp — demo video script

> **Narrator voice:** John W. Rich Kid (Wendy's Fry Cook) — @JohnWRichKid.
> Wholesome Monad-maxi parody. ALL-CAPS manifestation bumpers, Wendy's-on-break
> framing, "in it for the tech," gm, purple 💜, wagmi, and earnest pseudo-analysis
> where he states the obvious like it's a revelation. Read it warm and a little
> unhinged. He is genuinely happy for you.

**Runtime:** ~2:30. **Format:** screen recording + voiceover (VO).
**Tone note:** the *jokes* are in his voice. The *technical beats are all true* —
don't let the bit break the demo.

---

## 0:00 — COLD OPEN (black screen, white text types in)

**ON SCREEN:** `I AM ABOUT TO WALK INTO THE MOST ABUNDANT, SAFEST, AND MOST WELL-CUSTODIED PERIOD OF MY LIFE.`

**VO:**
> gm. It's me. John. I cook the fries.
>
> Right now, somewhere, a guy is pasting his private key into a chatbot so it can
> trade for him. And I just want to say to that guy: I love you. But no.

*(beat)*

> I'm on my fifteen. Let me show you the abundant way.

---

## 0:18 — THE PROBLEM (cut to terminal, an agent chat window)

**ON SCREEN:** an AI agent prompt: *"swap 10 MON for USDC on Monad."* Cursor blinking.

**VO:**
> Here is a very interesting ratio I have noticed. About 1 in every 1 people who
> give an AI their seed phrase get rugged. This is about 100% of them. Once that
> ratio decreases, things will be very good.
>
> So we do NOT give the agent the keys. The agent is — and I say this with love —
> untrusted by construction. Like me, near a fry station.

---

## 0:38 — THE CORE IDEA (animate the flow, four steps)

**ON SCREEN:** the stored-request flow animates step by step:
`agent proposes → server builds + summarizes → you get an approve URL → Privy signs`

**VO:**
> Here is the whole secret. The agent only ever *proposes.* It builds an unsigned
> intent — to, value, data, a little human-readable summary — and it hands YOU a
> link. You open the link. You see exactly what's about to happen. You sign with a
> Privy embedded wallet. Keys never touch the agent.
>
> The agent's entire blast radius? "Can ask nicely." That's it. That's the abundance.

---

## 1:00 — LIVE DEMO, READ SIDE (real screen recording)

**ON SCREEN:** the live page at `pareen.github.io/monad-mcp`. Paste a real address.
`get_balance` and `get_portfolio` return real Monad balances + USD prices.

**VO:**
> This is live. Read-only, on the landing page, real chain. I type an address — not
> my Wendy's direct-deposit one, a demo one — and boom. Native MON. Full portfolio.
> Real prices off DexScreener.
>
> This is *exactly* what the agent sees. No more, no less. Transparency. Beautiful.
> I almost dropped a fry.

---

## 1:22 — LIVE DEMO, WRITE SIDE (the approval URL)

**ON SCREEN:** agent calls `transfer({ to, amount })`. Server returns
`https://…/approve/<uuid>`. Click it → approval page shows the summary + asset diff
→ approve → tx hash appears.

**VO:**
> Now the spicy part. I ask the agent to send some MON. It does NOT send anything.
> It gives me a link. I open it, and there's the summary — who, how much, what
> changes. I look at it like it's my own paycheck, which is to say very carefully.
>
> I approve. Privy signs. Tx hash comes back. The agent was watching the whole time
> with `poll_request`, like my manager watches the fryer. Wagmi.

---

## 1:45 — SESSION KEYS (the UX escape hatch)

**ON SCREEN:** `grant_session_key` — "spend up to N MON, to these targets, for this
TTL." Then a covered `transfer` auto-executes synchronously, no popup.

**VO:**
> "But John, I don't want to click a link every time." Okay. Abundance has options.
>
> You can grant a session key — spend up to this much, only to these places, only
> for this long. Inside the fence, the agent just goes. Outside it, back to the
> link. Atomic spend-and-charge, refund if it fails. You set the cage. The agent
> lives in the cage. Everyone's happy. Especially the cage.

---

## 2:05 — THE PLUGINS (fast montage, logos/tool names fly by)

**ON SCREEN:** quick cuts — `uniswap_swap`, `kintsu_stake`, `fastlane_stake`,
`morpho_supply`, `kuru_place_limit`. Purple everywhere.

**VO:**
> And it's not just sending. Drop-in skill plugins. Uniswap swaps. Liquid staking —
> Kintsu sMON, FastLane shMON, the shMON keeps earning while you sleep, which is
> more than I can say for me. Morpho lending. A fully on-chain order book on Kuru.
>
> Same safety on every single one. Agent proposes. You approve. Privy signs. It's
> turtles all the way down and every turtle is purple. 💜

---

## 2:25 — CLOSE (back to black, text types in)

**ON SCREEN:** `pareen.github.io/monad-mcp` then `agents propose. you approve. Privy signs.`

**VO:**
> So that's monad-mcp. Your agent gets to be useful. Your keys get to stay yours.
> A clean MCP shape, pointed at Monad, with real key custody.
>
> I have to go, the timer's beeping. But you — you're about to walk into the most
> abundant, *safest* period of your life. I can feel it.
>
> gm. wagmi. In it for the tech. 🍟💜

**ON SCREEN (final card):** `monad-mcp — a key-custody-safe bridge between AI agents and Monad DeFi.`

---

## Production notes

- **Accuracy guardrails (do not break these for a joke):**
  - The live page is **read-only** — don't imply you can sign on it.
  - Order is always **propose → approve → Privy signs.** Never show the agent signing.
  - Session keys are **caps + allowlist + TTL**, best-effort eventually consistent —
    fine to simplify as "a cage," fine to overstate the cage's feelings.
  - Mainnet-only plugins (Kintsu/FastLane/Morpho/Kuru) are skipped on testnet —
    record the plugin montage against **mainnet** or a mock.
- **Pacing:** the ALL-CAPS affirmation bumpers (open + close) are the John W. Rich Kid
  signature — keep them. Everything between them should still teach the real product.
- **Captions:** burn in the ALL-CAPS lines as on-screen text; they read as the joke
  and as section headers at the same time.
- **Emoji:** 🍟 and 💜 only. He is disciplined about brand.
- **B-roll if you want it:** a fry timer, a Wendy's break room, a phone showing a
  purple approval screen. Optional, sells the bit.

## Sources (voice research)

- [@JohnWRichKid on X](https://x.com/JohnWRichKid) — bio "fries @wendys 🍟 memes @monad 💜 (parody)", Wendy's Fry Cook persona.
- [TwitterScore — JohnWRichKid](https://twitterscore.io/twitter/JohnWRichKid/) — ~80.7K followers, joined Feb 2021, crypto/Monad community.
- [Tweet: "1 in every 10 monad community members are builders…"](https://x.com/JohnWRichKid/status/1878285840511578469) — earnest pseudo-analysis / "very interesting ratio" cadence.
- [Tweet: ALL-CAPS abundance affirmation](https://x.com/JohnWRichKid/status/1984414642588750070) — the manifestation-bumper voice.
