"use strict";
/* ============================================================
   New composer powers: interaction modes, speeds, Agents View,
   GitHub / Local-folder / Remote-control chips. Loads after app2.js.
   ============================================================ */

/* ---- body.chatting toggle (orbs drop + title shows once a convo has content) ---- */
(function () {
  const t = document.querySelector("#transcript"); if (!t) return;
  const upd = () => document.body.classList.toggle("chatting", t.childElementCount > 0);
  new MutationObserver(upd).observe(t, { childList: true });
  upd();
})();

/* ---- generic liquid-glass popmenu helpers (open upward from the composer) ---- */
const POPS = ["#ghMenu", "#localMenu", "#modeMenu", "#speedMenu", "#effortMenu"];
function closePops(except) { POPS.forEach((s) => { const m = document.querySelector(s); if (m && m !== except) m.classList.add("hidden"); }); }
document.addEventListener("click", () => closePops());
function wireMenu(chipSel, menuSel, build) {
  const chip = document.querySelector(chipSel), menu = document.querySelector(menuSel);
  if (!chip || !menu) return;
  menu.addEventListener("click", (e) => e.stopPropagation());
  chip.onclick = (e) => { e.stopPropagation(); const wasOpen = !menu.classList.contains("hidden"); closePops(); if (wasOpen) { menu.classList.add("hidden"); return; } build(menu); menu.classList.remove("hidden"); };
}
function popItem(o, current, onPick) {
  const it = el("div", "popitem" + (o.id === current ? " sel" : ""));
  it.innerHTML = `<span class="pi-main"><span class="pi-t">${escapeHtml(o.title)}</span><span class="pi-d">${escapeHtml(o.desc || "")}</span></span>` + (o.id === current ? `<span class="pi-ck">●</span>` : "");
  it.onclick = () => { closePops(); onPick(o); };
  return it;
}

/* ---- interaction modes ---- */
const IMODES = [
  { id: "agent", label: "Agent Mode", title: "Agent Mode", desc: "Full autonomy — uses every tool to finish the whole job" },
  { id: "plan", label: "Plan Mode", title: "Plan Mode", desc: "Designs a sharp step-by-step plan, then waits for your go" },
  { id: "question", label: "Question", title: "Question", desc: "Conversational — answers & asks, won't act unprompted" },
  { id: "executor", label: "Executor", title: "Executor", desc: "Executes literally — no planning, no chatter" },
];
IMODES.splice(1, 0, { id: "infinite", label: "Infinite Agents", title: "Infinite Agents", desc: "Self-driving: keeps working autonomously for hours until the whole job is truly done" });
function setIMode(id) { settings.imode = id; const m = IMODES.find((x) => x.id === id) || IMODES[0]; const l = document.querySelector("#imodeLabel"); if (l) l.textContent = m.label; send({ type: "settings", imode: id }); }
wireMenu("#imodeChip", "#modeMenu", (menu) => {
  menu.innerHTML = `<div class="pmhead">Interaction mode</div>`;
  IMODES.forEach((o) => menu.appendChild(popItem(o, settings.imode, (x) => setIMode(x.id))));
});

/* ---- speeds (separate from effort: speed = how much it deliberates) ---- */
const SPEEDS = [
  { id: "instant", label: "Instant", title: "Instant", desc: "Snap answers, almost no deliberation" },
  { id: "extended", label: "Extended", title: "Extended", desc: "Balanced — takes a little time to be right" },
  { id: "thinking", label: "Thinking", title: "Thinking", desc: "Reasons hard through real complexity" },
  { id: "pro", label: "Pro", title: "Pro", desc: "Grinds through big multi-step jobs" },
];
function setSpeed(id) { settings.speed = id; const m = SPEEDS.find((x) => x.id === id) || SPEEDS[1]; const l = document.querySelector("#speedLabel"); if (l) l.textContent = m.label; send({ type: "settings", speed: id }); }
wireMenu("#speedChip", "#speedMenu", (menu) => {
  menu.innerHTML = `<div class="pmhead">Speed</div>`;
  SPEEDS.forEach((o) => menu.appendChild(popItem(o, settings.speed, (x) => setSpeed(x.id))));
});

