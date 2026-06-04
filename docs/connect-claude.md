# Connect monad-mcp to Claude or ChatGPT

You don't need to install anything, open a terminal, or edit any files. You paste
**one web address** into your AI app's settings, and it can read live data from the
[Monad](https://monad.xyz) blockchain — wallet balances, token prices, portfolios,
transaction history, token safety checks.

> **The one address you need:**
>
> ```
> https://monad-mcp.fly.dev/mcp
> ```
>
> It's a public, **read-only** endpoint — safe to paste anywhere. It can look up
> anything on-chain, but it can't move money (see [Sending transactions](#sending-transactions-writes)).

Pick your app:

- [Claude Desktop](#claude-desktop) — paste a connector
- [ChatGPT](#chatgpt) — paste a connector
- [Claude Code (terminal)](#claude-code-terminal) — one command, for developers

---

## Claude Desktop

**You'll need:** the Claude desktop app (macOS or Windows) and a paid Claude plan
(Pro, Max, Team, or Enterprise — custom connectors aren't on the free plan).

1. Open **Claude Desktop**.
2. Click your name / the **gear icon → Settings**.
3. Go to **Connectors** in the sidebar.
4. Click **Add custom connector** (you may need **Advanced** to see it).
5. Fill in:
   - **Name:** `Monad`
   - **URL:** `https://monad-mcp.fly.dev/mcp`
6. Click **Add**, then **Enable** the connector if it isn't already.

That's it — no restart needed. Skip to [Check it worked](#check-it-worked).

> Labels move around between versions; if you don't see "Add custom connector,"
> look for **Connectors → Add** or **Developer / Advanced** in Settings.

---

## ChatGPT

**You'll need:** ChatGPT on a paid plan (Plus, Pro, Business, or Enterprise) —
custom connectors aren't available on the free plan.

1. Open **ChatGPT** (desktop app or [chatgpt.com](https://chatgpt.com)).
2. Click your profile → **Settings**.
3. Go to **Connectors** → open **Advanced** and turn on **Developer mode**
   (this is what lets you add your own connector). You only do this once.
4. Back on **Connectors**, click **Create** / **Add**.
5. Fill in:
   - **Name:** `Monad`
   - **MCP Server URL:** `https://monad-mcp.fly.dev/mcp`
   - **Authentication:** None
6. Save. In a new chat, open the **+ / tools** menu and make sure **Monad** is on.

> ChatGPT's connector screens are still labelled "beta" and shift often. The two
> things that matter: enable **Developer mode**, and paste the URL above with auth
> set to **None**.

---

## Check it worked

In a new conversation, ask:

> What tools does the Monad connector give you?

You should see it list ~30 Monad tools. Then try a real lookup — these touch live
testnet data and move no money:

> What's the balance of `0x7E274bCA90eEfa81761080e074AFb1D354a0c552` on Monad testnet?

> List the canonical Monad tokens.

> What's the USD price of MON right now?

> Get a portfolio for `0x7E274bCA90eEfa81761080e074AFb1D354a0c552`.

If nothing shows up, double-check the URL is exactly `https://monad-mcp.fly.dev/mcp`
and that the connector is **enabled**. You can confirm the server itself is alive
by opening <https://monad-mcp.fly.dev/health> in a browser — it should say `"ok":true`.

---

## Claude Code (terminal)

For developers who live in [Claude Code](https://claude.com/claude-code), skip the
UI and add it in one line:

```bash
claude mcp add --transport http monad https://monad-mcp.fly.dev/mcp
```

Or run the package locally instead of hitting the hosted endpoint (downloads on
first use, needs Node ≥ 20):

```bash
claude mcp add monad -- npx -y monad-mcp
```

Remove either with `claude mcp remove monad`.

---

## Sending transactions (writes)

Reads and writes are split. **Read tools are public** — paste the URL and ask for
balances, prices, or history with no login at all. **Write tools (send, swap,
stake) are gated**: ask the connector to move money and it politely refuses with a
"requires a connected wallet — sign in via Privy and retry" message until you
authenticate. Pasting the URL can never spend your funds.

A one-tap "sign in and send" experience (you log in with [Privy](https://dashboard.privy.io),
a wallet is created for you, and you approve each transaction in your browser) is
wired into the hosted endpoint via OAuth, but the in-browser login step is still
being verified end-to-end. The fully tested path for writes today is running your
**own** instance with Privy signing credentials:

- Local setup for Claude Desktop / Claude Code: [claude-desktop.md](./claude-desktop.md)
- Hosting your own endpoint: [DEPLOY.md](./DEPLOY.md)

---

## Hack on it / run your own

Clone, build, and point a client at your own build:

```bash
git clone https://github.com/pareen/monad-mcp.git
cd monad-mcp
npm install
npm run build
claude mcp add monad -- node /absolute/path/to/monad-mcp/dist/index.js
```

Full deploy + publish runbook: [DEPLOY.md](./DEPLOY.md).
