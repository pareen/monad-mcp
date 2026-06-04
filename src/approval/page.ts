import type { StoredRequest } from "../store/types.js";

/**
 * Server-rendered approval page.
 *
 * Two signing modes:
 *  - `client` (default for real transactions): loads Privy's web SDK from a CDN,
 *    has the user authenticate, then signs + broadcasts the transaction with the
 *    user's OWN embedded wallet in the browser. The server never touches a key.
 *    This works for any wallet the user controls — including browser-login
 *    wallets the server can't sign for — and is the trust-maximizing path.
 *  - `server` (grant activations): there's no transaction to sign in the
 *    browser, so the click POSTs to the server-submit endpoint, which flips a
 *    server-side grant. Kept for that one flow.
 *
 * No build step: React + the Privy SDK are pulled as browser-native ESM from
 * esm.sh and the UI is written with React.createElement (no JSX).
 */
export function renderApprovalPage(opts: {
  request: StoredRequest;
  privyAppId: string;
  chainId: number;
  publicBaseUrl: string;
  rpcUrl: string;
  approvalToken?: string;
  signingMode?: "client" | "server";
  /** Pin a known-good Privy SDK major to insulate from breaking releases. */
  privySdkVersion?: string;
}): string {
  const {
    request,
    privyAppId,
    chainId,
    publicBaseUrl,
    rpcUrl,
    approvalToken,
    signingMode = "client",
    privySdkVersion = "2",
  } = opts;
  const payload = JSON.stringify({
    request: {
      id: request.id,
      summary: request.summary,
      network: request.network,
      walletAddress: request.walletAddress,
      call: request.call,
      simulation: request.simulation,
      expiresAt: request.expiresAt,
    },
    privyAppId,
    chainId,
    publicBaseUrl,
    rpcUrl,
    approvalToken: approvalToken ?? null,
    signingMode,
    privySdkVersion,
  });

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Approve transaction · monad-mcp</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; --bg:#0a0a0a; --fg:#fafafa; --muted:#888; --card:#161616; --border:#262626; --pri:#7a5cff; --pri-fg:#fff; --danger:#ff4d4d; --ok:#3acf86; --warn:#ffb454; }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px; max-width: 480px; width: 100%; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .subtitle { color: var(--muted); margin: 0 0 24px; font-size: 13px; }
    .summary { font-size: 16px; padding: 16px; background: #0d0d0d; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; }
    dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 13px; }
    dt { color: var(--muted); }
    dd { margin: 0; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .row { display: flex; gap: 8px; margin-top: 24px; }
    button { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--fg); font-size: 14px; font-weight: 500; cursor: pointer; }
    button.primary { background: var(--pri); color: var(--pri-fg); border-color: var(--pri); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 13px; display: none; }
    .status.show { display: block; }
    .status.ok { background: rgba(58, 207, 134, 0.1); border: 1px solid var(--ok); color: var(--ok); }
    .status.err { background: rgba(255, 77, 77, 0.1); border: 1px solid var(--danger); color: var(--danger); }
    .status.warn { background: rgba(255, 180, 84, 0.1); border: 1px solid var(--warn); color: var(--warn); }
    .change { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .change:last-child { border-bottom: none; }
    .delta-neg { color: var(--danger); }
    .delta-pos { color: var(--ok); }
    .spinner { width: 22px; height: 22px; border: 3px solid var(--border); border-top-color: var(--pri); border-radius: 50%; margin: 4px auto; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: var(--pri); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Approve transaction</h1>
    <p class="subtitle">monad-mcp · ${escapeHtml(request.network)}</p>
    <div class="summary">${escapeHtml(request.summary)}</div>
    <div id="changes"></div>
    <dl>
      <dt>From</dt><dd>${request.walletAddress}</dd>
      <dt>To</dt><dd>${request.call.to}</dd>
      <dt>Value</dt><dd>${request.call.value} wei</dd>
      <dt>Data</dt><dd style="max-height:80px;overflow:auto">${request.call.data}</dd>
      <dt>Expires</dt><dd id="expires"></dd>
    </dl>
    <div id="action"></div>
    <div id="status" class="status"></div>
  </div>

  <script type="module">
    const __DATA__ = ${payload};
    const expiresEl = document.getElementById("expires");
    const statusEl = document.getElementById("status");
    const actionEl = document.getElementById("action");
    const changesEl = document.getElementById("changes");
    const R = __DATA__.request;

    expiresEl.textContent = new Date(R.expiresAt).toLocaleString();

    const changes = (R.simulation && R.simulation.assetChanges) || [];
    changesEl.innerHTML = changes.map(c => {
      const sign = c.delta && c.delta.startsWith("-") ? "neg" : "pos";
      const sym = c.symbol || (c.kind === "native" ? "MON" : "TOKEN");
      const dec = c.decimals ?? 18;
      const raw = (c.delta || "0").replace("+", "").replace("-", "");
      const val = (Number(BigInt(raw)) / 10**dec).toFixed(6);
      return \`<div class="change"><span>\${sym}</span><span class="delta-\${sign}">\${c.delta && c.delta.startsWith("-") ? "-" : "+"}\${val}</span></div>\`;
    }).join("");

    function showStatus(kind, html) {
      statusEl.innerHTML = html;
      statusEl.className = "status show " + kind;
    }

    function explorerTx(hash) {
      const base = __DATA__.chainId === 143
        ? "https://monadexplorer.com/tx/"
        : "https://testnet.monadexplorer.com/tx/";
      return base + hash;
    }

    async function rejectRequest() {
      try {
        await fetch(\`\${__DATA__.publicBaseUrl}/api/stored-requests/\${R.id}/reject\`, { method: "POST" });
        showStatus("err", "Rejected. You can close this tab.");
      } catch (err) {
        showStatus("err", "Failed to record rejection: " + (err && err.message || err));
      }
    }

    // ---- Server-submit path (grant activations): server signs, no wallet UI ----
    function renderServerMode() {
      actionEl.innerHTML =
        '<div class="row"><button id="reject">Reject</button>' +
        '<button id="approve" class="primary">Approve &amp; sign</button></div>';
      const approveBtn = document.getElementById("approve");
      const rejectBtn = document.getElementById("reject");
      approveBtn.addEventListener("click", async () => {
        approveBtn.disabled = true; rejectBtn.disabled = true;
        showStatus("ok", "Submitting…");
        try {
          const headers = { "Content-Type": "application/json" };
          if (__DATA__.approvalToken) headers["X-Approval-Token"] = __DATA__.approvalToken;
          const res = await fetch(\`\${__DATA__.publicBaseUrl}/api/stored-requests/\${R.id}/submit\`, {
            method: "POST", credentials: "include", headers,
          });
          if (!res.ok) throw new Error((await res.text()) || res.statusText);
          const data = await res.json();
          showStatus("ok", "Approved." + (data.tx_hash ? " tx: " + data.tx_hash : ""));
        } catch (err) {
          showStatus("err", "Failed: " + (err && err.message || err));
          approveBtn.disabled = false; rejectBtn.disabled = false;
        }
      });
      rejectBtn.addEventListener("click", () => { approveBtn.disabled = true; rejectBtn.disabled = true; rejectRequest(); });
    }

    // ---- Client-sign path (default): user's own wallet signs in-browser ----
    async function renderClientMode() {
      let React, createRoot, PrivyProvider, usePrivy, useWallets;
      try {
        const deps = "react@18.3.1,react-dom@18.3.1";
        React = (await import("https://esm.sh/react@18.3.1")).default;
        createRoot = (await import("https://esm.sh/react-dom@18.3.1/client")).createRoot;
        const privy = await import("https://esm.sh/@privy-io/react-auth@" + __DATA__.privySdkVersion + "?deps=" + deps + "&bundle-deps");
        PrivyProvider = privy.PrivyProvider;
        usePrivy = privy.usePrivy;
        useWallets = privy.useWallets;
      } catch (e) {
        showStatus("err", "Couldn't load the signing library. Check your connection and retry. <code>" + (e && e.message || e) + "</code>");
        throw e;
      }
      const h = React.createElement;

      const monadChain = {
        id: __DATA__.chainId,
        name: __DATA__.chainId === 143 ? "Monad" : "Monad Testnet",
        network: __DATA__.chainId === 143 ? "monad" : "monad-testnet",
        nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [__DATA__.rpcUrl] }, public: { http: [__DATA__.rpcUrl] } },
      };

      function toHexValue(decStr) {
        return "0x" + BigInt(decStr || "0").toString(16);
      }

      async function confirmHash(hash, getAccessToken) {
        const headers = { "Content-Type": "application/json" };
        try { const t = await getAccessToken(); if (t) headers["Authorization"] = "Bearer " + t; } catch (_) {}
        if (__DATA__.approvalToken) headers["X-Approval-Token"] = __DATA__.approvalToken;
        const res = await fetch(\`\${__DATA__.publicBaseUrl}/api/stored-requests/\${R.id}/confirm\`, {
          method: "POST", credentials: "include", headers, body: JSON.stringify({ tx_hash: hash }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || ("HTTP " + res.status));
        }
        return res.json();
      }

      function Flow() {
        const { ready, authenticated, login, getAccessToken } = usePrivy();
        const { wallets } = useWallets();
        const [busy, setBusy] = React.useState(false);

        const matched = (wallets || []).find(
          (w) => w.address && w.address.toLowerCase() === R.walletAddress.toLowerCase(),
        );

        async function onApprove() {
          setBusy(true);
          try {
            if (!matched) throw new Error("none-matched");
            showStatus("ok", "Confirm the transaction in your wallet…");
            await matched.switchChain(__DATA__.chainId);
            const provider = await matched.getEthereumProvider();
            const hash = await provider.request({
              method: "eth_sendTransaction",
              params: [{ from: matched.address, to: R.call.to, value: toHexValue(R.call.value), data: R.call.data || "0x" }],
            });
            showStatus("ok", "Broadcast. Recording…");
            const data = await confirmHash(hash, getAccessToken);
            const tx = data.tx_hash || hash;
            showStatus("ok", 'Sent ✓ <a href="' + explorerTx(tx) + '" target="_blank" rel="noopener">View on explorer</a><br><code>' + tx + "</code>");
          } catch (err) {
            const m = err && err.message || String(err);
            showStatus("err", m === "none-matched" ? "Loaded wallet doesn't match the From address — sign in with the account that owns " + R.walletAddress + "." : "Failed: " + m);
            setBusy(false);
          }
        }

        if (!ready) return h("div", { className: "spinner" });
        if (!authenticated) {
          return h("div", { className: "row" },
            h("button", { className: "primary", onClick: () => login() }, "Sign in to approve"),
          );
        }
        if (wallets && wallets.length > 0 && !matched && !busy) {
          showStatus("warn", "Signed in as " + (wallets[0].address || "another wallet") + ", but this request is for " + R.walletAddress + ".");
        }
        return h("div", { className: "row" },
          h("button", { onClick: () => rejectRequest(), disabled: busy }, "Reject"),
          h("button", { className: "primary", onClick: onApprove, disabled: busy || !matched }, busy ? "Working…" : "Approve & sign"),
        );
      }

      createRoot(actionEl).render(
        h(PrivyProvider, {
          appId: __DATA__.privyAppId,
          config: {
            embeddedWallets: { createOnLogin: "users-without-wallets" },
            supportedChains: [monadChain],
            defaultChain: monadChain,
          },
        }, h(Flow)),
      );
    }

    if (__DATA__.signingMode === "server") {
      renderServerMode();
    } else {
      renderClientMode().catch((e) => { /* surfaced in status */ console.error(e); });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}