/* ---- top sections nav (One / Imagine / Agent / Work / Code) ---- */
let _toastTimer;
function toast(msg) {
  const t = document.querySelector("#toast"); if (!t) return;
  t.textContent = msg; t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
(function () {
  const nav = document.querySelector("#topnav"); if (!nav) return;
  const COMING = { one: true };
  let cur = localStorage.getItem("juile.section") || "agent";
  if (COMING[cur]) cur = "agent";
  function paint() { nav.querySelectorAll(".navsec").forEach((b) => b.classList.toggle("sel", b.dataset.sec === cur)); }
  function pick(sec) {
    if (COMING[sec]) { toast("This feature is coming soon"); return; }
    cur = sec; localStorage.setItem("juile.section", sec);
    settings.section = sec; if (typeof send === "function") send({ type: "settings", section: sec });
    paint();
  }
  nav.querySelectorAll(".navsec").forEach((b) => (b.onclick = () => pick(b.dataset.sec)));
  settings.section = cur; paint();
})();

/* ---- left sidebar actions (New Conversation + coming-soon sections) ---- */
(function () {
  const SOON = { playground: "Playground is coming soon", workspaces: "Workspaces is coming soon", projects: "Projects is coming soon", automations: "Automations is coming soon", pulse: "Pulse is coming soon", rss: "RSS is coming soon" };
  document.querySelectorAll("#convPanel .sbAct").forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === "new") { if (window.Convos) { Convos.newConversation(); if (window.renderConvPanel) renderConvPanel(); } return; }
      if (typeof toast === "function") toast(SOON[a] || "Coming soon");
    };
  });
})();

/* ---- Agents View (left arrow): list agents/conversations, click to open, type to summon ---- */
let agentsOpen = false;
function agentStatus(c) {
  const running = window._running && window._running.has(c.id);
  if (running) return ["working", "This agent is currently operating."];
  const msgs = c.msgs || [];
  if (msgs.length && msgs[msgs.length - 1].role === "assistant") return ["done", "This agent finished its work."];
  if (msgs.length) return ["asking", "This agent is waiting on you."];
  return ["", "New agent — give it a task."];
}
const AGLYPH = { working: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="9" stroke-dasharray="42 14"/></svg>', done: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9"><path d="M5 12l4 4L19 6"/></svg>', asking: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', "": '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="9" stroke-dasharray="3 4"/></svg>' };
function renderAgents() {
  const box = document.querySelector("#agentsView"); if (!box || !window.Convos) return;
  box.innerHTML = ""; const list = Convos.list(); const aid = Convos.activeId();
  if (!list.length) { box.appendChild(el("div", "agentempty", "No agents yet — type a task below to summon one.")); return; }
  list.forEach((c) => {
    const [cls, status] = agentStatus(c);
    const row = el("div", "agentrow " + cls + (c.id === aid ? " sel" : ""));
    row.innerHTML = `<span class="aglyph">${AGLYPH[cls] || AGLYPH[""]}</span><span class="agname">${escapeHtml((c.name || "New Agent"))}</span><span class="agstatus">${escapeHtml(status)}</span>`;
    row.onclick = () => { Convos.switchTo(c.id); if (window.renderConvPanel) renderConvPanel(); toggleAgents(false); };
    box.appendChild(row);
  });
}
function toggleAgents(force) {
  agentsOpen = (force === undefined) ? !agentsOpen : force;
  const box = document.querySelector("#agentsView"), bar = document.querySelector("#inputBar");
  if (!box) return;
  box.classList.toggle("hidden", !agentsOpen);
  document.querySelector("#ctxBar")?.classList.toggle("hidden", agentsOpen);
  if (agentsOpen) { renderAgents(); if (input) input.placeholder = "Type something to summon a new AI agent..."; }
  else if (input) input.placeholder = "Ask Juile...";
}
const agBtn = document.querySelector("#agentsBtn"); if (agBtn) agBtn.onclick = (e) => { e.stopPropagation(); toggleAgents(); };
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft") return;
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "TEXTAREA" || tag === "INPUT") return;       // don't hijack while typing
  toggleAgents();
});
/* in Agents View, sending summons a brand-new agent (fresh conversation) first.
   Capture phase runs before app.js's send handlers, so the message lands in the new agent. */
function summonIfAgents() { if (agentsOpen && input && input.value.trim() && window.Convos) { Convos.newConversation(); if (window.renderConvPanel) renderConvPanel(); toggleAgents(false); } }
document.querySelector("#sendBtn")?.addEventListener("click", () => { if (!busy) summonIfAgents(); }, true);
input?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) summonIfAgents(); }, true);
if (window.Convos) { const _oldDone = window.renderConvPanel; window.renderConvPanel = function () { if (_oldDone) try { _oldDone(); } catch {} if (agentsOpen) renderAgents(); }; }

