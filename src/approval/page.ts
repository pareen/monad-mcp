import type { StoredRequest } from "../store/types.js";

/**
 * Server-rendered approval page. Loads Privy's web SDK from CDN, prompts the
 * user to authenticate if needed, displays the pending transaction, and
 * (on click) signs+sends via the user's embedded wallet, then notifies the
 * server. No build step required.
 */
export function renderApprovalPage(opts: {
  request: StoredRequest;
  privyAppId: string;
  chainId: number;
  publicBaseUrl: string;
  rpcUrl: string;
  approvalToken?: string;
}): string {
  const { request, privyAppId, chainId, publicBaseUrl, rpcUrl, approvalToken } = opts;
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
  });

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Approve transaction · monad-mcp</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; --bg:#0a0a0a; --fg:#fafafa; --muted:#888; --card:#161616; --border:#262626; --pri:#7a5cff; --pri-fg:#fff; --danger:#ff4d4d; --ok:#3acf86; }
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
    .change { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .change:last-child { border-bottom: none; }
    .delta-neg { color: var(--danger); }
    .delta-pos { color: var(--ok); }
    a { color: var(--pri); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Approve transaction</h1>
    <p class="subtitle">monad-mcp · ${request.network}</p>
    <div class="summary">${escapeHtml(request.summary)}</div>
    <div id="changes"></div>
    <dl>
      <dt>From</dt><dd>${request.walletAddress}</dd>
      <dt>To</dt><dd>${request.call.to}</dd>
      <dt>Value</dt><dd>${request.call.value} wei</dd>
      <dt>Data</dt><dd style="max-height:80px;overflow:auto">${request.call.data}</dd>
      <dt>Expires</dt><dd id="expires"></dd>
    </dl>
    <div class="row">
      <button id="reject">Reject</button>
      <button id="approve" class="primary">Approve &amp; sign</button>
    </div>
    <div id="status" class="status"></div>
  </div>

  <script type="module">
    const __DATA__ = ${payload};
    const expiresEl = document.getElementById("expires");
    const statusEl = document.getElementById("status");
    const approveBtn = document.getElementById("approve");
    const rejectBtn = document.getElementById("reject");
    const changesEl = document.getElementById("changes");

    expiresEl.textContent = new Date(__DATA__.request.expiresAt).toLocaleString();

    const changes = (__DATA__.request.simulation && __DATA__.request.simulation.assetChanges) || [];
    changesEl.innerHTML = changes.map(c => {
      const sign = c.delta && c.delta.startsWith("-") ? "neg" : "pos";
      const sym = c.symbol || (c.kind === "native" ? "MON" : "TOKEN");
      const dec = c.decimals ?? 18;
      const raw = (c.delta || "0").replace("+", "").replace("-", "");
      const val = (Number(BigInt(raw)) / 10**dec).toFixed(6);
      return \`<div class="change"><span>\${sym}</span><span class="delta-\${sign}">\${c.delta && c.delta.startsWith("-") ? "-" : "+"}\${val}</span></div>\`;
    }).join("");

    function showStatus(kind, msg) {
      statusEl.textContent = msg;
      statusEl.className = "status show " + kind;
    }

    approveBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      showStatus("ok", "Submitting via Privy…");
      try {
        const headers = { "Content-Type": "application/json" };
        if (__DATA__.approvalToken) headers["X-Approval-Token"] = __DATA__.approvalToken;
        const res = await fetch(\`\${__DATA__.publicBaseUrl}/api/stored-requests/\${__DATA__.request.id}/submit\`, {
          method: "POST",
          credentials: "include",
          headers,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || res.statusText);
        }
        const data = await res.json();
        showStatus("ok", \`Approved. tx_hash: \${data.tx_hash}\`);
      } catch (err) {
        showStatus("err", "Failed: " + (err.message || err));
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
      }
    });

    rejectBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      try {
        await fetch(\`\${__DATA__.publicBaseUrl}/api/stored-requests/\${__DATA__.request.id}/reject\`, { method: "POST" });
        showStatus("err", "Rejected. You can close this tab.");
      } catch (err) {
        showStatus("err", "Failed to record rejection: " + (err.message || err));
      }
    });
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
