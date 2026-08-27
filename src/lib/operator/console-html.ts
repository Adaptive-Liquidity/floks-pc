/** Live Node Console HTML. No secrets. Served only through handleOperatorHttp. */

export function operatorConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Bot Computers — Live Node Console</title>
  <style>
    :root {
      --ink: #23190f;
      --paper: #f2e6d0;
      --panel: #faeeda;
      --rule: #c9b496;
      --amber: #b5471b;
      --steel: #3e4a52;
      --ok: #215c3a;
      --sleep: #7a5a16;
      --danger: #8f1d1d;
      --muted: #6a5b4a;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: "Source Serif 4", "Iowan Old Style", Palatino, "Palatino Linotype", serif;
      background: var(--paper);
      color: var(--ink);
      letter-spacing: 0.01em;
    }
    .desk {
      height: 100%;
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(240px, 320px);
      grid-template-rows: auto 1fr 210px;
      gap: 1px;
      background: var(--rule);
    }
    header {
      grid-column: 1 / -1;
      background: var(--ink);
      color: var(--paper);
      padding: 14px 22px 12px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
    }
    header h1 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 600;
    }
    header p { margin: 0; color: #e2d2b6; font-size: 0.92rem; }
    nav, main, aside, .log {
      background: var(--panel);
      padding: 16px 18px;
      overflow: auto;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 0.72rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--amber);
    }
    .bot {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-bottom: 1px solid var(--rule);
      background: transparent;
      color: inherit;
      padding: 10px 8px;
      cursor: pointer;
      font: inherit;
    }
    .bot[aria-current="true"] {
      border: 1px solid var(--ink);
      background: #fff6e8;
    }
    .bot b { display: block; font-size: 1rem; }
    .bot span { color: var(--muted); font-size: 0.88rem; }
    .hero { margin-bottom: 14px; }
    .hero h3 { margin: 0 0 6px; font-size: 1.5rem; }
    .hero p { margin: 0; color: var(--steel); }
    .screen {
      min-height: 180px;
      border: 2px solid var(--ink);
      background: #1b1712;
      color: #f3e6cf;
      padding: 14px;
      margin: 12px 0;
    }
    .screen img { max-width: 100%; height: auto; display: block; }
    .empty { color: #cbb99a; }
    dl { display: grid; grid-template-columns: 8.5rem 1fr; gap: 6px 10px; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; font-weight: 600; }
    .warn {
      border-left: 3px solid var(--amber);
      padding: 6px 10px;
      margin: 8px 0;
      color: var(--steel);
    }
    button.act, button.stop {
      font: inherit;
      padding: 8px 12px;
      border: 1px solid var(--ink);
      background: var(--ink);
      color: var(--paper);
      cursor: pointer;
    }
    button.stop { background: var(--danger); border-color: var(--danger); }
    label { display: block; margin: 8px 0; font-size: 0.92rem; }
    input[type="text"] {
      width: 100%;
      font: inherit;
      padding: 6px 8px;
      border: 1px solid var(--rule);
      background: #fffaf0;
    }
    .log ol { margin: 0; padding-left: 1.2rem; }
    .log li { margin: 4px 0; }
    .ok { color: var(--ok); }
    .bad { color: var(--danger); }
    .sleep { color: var(--sleep); }
    .auth {
      display: none;
      grid-column: 1 / -1;
      padding: 24px;
      background: var(--panel);
    }
    .auth.visible { display: block; }
  </style>
</head>
<body>
  <div class="desk" id="desk">
    <header>
      <h1>Bot Computers / Live Node Console</h1>
      <p>This bot has this computer. Watch it. Stop only this one.</p>
    </header>
    <div class="auth" id="auth-gate">
      <h2>Loopback only</h2>
      <p>This console is not reachable through a Grok MCP tunnel. Open it on 127.0.0.1. The Bot wrapper token is not operator auth.</p>
    </div>
    <nav aria-label="Bot Computers" id="bots">
      <h2>Bots</h2>
      <p id="bot-empty">No Agent Computers yet. Pair a bot, then it appears here.</p>
    </nav>
    <main id="main">
      <h2>This computer</h2>
      <div class="hero">
        <h3 id="headline">This bot has this computer</h3>
        <p id="subhead">Select a bot on the left.</p>
      </div>
      <h2>What it sees</h2>
      <div class="screen" id="screen"><p class="empty">No live observe yet.</p></div>
      <button class="act" id="observe" type="button">Refresh what it sees</button>
      <h2>Workspace</h2>
      <dl>
        <dt>Files / terminal</dt>
        <dd id="workspace-summary">No file or exec events yet.</dd>
        <dt>Workspace root</dt>
        <dd id="workspace-root">—</dd>
      </dl>
    </main>
    <aside aria-label="Permissions and stop">
      <h2>Permissions</h2>
      <dl>
        <dt>Provider</dt><dd id="provider">—</dd>
        <dt>Pair status</dt><dd id="pair">—</dd>
        <dt>Lifecycle</dt><dd id="life">—</dd>
        <dt>Scopes</dt><dd id="scopes">—</dd>
        <dt>Session expiry</dt><dd id="expiry">—</dd>
        <dt>Cost</dt><dd id="cost">Not metered yet (L7).</dd>
        <dt>Provider ref</dt><dd id="pref">—</dd>
      </dl>
      <div id="warnings"></div>
      <h2>Stop this computer</h2>
      <p>click_element stays fail-closed. Destroys only the selected Agent Computer. Paste the captured providerRef. Not an MCP tool.</p>
      <label>Captured providerRef <input id="destroy-ref" type="text" autocomplete="off"/></label>
      <label><input id="destroy-confirm" type="checkbox"/> I am stopping only this computer</label>
      <button class="stop" id="destroy" type="button">Stop this computer</button>
      <p id="destroy-msg" class="warn" hidden></p>
    </aside>
    <section class="log" aria-label="Event log" id="log">
      <h2>Event log</h2>
      <ol id="events"></ol>
    </section>
  </div>
  <script>
    const API = "/operator/v1";
    let selected = null;
    let lastObserve = null;
    function textEl(tag, text) {
      const n = document.createElement(tag);
      n.textContent = text;
      return n;
    }
    function isPngBase64(s) {
      return typeof s === "string" && s.length > 32 && s.length < 2000000 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
    }
    async function api(path, opts) {
      const o = opts ? Object.assign({}, opts) : {};
      const res = await fetch(API + path, o);
      if (res.status === 401 || res.status === 403) {
        document.getElementById("auth-gate").classList.add("visible");
        throw new Error("unauthorized");
      }
      return res;
    }
    function pick(id, snap) {
      if (selected !== id) lastObserve = null;
      selected = id;
      render(snap);
    }
    function render(snap) {
      const bots = document.getElementById("bots");
      bots.replaceChildren(textEl("h2", "Bots"));
      if (!snap.computers.length) {
        bots.appendChild(textEl("p", "No Agent Computers yet. Pair a bot, then it appears here."));
      }
      for (const c of snap.computers) {
        const b = document.createElement("button");
        b.className = "bot";
        b.type = "button";
        if (c.id === selected) b.setAttribute("aria-current", "true");
        const title = document.createElement("b");
        title.textContent = String(c.birdId);
        const meta = document.createElement("span");
        meta.textContent = String(c.pairStatus) + " · " + String(c.lifecycleLabel);
        b.append(title, meta);
        b.addEventListener("click", () => pick(c.id, snap));
        bots.appendChild(b);
      }
      const cur = snap.computers.find((c) => c.id === selected) || snap.computers[0];
      if (cur && selected !== cur.id) selected = cur.id;
      document.getElementById("cost").textContent =
        snap.beta && snap.beta.enabled
          ? snap.beta.costWarning
          : cur && cur.cost
            ? cur.cost.note
            : "Not metered yet (L7).";
      const sub = document.getElementById("subhead");
      const screen = document.getElementById("screen");
      if (!cur) {
        sub.textContent = "Select a bot on the left.";
        return;
      }
      document.getElementById("headline").textContent = cur.headline;
      sub.textContent = cur.birdId + " → " + cur.lifecycleLabel + " (" + cur.provider + ")";
      document.getElementById("provider").textContent = cur.provider;
      document.getElementById("pair").textContent = cur.pairStatus;
      document.getElementById("life").textContent = cur.lifecycleLabel;
      document.getElementById("scopes").textContent = cur.scopes.join(", ") || "none";
      document.getElementById("expiry").textContent = cur.capabilityExpiresAt || "no capability";
      document.getElementById("pref").textContent = cur.providerRef || "none";
      document.getElementById("workspace-root").textContent = cur.workspaceRoot;
      const warns = document.getElementById("warnings");
      warns.replaceChildren();
      for (const w of cur.warnings) {
        const p = document.createElement("p");
        p.className = "warn";
        p.textContent = w;
        warns.appendChild(p);
      }
      const fileEv = snap.events.filter((e) => e.computerId === cur.id && (e.kind === "file" || e.kind === "exec"));
      document.getElementById("workspace-summary").textContent = fileEv.length
        ? fileEv.slice(-3).map((e) => e.operation + (e.success ? "" : " failed")).join(" · ")
        : "No file or exec events yet.";
      screen.replaceChildren();
      if (lastObserve && lastObserve.computerId === cur.id) {
        const ax = lastObserve.accessibility;
        let line = String(lastObserve.screenWidth) + "×" + String(lastObserve.screenHeight);
        if (lastObserve.activeWindow) line += " · " + String(lastObserve.activeWindow);
        screen.appendChild(textEl("p", line));
        let axLine = "CDP/accessibility: " + String(ax.source) + ", " + String(ax.nodeCount) + " nodes";
        if (ax.rootRole) axLine += " · " + String(ax.rootRole);
        if (ax.rootName) axLine += " / " + String(ax.rootName);
        screen.appendChild(textEl("p", axLine));
        if (lastObserve.hasScreenshot && isPngBase64(lastObserve.screenshotBase64)) {
          const img = document.createElement("img");
          img.alt = "Observe preview";
          img.src = "data:image/png;base64," + lastObserve.screenshotBase64;
          screen.appendChild(img);
        } else {
          const empty = textEl("p", "No screenshot (pixels are not persisted; this provider may not return them).");
          empty.className = "empty";
          screen.appendChild(empty);
        }
      } else {
        const empty = textEl("p", "No live observe yet.");
        empty.className = "empty";
        screen.appendChild(empty);
      }
      const ol = document.getElementById("events");
      ol.replaceChildren();
      for (const e of snap.events.slice().reverse()) {
        const li = document.createElement("li");
        li.className = e.success ? "ok" : "bad";
        li.textContent = e.at + " · " + e.kind + " · " + e.operation + (e.errorCode ? " · " + e.errorCode : "");
        ol.appendChild(li);
      }
    }
    async function refresh() {
      const res = await api("/snapshot");
      const snap = await res.json();
      render(snap);
      return snap;
    }
    document.getElementById("observe").addEventListener("click", async () => {
      if (!selected) return;
      const res = await api("/computers/" + selected + "/observe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      lastObserve = Object.assign({ computerId: selected }, body.observation);
      await refresh();
    });
    document.getElementById("destroy").addEventListener("click", async () => {
      const msg = document.getElementById("destroy-msg");
      msg.hidden = false;
      if (!selected) { msg.textContent = "Select a computer first."; return; }
      if (!document.getElementById("destroy-confirm").checked) {
        msg.textContent = "Check the confirm box. This stops only the selected computer.";
        return;
      }
      const providerRef = document.getElementById("destroy-ref").value.trim();
      const res = await api("/computers/" + selected + "/destroy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, providerRef }),
      });
      const body = await res.json();
      if (!res.ok) {
        msg.textContent = (body.error && body.error.message) || "Destroy refused.";
        return;
      }
      msg.textContent = "This computer is deleted.";
      lastObserve = null;
      await refresh();
    });
    refresh().catch(() => {
      document.getElementById("auth-gate").classList.add("visible");
    });
    setInterval(() => { refresh().catch(() => {}); }, 4000);
  </script>
</body>
</html>
`;
}
