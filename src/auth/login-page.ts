/**
 * Server-rendered OAuth login page. This is the browser step of the
 * authorization-code flow: the MCP client (Claude / ChatGPT) sends the user
 * here, they log in with Privy (email / Google / wallet), and we exchange the
 * resulting Privy access token for a one-shot authorization code, then bounce
 * back to the client's redirect_uri.
 *
 * No build step: React + Privy's React SDK are pulled as browser-native ESM
 * from esm.sh, and the UI is written with React.createElement (no JSX, so no
 * in-browser transpiler). The page never sees the client secret; the only
 * thing it produces is a short-lived Privy access token, POSTed to
 * /authorize/consent over same-origin fetch.
 *
 * ⚠️ Requires the Privy app to allow this server's origin (publicBaseUrl) under
 * dashboard → Settings → "Allowed origins", or the embedded login will refuse
 * to initialise.
 */
export interface LoginPageParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  scope?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource?: string;
}

export function renderLoginPage(opts: {
  privyAppId: string;
  publicBaseUrl: string;
  params: LoginPageParams;
  /** Pin a known-good Privy SDK major to insulate from breaking releases. */
  privySdkVersion?: string;
}): string {
  const { privyAppId, publicBaseUrl, params, privySdkVersion = "2" } = opts;
  const data = JSON.stringify({ privyAppId, publicBaseUrl, params });

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sign in · monad-mcp</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; --bg:#0a0a0a; --fg:#fafafa; --muted:#888; --card:#161616; --border:#262626; --pri:#7a5cff; --danger:#ff4d4d; --ok:#3acf86; }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; max-width: 420px; width: 100%; text-align: center; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { color: var(--muted); margin: 0 0 24px; font-size: 13px; line-height: 1.5; }
    .spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--pri); border-radius: 50%; margin: 8px auto 0; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .err { background: rgba(255,77,77,0.1); border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 12px; font-size: 13px; margin-top: 16px; text-align: left; word-break: break-word; }
    .ok { color: var(--ok); }
    button { margin-top: 16px; padding: 12px 20px; border-radius: 10px; border: 1px solid var(--pri); background: var(--pri); color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--fg); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to Monad</h1>
    <p>Sign in to give your AI assistant access to your Monad wallet. You'll approve every transaction individually — the agent can never move funds on its own.</p>
    <div id="root"><div class="spinner"></div></div>
  </div>

  <script type="module">
    const D = ${data};
    const root = document.getElementById("root");
    const show = (html) => { root.innerHTML = html; };
    const showErr = (msg) => show('<div class="err">' + msg + '</div><button onclick="location.reload()">Try again</button>');

    let React, createRoot, PrivyProvider, usePrivy;
    try {
      const v = ${JSON.stringify(privySdkVersion)};
      const deps = "react@18.3.1,react-dom@18.3.1";
      React = (await import("https://esm.sh/react@18.3.1")).default;
      createRoot = (await import("https://esm.sh/react-dom@18.3.1/client")).createRoot;
      const privy = await import("https://esm.sh/@privy-io/react-auth@" + v + "?deps=" + deps + "&bundle-deps");
      PrivyProvider = privy.PrivyProvider;
      usePrivy = privy.usePrivy;
    } catch (e) {
      showErr("Couldn't load the sign-in library. Check your connection and retry.<br><code>" + (e && e.message || e) + "</code>");
      throw e;
    }

    const h = React.createElement;

    async function completeConsent(getAccessToken) {
      try {
        show('<div class="spinner"></div><p class="ok" style="margin-top:12px">Finishing sign-in…</p>');
        const token = await getAccessToken();
        if (!token) throw new Error("No access token returned by Privy.");
        const res = await fetch(D.publicBaseUrl + "/authorize/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, params: D.params }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.redirect) {
          throw new Error(body.error_description || body.error || ("HTTP " + res.status));
        }
        window.location.replace(body.redirect);
      } catch (e) {
        showErr("Sign-in failed: " + (e && e.message || e));
      }
    }

    function Flow() {
      const { ready, authenticated, login, getAccessToken } = usePrivy();
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (!ready) return;
        if (authenticated) {
          if (!startedRef.current) { startedRef.current = true; completeConsent(getAccessToken); }
        } else {
          login();
        }
      }, [ready, authenticated]);
      if (!ready) return h("div", { className: "spinner" });
      if (authenticated) return h("div", { className: "spinner" });
      return h("button", { onClick: () => login() }, "Sign in");
    }

    createRoot(root).render(
      h(PrivyProvider, {
        appId: D.privyAppId,
        config: { embeddedWallets: { createOnLogin: "users-without-wallets" } },
      }, h(Flow))
    );
  </script>
</body>
</html>`;
}
