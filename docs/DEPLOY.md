# Shipping monad-mcp

Two independent ways to get monad-mcp into people's hands:

1. **[Publish to npm](#1-publish-to-npm)** — so anyone can `npx -y monad-mcp` (the easiest connect path).
2. **[Deploy the hosted endpoint](#2-deploy-the-hosted-http-endpoint)** — a public read-only HTTPS URL anyone can paste into a client.

Both are prepared and verified; each has exactly **one step only you can do** (it needs your login), called out below.

---

## 1. Publish to npm

The package is already configured (`bin`, `files`, `exports`, `prepublishOnly`
runs build + tests). Verified contents: ~133 kB, `dist/` + `README` + `LICENSE`.

### First publish (manual, one time)

```bash
npm login            # opens browser; needs your npm account + 2FA  ← only you can do this
npm publish --access public
```

`prepublishOnly` automatically rebuilds and runs the test suite first, so a
broken build can't ship. Verify it landed:

```bash
npm view monad-mcp version     # → 0.1.0
npx -y monad-mcp --help 2>/dev/null || echo "installed & runs"
```

### Every release after that (automated)

A GitHub Actions workflow (`.github/workflows/release.yml`) publishes on any
`v*` tag. One-time setup:

1. Create an **automation** access token at npmjs.com → Access Tokens.
2. Add it to the repo: **Settings → Secrets and variables → Actions →** new
   secret named `NPM_TOKEN`. (Or: `gh secret set NPM_TOKEN`.)

Then cutting a release is:

```bash
npm version patch        # or minor / major — bumps package.json and tags
git push --follow-tags   # tag push triggers the workflow → npm publish
```

The workflow builds, tests, and publishes with npm **provenance** (supply-chain
attestation), so the npm page shows it was built from this repo + commit.

---

## 2. Deploy the hosted HTTP endpoint

Ships `dist/server-http.js` (Streamable-HTTP MCP transport) on
[Fly.io](https://fly.io). With no Privy creds it's an **open, read-only gateway**
— write tools return `AuthRequiredError`, so it's safe to make public. Config
lives in `Dockerfile` + `fly.toml`.

> **Live now:** https://monad-mcp.fly.dev/mcp (health: https://monad-mcp.fly.dev/health).
> The instructions below are the runbook for re-deploying or standing up your own.

### Deploy

```bash
fly auth login          # browser login; needs your Fly account  ← only you can do this
fly launch --copy-config --now
```

`fly launch` reuses the committed `fly.toml`. App names are globally unique, so
if `monad-mcp` is taken it'll prompt for another — note whatever name you get;
your endpoint is `https://<app-name>.fly.dev/mcp`.

Subsequent deploys after that are just:

```bash
fly deploy
```

### Verify the live endpoint

```bash
curl https://monad-mcp.fly.dev/health
# {"ok":true,"version":"0.1.0","default_network":"testnet","privy_enabled":false}
```

Then connect a client to `https://monad-mcp.fly.dev/mcp` — see
[connect-claude.md → Option B](./connect-claude.md#option-b--hosted-url-read-only).

### (Optional) test the container locally first

Requires Docker running:

```bash
docker build -t monad-mcp .
docker run --rm -p 8787:8787 monad-mcp
curl http://localhost:8787/health
```

### (Optional) enable write tools on your own deploy

A hosted write-enabled endpoint also needs Privy signing infrastructure. Set the
secrets (they're encrypted at rest on Fly, never in the image):

```bash
fly secrets set \
  PRIVY_APP_ID=clxxxx \
  PRIVY_APP_SECRET=xxxx \
  PRIVY_AUTHORIZATION_PRIVATE_KEY=... \
  PRIVY_KEY_QUORUM_ID=... \
  PUBLIC_BASE_URL=https://<app-name>.fly.dev
```

Once `PRIVY_APP_ID`/`PRIVY_APP_SECRET` are present, `/mcp` switches to requiring
an OAuth 2.1 bearer token (the per-user Privy identity) and the approval flow
goes live. See [claude-desktop.md](./claude-desktop.md) for the bootstrap details.

### Other hosts

The `Dockerfile` is plain — Railway, Render, Cloud Run, or any container host
works. Expose port `8787`, point health checks at `/health`, set
`MONAD_DEFAULT_NETWORK`, and (for writes) the `PRIVY_*` secrets.

---

## What only you can do

Everything else is committed and verified. The two gated steps, both because they
require your personal login:

| Step | Command | Why it's manual |
|------|---------|-----------------|
| First npm publish | `npm login && npm publish --access public` | npm account + 2FA OTP |
| First Fly deploy | `fly auth login && fly launch --copy-config --now` | Fly account |

After each first run, releases/deploys are one command (`git push --follow-tags`
/ `fly deploy`).
