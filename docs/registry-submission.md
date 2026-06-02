# Submitting to MCP registries

The repo ships a [`server.json`](../server.json) manifest in the official MCP
registry format. Here's how to get listed in each place. **Do these after
`npm publish`** — every listing links to the npm package, so a dead package
makes a dead listing.

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

Uses the `mcp-publisher` CLI + the `server.json` in this repo. The
`io.github.pareen/*` namespace proves ownership via GitHub auth.

```bash
# install the publisher CLI (Homebrew or Go)
brew install mcp-publisher    # or: go install github.com/modelcontextprotocol/registry/cmd/mcp-publisher@latest

# from the repo root
mcp-publisher login github     # opens GitHub OAuth — must be the pareen account
mcp-publisher publish          # validates + submits server.json
```

Prereq: `monad-mcp` must be published to npm first (the registry verifies the
package exists and that its `mcp-name` field / repo matches). If validation
complains about ownership, add `"mcpName": "io.github.pareen/monad-mcp"` to
`package.json` and republish to npm.

## 2. modelcontextprotocol/servers (the README list)

The community list lives in that repo's README. Open a PR adding one line under
the community servers section:

```markdown
- **[Monad](https://github.com/pareen/monad-mcp)** - Transact on the Monad blockchain (balances, swaps, lending, staking, bridging, x402) with Privy-backed signing and session keys.
```

```bash
gh repo fork modelcontextprotocol/servers --clone
# edit README.md — add the line alphabetically in Community Servers
# commit, push to your fork, then:
gh pr create --repo modelcontextprotocol/servers --title "Add Monad MCP server" \
  --body "Adds monad-mcp — an MCP server for the Monad blockchain. MIT, published to npm as \`monad-mcp\`, live demo at https://pareen.github.io/monad-mcp"
```

Read their CONTRIBUTING first — they sometimes require the package to be
published and may have an ordering/format convention.

## 3. mcp.so

Community directory. Submit at https://mcp.so/submit (web form) — paste the
GitHub URL; it auto-pulls the README and npm metadata. No PR needed.

## 4. Other aggregators (optional)

- **glama.ai/mcp/servers** — auto-indexes from GitHub topics; the `mcp` +
  `model-context-protocol` topics are already set, so it may pick it up
  automatically. Submit manually at glama.ai if not.
- **pulsemcp.com**, **smithery.ai** — similar GitHub-URL submission forms.

## Order of operations

1. `npm publish` (see README)
2. Tag/release already done (v0.1.0)
3. Official registry via `mcp-publisher`
4. PR to modelcontextprotocol/servers
5. mcp.so + others
