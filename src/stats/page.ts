export interface StatsPageOptions {
  /** Canonical origin, used for og/canonical tags. */
  publicBaseUrl?: string;
  /** Link back to the marketing/landing site. */
  siteUrl?: string;
  /** Source repository link. */
  repoUrl?: string;
}

const DEFAULT_REPO = "https://github.com/pareen/monad-mcp";

/**
 * Self-contained HTML for GET /stats. No external assets or libraries — inline
 * CSS (matching the landing-site palette) and vanilla JS that fetches
 * /stats.json and draws inline-SVG charts. Ships compiled in dist, so it does
 * not depend on the static site/ folder being present in the runtime image.
 *
 * NOTE: keep the client script free of backtick template literals — this whole
 * document is a TS template literal, so `${...}` inside it would interpolate at
 * build time. Use string concatenation in the browser code instead.
 */
export function renderStatsPage(options: StatsPageOptions = {}): string {
  const repoUrl = options.repoUrl ?? DEFAULT_REPO;
  const siteUrl = options.siteUrl ?? repoUrl;
  const canonical = options.publicBaseUrl ? `${options.publicBaseUrl}/stats` : "";
  const canonicalTag = canonical ? `<link rel="canonical" href="${canonical}" />` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>monad-mcp — usage stats</title>
<meta name="description" content="Live aggregate usage for the monad-mcp server: tool calls, read/write split, networks, and daily activity. Privacy-safe — counts only, no identities or arguments." />
<meta name="robots" content="index,follow" />
${canonicalTag}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23836ef9'/%3E%3C/svg%3E" />
<style>
  :root{
    --bg:#07070a; --panel:#111118; --panel2:#16161f; --border:#24242f; --border2:#2f2f3d;
    --fg:#f5f5fa; --muted:#9a9ab0; --faint:#6b6b80; --accent:#836ef9; --accent2:#a78bfa;
    --accent-soft:rgba(131,110,249,.14); --ok:#3acf86; --warn:#ffb454; --danger:#ff5c5c;
    --mono:ui-monospace,SFMono-Regular,Menlo,"Cascadia Code",monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;
  }
  *{box-sizing:border-box}
  body{
    margin:0;background:radial-gradient(1200px 600px at 50% -200px,#1a1430 0%,var(--bg) 60%);
    background-attachment:fixed;color:var(--fg);font-family:var(--sans);
    -webkit-font-smoothing:antialiased;line-height:1.5;
  }
  a{color:var(--accent2);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:960px;margin:0 auto;padding:0 20px}
  header.site{border-bottom:1px solid var(--border);position:sticky;top:0;
    background:rgba(7,7,10,.72);backdrop-filter:blur(10px);z-index:5}
  header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:58px}
  .logo{font-weight:700;display:flex;align-items:center;gap:9px;color:var(--fg)}
  .logo:hover{text-decoration:none}
  .dot{width:11px;height:11px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 0 4px var(--accent-soft)}
  .tag{font-size:11px;font-weight:600;color:var(--accent2);border:1px solid var(--border2);
    border-radius:6px;padding:2px 7px;letter-spacing:.04em}
  nav a{margin-left:18px;color:var(--muted);font-size:14px}
  .hero{padding:46px 0 8px}
  .eyebrow{color:var(--accent2);font-weight:600;font-size:13px;letter-spacing:.08em;
    text-transform:uppercase;margin:0 0 8px}
  h1{font-size:34px;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0;max-width:620px}
  .live{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);
    box-shadow:0 0 0 4px rgba(58,207,134,.18);margin-right:7px;vertical-align:middle}
  .grid{display:grid;gap:14px;margin:22px 0}
  .cols-4{grid-template-columns:repeat(4,1fr)}
  .cols-2{grid-template-columns:repeat(2,1fr)}
  .card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);
    border-radius:14px;padding:18px}
  .card h3{margin:0 0 14px;font-size:13px;color:var(--muted);font-weight:600;
    letter-spacing:.03em;text-transform:uppercase}
  .stat .n{font-size:30px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .stat .l{color:var(--muted);font-size:13px;margin-top:2px}
  .split{display:flex;height:12px;border-radius:7px;overflow:hidden;background:var(--panel2);
    border:1px solid var(--border);margin:4px 0 12px}
  .split>span{display:block;height:100%}
  .legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
  .legend b{color:var(--fg);font-variant-numeric:tabular-nums}
  .sw{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:9px 8px;font-size:14px;border-bottom:1px solid var(--border)}
  th{color:var(--faint);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tr:last-child td{border-bottom:none}
  .pill{font-size:11px;border:1px solid var(--border2);border-radius:5px;padding:1px 6px;color:var(--muted)}
  .pill.write{color:var(--warn);border-color:rgba(255,180,84,.4)}
  .bar{height:7px;border-radius:4px;background:var(--accent);display:inline-block;vertical-align:middle;min-width:2px}
  .controls{display:flex;gap:8px;align-items:center;margin:6px 0 0}
  .controls button{background:var(--panel2);border:1px solid var(--border2);color:var(--muted);
    border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit}
  .controls button.on{color:var(--fg);border-color:var(--accent);background:var(--accent-soft)}
  .muted{color:var(--muted)} .faint{color:var(--faint)}
  .chart{width:100%;height:auto;display:block}
  .chart rect.b{fill:var(--accent)}
  .chart rect.b:hover{fill:var(--accent2)}
  footer{border-top:1px solid var(--border);margin-top:34px;padding:22px 0 50px;color:var(--faint);font-size:13px}
  .err{color:var(--danger)}
  @media(max-width:720px){.cols-4{grid-template-columns:repeat(2,1fr)}.cols-2{grid-template-columns:1fr}h1{font-size:27px}}
</style>
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="logo" href="${siteUrl}"><span class="dot"></span> monad-mcp <span class="tag">STATS</span></a>
    <nav>
      <a href="${siteUrl}">Home</a>
      <a href="/health">Health</a>
      <a href="${repoUrl}">GitHub &#8599;</a>
    </nav>
  </div>
</header>

<div class="wrap">
  <div class="hero">
    <p class="eyebrow">Live usage</p>
    <h1><span class="live"></span>monad-mcp usage</h1>
    <p class="sub">Aggregate tool calls served by the hosted monad-mcp server. Counts only — no wallet addresses, identities, arguments, or amounts are recorded.</p>
  </div>

  <div id="root" aria-live="polite">
    <p class="muted" id="loading">Loading stats&hellip;</p>
  </div>

  <footer>
    <div id="updated" class="faint"></div>
    <div>Privacy-safe aggregate counters. Source: <a href="${repoUrl}">${repoUrl.replace("https://", "")}</a>.</div>
  </footer>
</div>

<script>
(function(){
  "use strict";
  var ACCENT="#836ef9", ACCENT2="#a78bfa", OK="#3acf86", WARN="#ffb454", FAINT="#6b6b80";
  var root=document.getElementById("root");
  var days=30;

  function fmt(n){ return (n==null?0:n).toLocaleString("en-US"); }
  function pct(x){ return (x*100).toFixed(x>=0.999||x<=0.001?0:1)+"%"; }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }
  function el(html){ var d=document.createElement("div"); d.innerHTML=html; return d.firstElementChild; }

  function splitBar(parts){
    // parts: [{value,color,label}]
    var total=parts.reduce(function(s,p){return s+p.value;},0)||1;
    var bar='<div class="split">';
    parts.forEach(function(p){
      var w=(p.value/total*100);
      bar+='<span style="width:'+w+'%;background:'+p.color+'"></span>';
    });
    bar+='</div><div class="legend">';
    parts.forEach(function(p){
      bar+='<span><span class="sw" style="background:'+p.color+'"></span>'+esc(p.label)+' <b>'+fmt(p.value)+'</b></span>';
    });
    bar+='</div>';
    return bar;
  }

  function chart(daily){
    var W=920, H=170, pad=4;
    var max=daily.reduce(function(m,d){return Math.max(m,d.calls);},0)||1;
    var n=daily.length;
    var bw=(W-(n-1)*pad)/n;
    var svg='<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Daily tool calls">';
    for(var i=0;i<n;i++){
      var d=daily[i];
      var h=Math.max(2, Math.round(d.calls/max*(H-22)));
      var x=i*(bw+pad);
      var y=H-h;
      var t=d.day+": "+fmt(d.calls)+" calls";
      svg+='<rect class="b" x="'+x.toFixed(1)+'" y="'+y+'" width="'+bw.toFixed(1)+'" height="'+h+'" rx="2"><title>'+esc(t)+'</title></rect>';
    }
    svg+='</svg>';
    // sparse x labels: first, middle, last
    var lbls='<div class="legend faint" style="justify-content:space-between;margin-top:6px">';
    lbls+='<span>'+esc(daily[0]?daily[0].day:"")+'</span>';
    lbls+='<span>'+esc(daily[n-1]?daily[n-1].day:"")+'</span>';
    lbls+='</div>';
    return svg+lbls;
  }

  function toolTable(byTool){
    var max=byTool.reduce(function(m,t){return Math.max(m,t.calls);},0)||1;
    var rows=byTool.slice(0,20).map(function(t){
      var w=Math.round(t.calls/max*120);
      var kindPill='<span class="pill '+(t.kind==="write"?"write":"")+'">'+t.kind+'</span>';
      var rate=t.calls>0?pct(t.ok/t.calls):"—";
      return '<tr><td>'+esc(t.tool)+' '+kindPill+'</td>'+
             '<td><span class="bar" style="width:'+w+'px"></span></td>'+
             '<td class="num">'+fmt(t.calls)+'</td>'+
             '<td class="num muted">'+rate+'</td></tr>';
    }).join("");
    if(!rows) rows='<tr><td colspan="4" class="muted">No calls recorded yet.</td></tr>';
    return '<table><thead><tr><th>Tool</th><th></th><th class="num">Calls</th><th class="num">Success</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }

  function render(s){
    var t=s.totals;
    var html="";
    // headline stats
    html+='<div class="grid cols-4">';
    html+='<div class="card stat"><div class="n">'+fmt(t.calls)+'</div><div class="l">total tool calls</div></div>';
    html+='<div class="card stat"><div class="n">'+pct(t.successRate)+'</div><div class="l">success rate</div></div>';
    html+='<div class="card stat"><div class="n">'+fmt(t.distinctTools)+'</div><div class="l">distinct tools used</div></div>';
    html+='<div class="card stat"><div class="n">'+fmt(t.writes)+'</div><div class="l">write actions</div></div>';
    html+='</div>';

    // daily chart
    html+='<div class="card"><h3>Daily activity &middot; last '+s.windowDays+' days</h3>';
    html+='<div class="controls" id="winctl">';
    [30,90,365].forEach(function(d){
      html+='<button data-d="'+d+'"'+(d===days?' class="on"':'')+'>'+d+'d</button>';
    });
    html+='</div><div style="margin-top:14px">'+chart(s.daily)+'</div></div>';

    // splits
    html+='<div class="grid cols-2">';
    html+='<div class="card"><h3>Reads vs writes</h3>'+splitBar([
      {value:t.reads,color:ACCENT,label:"reads"},
      {value:t.writes,color:WARN,label:"writes"}
    ])+'</div>';
    html+='<div class="card"><h3>Signed-in vs anonymous</h3>'+splitBar([
      {value:t.authed,color:ACCENT2,label:"signed in"},
      {value:t.anonymous,color:FAINT,label:"anonymous"}
    ])+'</div>';
    html+='<div class="card"><h3>Network</h3>'+splitBar([
      {value:t.mainnet,color:OK,label:"mainnet"},
      {value:t.testnet,color:ACCENT,label:"testnet"}
    ])+'</div>';
    html+='<div class="card"><h3>Outcomes</h3>'+splitBar([
      {value:t.ok,color:OK,label:"ok"},
      {value:t.errors,color:"#ff5c5c",label:"errors"}
    ])+'</div>';
    html+='</div>';

    // tools
    html+='<div class="card"><h3>Most used tools</h3>'+toolTable(s.byTool)+'</div>';

    root.innerHTML=html;

    var ctl=document.getElementById("winctl");
    if(ctl){ ctl.addEventListener("click",function(e){
      var b=e.target.closest("button"); if(!b) return;
      days=parseInt(b.getAttribute("data-d"),10); load();
    }); }

    var upd=document.getElementById("updated");
    if(upd){
      var span=t.firstDay?("since "+t.firstDay+" \\u00b7 "):"";
      upd.textContent="Updated "+new Date(s.generatedAt).toUTCString()+" \\u00b7 "+span+fmt(t.calls)+" calls all-time";
    }
  }

  function load(){
    fetch("/stats.json?days="+days,{headers:{accept:"application/json"}})
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(render)
      .catch(function(err){
        root.innerHTML='<p class="err">Could not load stats: '+esc(err.message)+'</p>';
      });
  }
  load();
})();
</script>
</body>
</html>`;
}