/* ---- GitHub chip: auth your account, then pick a repo Juile can read & act on ---- */
function setGhChip(repo) {
  const chip = document.querySelector("#ghChip"), txt = document.querySelector("#ghChipText");
  if (!chip) return;
  chip.classList.toggle("set", !!repo);
  if (txt) txt.textContent = repo ? ("GitHub\\" + repo.split("/").pop()) : "Connect GitHub";
}
async function buildGhMenu(menu) {
  menu.innerHTML = `<div class="pmhead">GitHub</div><div class="popitem"><span class="pi-main"><span class="pi-t">Checking…</span></span></div>`;
  let st = {};
  try { st = await (await fetch("/api/github/status")).json(); } catch {}
  menu.innerHTML = `<div class="pmhead">GitHub access</div>`;
  if (!st.ok) {
    const d = el("div"); d.innerHTML = `<div class="pi-d" style="padding:4px 12px 8px">${escapeHtml(st.message || "Not connected.")}</div>`;
    menu.appendChild(d);
    const b = el("button", "pmbtn", "Authenticate GitHub");
    b.onclick = async () => { b.textContent = "Authenticating…"; try { const j = await (await fetch("/api/github/auth", { method: "POST" })).json(); } catch {} buildGhMenu(menu); };
    menu.appendChild(b);
    return;
  }
  menu.appendChild(el("div", "pi-d", "Signed in as " + escapeHtml(st.user || "you") + ". Pick a repo for Juile to read & act on:")).style.cssText = "padding:2px 12px 8px";
  let repos = [];
  try { repos = (await (await fetch("/api/github/repos")).json()).repos || []; } catch {}
  if (!repos.length) menu.appendChild(el("div", "pi-d", "No repos found.")).style.cssText = "padding:6px 12px";
  repos.slice(0, 40).forEach((r) => {
    const it = el("div", "popitem" + (r === st.active ? " sel" : ""));
    it.innerHTML = `<span class="pi-main"><span class="pi-t">${escapeHtml(r)}</span></span>` + (r === st.active ? `<span class="pi-ck">●</span>` : "");
    it.onclick = async () => { closePops(); await fetch("/api/github/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: r }) }); setGhChip(r); };
    menu.appendChild(it);
  });
}
wireMenu("#ghChip", "#ghMenu", buildGhMenu);

/* ---- Local chip: "Local" = general access; pick a folder to FOCUS Juile there ---- */
function setLocalChip(focus) {
  const chip = document.querySelector("#localChip"), txt = document.querySelector("#localChipText");
  const svg = chip ? chip.querySelector("svg") : null;
  if (!chip) return;
  chip.classList.toggle("set", !!focus);
  if (txt) txt.textContent = focus ? (focus.split(/[\\/]/).filter(Boolean).pop() || focus) : "Local";
  if (svg) svg.innerHTML = focus
    ? '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'   // folder
    : '<rect x="3" y="4" width="18" height="12" rx="1.6"/><path d="M2 20h20"/>';                  // laptop
}
async function buildLocalMenu(menu) {
  let s = {}; try { s = await (await fetch("/api/settings")).json(); } catch {}
  const folders = s.folders || [], focus = s.local_focus || "";
  menu.innerHTML = `<div class="pmhead">Local access</div>`;
  const gen = el("div", "popitem" + (!focus ? " sel" : ""));
  gen.innerHTML = `<span class="pi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="1.6"/><path d="M2 20h20"/></svg></span><span class="pi-main"><span class="pi-t">Local (general access)</span><span class="pi-d">Juile can work anywhere you allow</span></span>` + (!focus ? `<span class="pi-ck">●</span>` : "");
  gen.onclick = async () => { closePops(); await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_focus: "" }) }); setLocalChip(""); };
  menu.appendChild(gen);
  folders.forEach((f) => {
    const it = el("div", "popitem" + (f === focus ? " sel" : ""));
    it.innerHTML = `<span class="pi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span><span class="pi-main"><span class="pi-t">${escapeHtml(f.split(/[\\/]/).filter(Boolean).pop() || f)}</span><span class="pi-d">${escapeHtml(f)}</span></span>` + (f === focus ? `<span class="pi-ck">●</span>` : "");
    it.onclick = async () => { closePops(); await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_focus: f }) }); setLocalChip(f); };
    menu.appendChild(it);
  });
  const add = el("button", "pmbtn", "Choose a folder…");
  add.onclick = async () => {
    const p = prompt("Folder path Juile should focus on (e.g. C:\\Users\\you\\project):");
    if (!p || !p.trim()) return;
    const path = p.trim(); const nf = folders.includes(path) ? folders : folders.concat([path]);
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folders: nf, local_focus: path }) });
    setLocalChip(path); closePops();
  };
  menu.appendChild(add);
}
wireMenu("#localChip", "#localMenu", buildLocalMenu);

/* ---- Remote-control status (phone ↔ PC link) ---- */
async function pollPeers() {
  try {
    const j = await (await fetch("/api/peers")).json();
    const chip = document.querySelector("#remoteChip"), st = document.querySelector("#remoteState");
    const online = (j.peers || 0) > 1;
    if (chip) chip.classList.toggle("online", online);
    if (st) st.textContent = online ? "(Online)" : "(Offline)";
  } catch {}
}

/* ---- init the chips from saved state ---- */
(async function initChips() {
  try {
    const s = await (await fetch("/api/settings")).json();
    setLocalChip(s.local_focus || "");
    setGhChip(s.github_repo || "");
  } catch {}
  pollPeers(); setInterval(pollPeers, 5000);
})();
