"use strict";
/* ============================================================
   OVERHAUL: rail widgets, command menus, settings, ask, files
   (loads after app.js; uses its globals)
   ============================================================ */

/* ---- file cards ---- */
const FICON = { xlsx: ["XLS", "#1e7e45"], xls: ["XLS", "#1e7e45"], csv: ["CSV", "#1e7e45"], doc: ["DOC", "#2b5797"], docx: ["DOC", "#2b5797"], pdf: ["PDF", "#c0392b"], py: ["PY", "#3572A5"], js: ["JS", "#b8a52a"], ts: ["TS", "#2b7489"], json: ["{}", "#666"], png: ["IMG", "#7c5cff"], jpg: ["IMG", "#7c5cff"], jpeg: ["IMG", "#7c5cff"], md: ["MD", "#666"], txt: ["TXT", "#666"], html: ["WEB", "#e34c26"], zip: ["ZIP", "#888"] };
const FILE_DOC = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
const FILE_DL = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 21h14"/></svg>`;
const FILE_SHARE = `<svg viewBox="0 0 24 24" fill="#fff"><path d="M14 9V5l7 7-7 7v-4.1C9 12 6 13.6 3 18c1-7 5-9 11-9z"/></svg>`;
function fileCard(name) {
  const card = el("div", "filecard2");
  const top = el("div", "fc2top");
  top.innerHTML = `<span class="fc2ic">${FILE_DOC}</span><span class="fc2name">${escapeHtml(name)}</span>`;
  const acts = el("div", "fc2acts");
  const dl = el("a", "fc2btn"); dl.href = "/files/" + enc(name); dl.setAttribute("download", name); dl.innerHTML = `${FILE_DL}<span>Download</span>`;
  const share = el("button", "fc2btn"); share.innerHTML = `${FILE_SHARE}<span>Share</span>`;
  share.onclick = () => {
    try { navigator.clipboard.writeText(location.origin + "/files/" + enc(name)); const s = share.querySelector("span"); s.textContent = "Copied link!"; setTimeout(() => s.textContent = "Share", 1300); }
    catch { fetch("/api/reveal?name=" + enc(name)); }
  };
  acts.append(dl, share);
  card.append(top, acts);
  return card;
}

/* ---- file edit diff card (Created/Updated name +A -B; click to expand the lines) ---- */
function colorizeDiff(txt) {
  return (txt || "(no diff)").split("\n").map((l) => {
    const c = (l.startsWith("+") && !l.startsWith("+++")) ? "da" : (l.startsWith("-") && !l.startsWith("---")) ? "dr" : l.startsWith("@@") ? "dh" : "";
    return `<span class="dl ${c}">${escapeHtml(l)}</span>`;
  }).join("\n");
}
function diffCard(name, added, removed) {
  const card = el("div", "diffcard");
  const head = el("div", "diffhead");
  head.innerHTML = `<span class="dfic">${ICONS.code}</span><span class="dfname">${escapeHtml(name)}</span><span class="dfstat"><span class="dfadd">+${added}</span> <span class="dfdel">-${removed}</span></span>`;
  const openBtn = el("button", "dfopen", "Open file"); openBtn.onclick = (e) => { e.stopPropagation(); fetch("/api/reveal?name=" + enc(name)); };
  head.appendChild(openBtn);
  const body = el("pre", "diffbody"); body.style.display = "none";
  let loaded = false;
  head.onclick = async () => {
    if (body.style.display === "none") {
      body.style.display = "block";
      if (!loaded) { loaded = true; try { const j = await (await fetch("/api/diff?name=" + enc(name))).json(); body.innerHTML = colorizeDiff(j.diff); } catch { body.textContent = "(diff unavailable)"; } }
    } else body.style.display = "none";
  };
  card.append(head, body);
  return card;
}

/* ---- plan + sub-agents ---- */
function planRow(text, parent) { const r = el("div", "plan-row"); r.innerHTML = `<span class="box"></span><span>${escapeHtml(text)}</span>`; r.onclick = () => r.classList.toggle("done"); parent.appendChild(r); }
function showPlan(title, steps) {
  transcript.appendChild(el("div", "thought", `<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg><span>Made plan</span>`));
  const w = el("div", "planwidget"); w.appendChild(el("h4", null, escapeHtml(title || "Plan")));
  (steps || []).forEach((s) => planRow(s, w));
  transcript.appendChild(w); scroll();
  const pb = document.querySelector("#planBody");
  if (pb) { pb.innerHTML = ""; pb.appendChild(el("div", "small muted", escapeHtml(title || "Plan"))); (steps || []).forEach((s) => planRow(s, pb)); }
}
let agentEls = [];
function showAgents(agents) {
  const wrap = el("div", "agents"); agentEls = [];
  (agents || []).forEach((a, i) => { const c = el("div", "agentcard"); c.innerHTML = `<div class="arole"><span class="adot"></span>${escapeHtml(a.role)}</div><div class="atask muted small">${escapeHtml(a.task)}</div><div class="ares"></div>`; wrap.appendChild(c); agentEls[i] = c; });
  transcript.appendChild(wrap); scroll();
}
function updateAgent(idx, result) { const c = agentEls[idx]; if (c) { c.classList.add("done"); c.querySelector(".ares").textContent = result; scroll(); } }

/* ---- ask-user question menu (matches the numbered-card design) ---- */
function showAsk(id, spec) {
  const menu = document.querySelector("#askMenu"); menu.classList.remove("hidden");
  const questions = (spec && spec.questions && spec.questions.length)
    ? spec.questions
    : [{ title: spec.title, description: spec.description, options: spec.options || [] }];
  let idx = 0; const answers = {};
  const keyFor = (q, i) => q.title || ("question " + (i + 1));
  function finish() { send({ type: "answer", id, answers }); menu.classList.add("hidden"); menu.innerHTML = ""; }
  function choose(q, i, val) { answers[keyFor(q, i)] = val; if (idx < questions.length - 1) { idx++; render(); } else finish(); }
  function render() {
    const i = idx, q = questions[i] || {}; menu.innerHTML = ""; let n = 0;
    menu.appendChild(el("div", "qtitle", escapeHtml(q.title || spec.title || "Question")));
    if (q.description) menu.appendChild(el("div", "qdesc", escapeHtml(q.description)));
    (q.options || []).forEach((o) => {
      n++; const title = typeof o === "string" ? o : (o.title || "");
      const opt = el("div", "qopt");
      opt.appendChild(el("span", "qnum", String(n)));
      const body = el("div", "qoptbody");
      body.appendChild(el("div", "qot", escapeHtml(title)));
      if (o.description) body.appendChild(el("div", "qod", escapeHtml(o.description)));
      opt.appendChild(body);
      opt.onclick = () => choose(q, i, title);
      menu.appendChild(opt);
    });
    // custom answer (numbered, dashed-underline input)
    n++;
    const crow = el("div", "qopt qcustomopt");
    crow.appendChild(el("span", "qnum", String(n)));
    const wrap = el("div", "qcustomwrap");
    wrap.appendChild(el("span", "qclabel", "Custom answer:"));
    const ci = el("input", "qcustom");
    wrap.appendChild(ci); crow.appendChild(wrap);
    crow.onclick = () => ci.focus();
    ci.onkeydown = (e) => { if (e.key === "Enter" && ci.value.trim()) { e.preventDefault(); choose(q, i, ci.value.trim()); } };
    menu.appendChild(crow);
    // skip (numbered)
    n++;
    const skip = el("div", "qopt qskipopt");
    skip.appendChild(el("span", "qnum", String(n)));
    skip.appendChild(el("div", "qot", "Skip this question"));
    skip.onclick = () => choose(q, i, "(skipped)");
    menu.appendChild(skip);
    menu.querySelectorAll(".qopt").forEach((o, k) => { o.style.animationDelay = (k * 0.045) + "s"; });
  }
  render(); scroll();
}

/* ---- mention chips (color highlight) ---- */
let chipBar = null;
function ensureChipBar() { if (!chipBar) { chipBar = el("div", "chips"); chipBar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap"; document.querySelector("#composer").insertBefore(chipBar, document.querySelector("#cmdMenu")); } return chipBar; }
function highlightChips() {
  const bar = ensureChipBar(); bar.innerHTML = "";
  const found = (input.value.match(/(^|\s)([/@#][\w.\-]+)/g) || []).map((s) => s.trim());
  found.forEach((m) => { const c = el("span", "mention"); c.textContent = m; c.style.cssText = "font-size:12px;padding:2px 8px;border-radius:7px;" + (m[0] === "/" ? "background:rgba(124,92,255,.18);color:#b9a6ff" : m[0] === "@" ? "background:rgba(94,140,255,.18);color:#8ea2ff" : "background:rgba(70,211,154,.18);color:#46d39a"); bar.appendChild(c); });
  bar.style.marginBottom = found.length ? "8px" : "0";
}

/* ---- command autocomplete (/ skills, @ files, # tags) ---- */
let SKILLS = [], FILES = [];
const TAGS = [["today", "Today's plan"], ["plan", "Current plan"], ["memory", "What Juile knows"], ["files", "Workspace files"], ["research", "Deep research mode"]];
async function loadCmdData() {
  try { SKILLS = (await (await fetch("/api/skills")).json()).skills || []; } catch {}
  try { FILES = (await (await fetch("/api/files")).json()).files || []; } catch {}
}
const cmdMenu = document.querySelector("#cmdMenu");
function closeCmd() { cmdMenu.classList.add("hidden"); cmdMenu.innerHTML = ""; }
function openCmd(prefix, query) {
  let items = []; const q = query.toLowerCase();
  if (prefix === "/") items = SKILLS.filter((s) => s.name.includes(q) || s.title.toLowerCase().includes(q)).slice(0, 40).map((s) => ["skill", s.name, s.title]);
  else if (prefix === "@") items = FILES.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 40).map((f) => ["file", f.name, (f.ext || "").toUpperCase() + " file"]);
  else if (prefix === "#") items = TAGS.filter((t) => t[0].includes(q)).map((t) => ["tag", t[0], t[1]]);
  if (!items.length) { closeCmd(); return; }
  cmdMenu.innerHTML = "";
  items.forEach(([kind, name, desc], i) => {
    const it = el("div", "cmd-item" + (i === 0 ? " sel" : ""));
    it.innerHTML = `<span class="ckind">${kind}</span><span class="cname">${escapeHtml(name)}</span><span class="cdesc">${escapeHtml(desc)}</span>`;
    it.onclick = () => insertToken(prefix, name); cmdMenu.appendChild(it);
  });
  cmdMenu.classList.remove("hidden");
}
function insertToken(prefix, name) {
  const v = input.value, pos = input.selectionStart, before = v.slice(0, pos);
  const m = before.match(/([/@#])([\w.\-]*)$/);
  if (m) { const start = pos - m[0].length; input.value = v.slice(0, start) + prefix + name + " " + v.slice(pos); const np = start + prefix.length + name.length + 1; input.setSelectionRange(np, np); }
  closeCmd(); input.focus(); highlightChips(); autosize();
}
input.addEventListener("input", () => { highlightChips(); const before = input.value.slice(0, input.selectionStart); const m = before.match(/([/@#])([\w.\-]*)$/); if (m) openCmd(m[1], m[2]); else closeCmd(); });
input.addEventListener("keydown", (e) => {
  if (cmdMenu.classList.contains("hidden")) return;
  const items = [...cmdMenu.querySelectorAll(".cmd-item")]; if (!items.length) return;
  let sel = items.findIndex((i) => i.classList.contains("sel")); if (sel < 0) sel = 0;
  if (e.key === "ArrowDown") { e.preventDefault(); e.stopImmediatePropagation(); items[sel].classList.remove("sel"); sel = (sel + 1) % items.length; items[sel].classList.add("sel"); items[sel].scrollIntoView({ block: "nearest" }); }
  else if (e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); items[sel].classList.remove("sel"); sel = (sel - 1 + items.length) % items.length; items[sel].classList.add("sel"); items[sel].scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); items[sel].click(); }
  else if (e.key === "Escape") { closeCmd(); }
}, true);

/* ---- icons ---- */
/* solid, filled white icons (Material-style single paths) */
const SVGF = (p) => `<svg viewBox="0 0 24 24" fill="currentColor">${p}</svg>`;
const ICONS = {
  computeruse: SVGF('<path d="M21 16V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H1v2h22v-2h-4zM9 20v-2h6v2H9z"/>'),
  web: SVGF('<path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z"/>'),
  deep: SVGF('<path d="M12 2 3 7l9 5 9-5-9-5zm-7.37 8.27L3 11.13l9 5 9-5-1.63-.86L12 14.4l-7.37-4.13zm0 4L3 15.13l9 5 9-5-1.63-.86L12 18.4l-7.37-4.13z"/>'),
  code: SVGF('<path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>'),
  image: SVGF('<path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>'),
  editimg: SVGF('<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>'),
  slides: SVGF('<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm6 3v7l5-3.5L10 7zM8 20h8v1H8z"/>'),
  sheet: SVGF('<path d="M20 2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z"/>'),
  doc: SVGF('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>'),
  plan: SVGF('<path d="M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM3 21h18v-2H3v2z"/>'),
  agents: SVGF('<path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3 0-6 1.5-6 4v2h12v-2c0-2.5-3-4-6-4zM4 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm16 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>'),
  attach: SVGF('<path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/>'),
  shot: SVGF('<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9z"/>'),
  skills: SVGF('<path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>'),
  conn: SVGF('<path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/>'),
  mic: SVGF('<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>'),
};

/* ---- capsule modes + direct actions ----
   [label, iconKey, prompt-prefix, capsule-color] */
const MODES = [
  ["Computer Use", "computeruse", "Use my mouse, keyboard and screen (the computer tool) to:", "#5b8cff"],
  ["Web Search", "web", "Search the web for:", "#37e0a0"],
  ["Deep Research", "deep", "Do deep research with a generated checklist, searching many sources, about:", "#37e0a0"],
  ["Write Code", "code", "Write the code and create the files for:", "#7c5cff"],
  ["Create Image", "image", "Create an image with Higgsfield (mcp server='higgsfield', generate_image), then show it. Image of:", "#ff9a3d"],
  ["Edit Image", "editimg", "Edit the attached image with Higgsfield (mcp server='higgsfield'), then show the result. Edit:", "#ff5fa6"],
  ["Slides", "slides", "Make a beautiful deck: generate slide imagery with Higgsfield, then render the slides widget. Deck about:", "#b06cf0"],
  ["Spreadsheet", "sheet", "Create a beautiful Excel spreadsheet (use create_xlsx) for:", "#1e9e5a"],
  ["Document", "doc", "Create a document file (use create_file) about:", "#5b8cff"],
  ["Make a Plan", "plan", "Make a step-by-step checklist plan (use make_plan) for:", "#7c5cff"],
  ["Sub-agents", "agents", "Summon parallel sub-agents (use spawn_agents) to:", "#7c5cff"],
];
const ACTIONS = [
  ["Attach file", "attach", () => document.querySelector("#fileInput").click()],
  ["Screenshot", "shot", () => { window.__mode = null; input.value = "Take a screenshot of my screen and tell me what is on it."; doSend(); }],
  ["Skills", "skills", () => { input.value = (input.value || "") + "/"; input.focus(); input.dispatchEvent(new Event("input")); }],
  ["Connect an app", "conn", () => openSettings("conn")],
];

let voiceRelay = false;
function buildPlusMenu() {
  const pm = document.querySelector("#plusMenu"); pm.innerHTML = "";
  pm.appendChild(Object.assign(document.createElement("div"), { className: "pm-title", textContent: "Modes" }));
  MODES.forEach(([label, ic, prefix, color]) => {
    const b = el("button", "pm-item"); b.innerHTML = `<span class="pmi">${ICONS[ic]}</span><span>${label}</span>`;
    b.onclick = () => { pm.classList.add("hidden"); setMode({ label, icon: ICONS[ic], prefix, color, placeholder: `Type for ${label}...` }); };
    pm.appendChild(b);
  });
  pm.appendChild(Object.assign(document.createElement("div"), { className: "pm-title", textContent: "Actions" }));
  ACTIONS.forEach(([label, ic, run]) => { const b = el("button", "pm-item"); b.innerHTML = `<span class="pmi">${ICONS[ic]}</span><span>${label}</span>`; b.onclick = () => { pm.classList.add("hidden"); run(); }; pm.appendChild(b); });
  const vb = el("button", "pm-item"); vb.innerHTML = `<span class="pmi">${ICONS.mic}</span><span>Voice → PC (phone)</span><span class="pmtog" id="vtog">${voiceRelay ? "on" : "off"}</span>`;
  vb.onclick = (e) => { e.stopPropagation(); voiceRelay = !voiceRelay; document.querySelector("#vtog").textContent = voiceRelay ? "on" : "off"; }; pm.appendChild(vb);
}
document.querySelector("#addBtn").onclick = (e) => { e.stopPropagation(); const pm = document.querySelector("#plusMenu"); if (pm.classList.contains("hidden")) { buildPlusMenu(); pm.classList.remove("hidden"); } else pm.classList.add("hidden"); };
document.querySelector("#plusMenu").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { document.querySelector("#plusMenu").classList.add("hidden"); closeCmd(); });

/* ---- in-textbox capsule chip ---- */
const modeChip = document.createElement("span"); modeChip.id = "modeChip"; modeChip.className = "modechip hidden";
document.querySelector("#inputBar").insertBefore(modeChip, input);
function setMode(m) {
  window.__mode = m;
  modeChip.style.setProperty("--mc", m.color || "#7c5cff");
  modeChip.innerHTML = `<span class="mc-ic">${m.icon}</span><span>${escapeHtml(m.label)}</span><button class="mcx" title="remove">×</button>`;
  modeChip.classList.remove("hidden");
  modeChip.querySelector(".mcx").onclick = (e) => { e.stopPropagation(); clearMode(); input.focus(); };
  if (m.placeholder) input.placeholder = m.placeholder; input.focus();
}
function clearMode() { window.__mode = null; modeChip.classList.add("hidden"); modeChip.innerHTML = ""; input.placeholder = "Ask Juile...   (/ skills, @ files, # tags)"; }
window.__clearMode = clearMode;

/* ---- voice / mic ---- */
const micBtn = document.createElement("button"); micBtn.id = "micBtn"; micBtn.className = "micbtn"; micBtn.title = "Voice (mic)"; micBtn.innerHTML = ICONS.mic;
document.querySelector("#inputBar").insertBefore(micBtn, document.querySelector("#sendBtn"));
let recog = null, recording = false;
micBtn.onclick = (e) => { e.stopPropagation(); toggleMic(); };
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice input needs Chrome/Edge or a phone browser."); return; }
  if (recording) { recog && recog.stop(); return; }
  recog = new SR(); recog.lang = "en-US"; recog.interimResults = true; recog.continuous = false;
  recording = true; micBtn.classList.add("rec");
  recog.onresult = (ev) => { let t = ""; for (const r of ev.results) t += r[0].transcript; input.value = t; autosize(); };
  recog.onerror = () => {};
  recog.onend = () => {
    recording = false; micBtn.classList.remove("rec");
    const t = (input.value || "").trim(); if (!t) return;
    if (voiceRelay) { send({ type: "relay", text: t, send: true }); input.value = ""; autosize(); }
    else doSend();
  };
  recog.start();
}

/* ---- right rail: My Day + pixelated wave + Memory ---- */
let dayRaf = 0;
function startDayWave() {
  const cv = document.querySelector("#dayWave"); if (!cv) return; const ctx = cv.getContext("2d");
  const cw = cv.width = cv.clientWidth || 280; const ch = cv.height = 84; const px = 9; let t = 0;
  cancelAnimationFrame(dayRaf);
  function frame() {
    t += 0.06; ctx.clearRect(0, 0, cw, ch);
    const cols = Math.ceil(cw / px), rows = Math.ceil(ch / px);
    for (let x = 0; x < cols; x++) {
      const wave = Math.sin(x * 0.38 + t) * 0.5 + Math.sin(x * 0.12 - t * 0.7) * 0.5;
      const h = Math.round(((wave + 1) / 2) * (rows - 1));
      for (let y = rows - 1; y >= rows - 1 - h; y--) {
        const hue = (210 + x * 4 + (rows - y) * 5) % 360;
        ctx.fillStyle = `hsl(${hue} 85% ${48 + (rows - y) * 2}%)`;
        ctx.fillRect(x * px + 1, y * px + 1, px - 2, px - 2);
      }
    }
    dayRaf = requestAnimationFrame(frame);
  }
  frame();
}
async function loadDay() {
  const b = document.querySelector("#dayBody"); if (!b) return;
  try {
    const d = await (await fetch("/api/day")).json(); b.innerHTML = "";
    (d.items || []).forEach((it) => { const row = el("div", "day-item" + (it.done ? " done" : "")); row.innerHTML = `<span class="dt">${escapeHtml(it.time)}</span><span class="dot"></span><span>${escapeHtml(it.title)}</span>`; row.onclick = () => row.classList.toggle("done"); b.appendChild(row); });
  } catch {}
}
async function loadMemoryRail() {
  const b = document.querySelector("#memBody"); if (!b) return;
  try {
    const s = await (await fetch("/api/settings")).json(); b.innerHTML = "";
    const mem = s.memory || []; if (!mem.length) { b.innerHTML = `<div class="muted small">Juile will remember facts about you here.</div>`; return; }
    mem.slice(-12).forEach((m) => { const row = el("div", "mem-item"); row.innerHTML = `<span>${escapeHtml(m)}</span>`; const del = el("span", "mdel", "✕"); del.onclick = async () => { const cur = (await (await fetch("/api/settings")).json()).memory || []; const ix = cur.indexOf(m); if (ix >= 0) cur.splice(ix, 1); await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory: cur }) }); loadMemoryRail(); }; row.appendChild(del); b.appendChild(row); });
  } catch {}
}
(() => { const ir = document.querySelector("#iconRail"); if (ir) ir.onclick = () => document.body.classList.toggle("norail"); })();
(() => { const me = document.querySelector("#memEdit"); if (me) me.onclick = () => openSettings("mem"); })();

/* ---- providers (bring-your-own-key) ---- */
const FIELD_LABEL = { api_key: "API key", account_id: "Account ID", base_url: "Endpoint URL", aws_access_key_id: "AWS Access Key ID", aws_secret_access_key: "AWS Secret Access Key", region: "AWS Region" };
function renderProviders2(saved) {
  const box = document.querySelector("#provForm"); if (!box || typeof cfg === "undefined" || !cfg) return;
  box.innerHTML = ""; const keys = saved.provider_keys || {};
  cfg.providers.forEach((p) => {
    const row = el("div", "provrow");
    row.appendChild(el("div", "provhead", `<span class="pname">${escapeHtml(p.label)}</span><span class="pstatus ${p.configured ? "on" : ""}">${p.configured ? "ready" : (p.local ? "local" : "no key")}</span>`));
    const fwrap = el("div", "provfields"); const inputs = {};
    (p.fields || []).forEach((f) => {
      const inp = document.createElement("input");
      inp.placeholder = FIELD_LABEL[f] || f;
      inp.type = (f.includes("key") || f.includes("secret")) ? "password" : "text";
      inp.value = (keys[p.key] && keys[p.key][f]) || "";
      inputs[f] = inp; fwrap.appendChild(inp);
    });
    if (!(p.fields || []).length) {
      const hint = p.key === "claude_cli"
        ? "Account-based — runs your installed Claude Code CLI (claude -p) using your existing Claude login. No API key. Click Auth to check it's ready."
        : (p.local ? "Local — just start the server, no key needed." : "No credentials needed.");
      fwrap.appendChild(el("div", "muted small", hint));
    }
    row.appendChild(fwrap);
    const actions = el("div", "prow-actions");
    if ((p.fields || []).length) {
      const save = el("button", "psave", "Save " + p.label);
      save.onclick = async () => {
        const creds = {}; Object.entries(inputs).forEach(([f, inp]) => creds[f] = inp.value.trim());
        save.textContent = "Saving…";
        await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider_keys: { [p.key]: creds } }) });
        try { cfg = await (await fetch("/api/config")).json(); } catch {}
        renderProviders2(await (await fetch("/api/settings")).json());
      };
      actions.appendChild(save);
    }
    if (p.key === "claude_cli") {
      const verify = el("button", "connauth", "Auth"); verify.style.marginLeft = "0";
      verify.onclick = async () => {
        let msg = row.querySelector(".authmsg"); if (!msg) { msg = el("div", "authmsg"); row.appendChild(msg); }
        verify.classList.add("busy"); verify.textContent = "Checking…"; msg.className = "authmsg"; msg.textContent = "Checking the Claude CLI…";
        try { const j = await (await fetch("/api/claude/check")).json(); msg.className = "authmsg " + (j.ok ? "ok" : "bad"); msg.textContent = j.message; }
        catch (e) { msg.className = "authmsg bad"; msg.textContent = "Check failed: " + e; }
        verify.classList.remove("busy"); verify.textContent = "Auth";
      };
      actions.appendChild(verify);
    }
    row.appendChild(actions); box.appendChild(row);
  });
}
/* Auth-at-the-spot button: runs the connector's connect/OAuth handshake and shows the result inline. */
function connAuthButton(name, row) {
  const btn = el("button", "connauth", "Auth");
  btn.onclick = async () => {
    let msg = row.querySelector(".authmsg");
    if (!msg) { msg = el("div", "authmsg"); row.appendChild(msg); }
    btn.classList.add("busy"); btn.textContent = "Authing…"; msg.className = "authmsg"; msg.textContent = "Connecting… (approve in your browser if a tab opens)";
    try {
      const r = await fetch("/api/connector/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const j = await r.json();
      msg.className = "authmsg " + (j.ok ? "ok" : "bad"); msg.textContent = j.message || (j.ok ? "Connected." : "Couldn't connect.");
    } catch (e) { msg.className = "authmsg bad"; msg.textContent = "Auth failed: " + e; }
    btn.classList.remove("busy"); btn.textContent = "Auth";
  };
  return btn;
}

function renderMcp(saved) {
  const box = document.querySelector("#mcpForm"); if (!box) return;
  box.innerHTML = ""; const mcp = saved.mcp || {};
  const DEFS = [
    ["composio", "Composio (Gmail, Calendar, Notion, 500+)", [["api_key", "Composio API key"], ["url", "MCP URL (optional)"]], true],
    ["zapier", "Zapier MCP", [["url", "Zapier MCP URL"]], true],
    ["higgsfield", "Higgsfield (image / video / slides)", [["api_key", "API key (optional — OAuth if blank)"], ["url", "MCP URL (optional)"]], true],
    ["tavily", "Tavily (web + deep research)", [["api_key", "Tavily API key"]], true],
  ];
  DEFS.forEach(([key, label, fields, canAuth]) => {
    const cur = mcp[key] || {}; const isSet = fields.some(([f]) => (cur[f] || "").trim());
    const row = el("div", "mcprow");
    row.appendChild(el("div", "provhead", `<span class="pname">${escapeHtml(label)}</span><span class="pstatus ${isSet ? "on" : ""}">${isSet ? "set" : "not set"}</span>`));
    const fwrap = el("div", "provfields"); const inputs = {};
    fields.forEach(([f, ph]) => { const inp = document.createElement("input"); inp.placeholder = ph; inp.type = f.includes("key") ? "password" : "text"; inp.value = cur[f] || ""; inputs[f] = inp; fwrap.appendChild(inp); });
    row.appendChild(fwrap);
    const actions = el("div", "prow-actions");
    const save = el("button", "psave", "Save");
    save.onclick = async () => {
      const data = {}; Object.entries(inputs).forEach(([f, inp]) => data[f] = inp.value.trim());
      save.textContent = "Saving…";
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcp: { [key]: data } }) });
      renderMcp(await (await fetch("/api/settings")).json());
    };
    actions.appendChild(save);
    if (canAuth) actions.appendChild(connAuthButton(key, row));
    row.appendChild(actions); box.appendChild(row);
  });
}

async function renderVoices(s) {
  const box = document.querySelector("#voicePicker"); if (!box) return;
  let voices = [];
  try { voices = (await (await fetch("/api/voices")).json()).voices || []; } catch {}
  const curVoice = (s && s.tts_voice) || "en-US-AriaNeural";
  box.innerHTML = "";
  voices.forEach((v) => {
    const card = el("div", "voicecard" + (v.voice === curVoice ? " sel" : ""));
    card.innerHTML = `<div class="vcname">${escapeHtml(v.name)}</div><div class="vctag">${escapeHtml(v.tag)}</div>`;
    const play = el("button", "vcplay", "▶"); play.title = "Preview voice";
    play.onclick = (e) => { e.stopPropagation(); try { new Audio(`/api/tts?voice=${enc(v.voice)}&rate=${enc(v.rate)}&pitch=${enc(v.pitch)}&text=${enc("Hey, I'm Juile. This is how I sound.")}`).play(); } catch {} };
    card.appendChild(play);
    card.onclick = async () => {
      box.querySelectorAll(".voicecard").forEach((c) => c.classList.remove("sel")); card.classList.add("sel");
      const patch = { tts_persona: v.id, tts_voice: v.voice, tts_rate: v.rate, tts_pitch: v.pitch };
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (window.applyVoice) window.applyVoice(patch);
      if (!ttsOn) { ttsOn = true; const t = document.querySelector("#ttsState"); if (t) { t.textContent = "on"; t.classList.add("on"); } }
    };
    box.appendChild(card);
  });
}

async function renderSkills() {
  const box = document.querySelector("#skillList"); if (!box) return;
  let skills = [];
  try { skills = (await (await fetch("/api/skills")).json()).skills || []; } catch {}
  const q = (document.querySelector("#skillSearch")?.value || "").toLowerCase();
  const filtered = skills.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.title || "").toLowerCase().includes(q));
  box.innerHTML = "";
  box.appendChild(el("div", "muted small", `${filtered.length} of ${skills.length} skills`));
  filtered.slice(0, 150).forEach((s) => {
    const row = el("div", "conn");
    row.innerHTML = `<span>${escapeHtml(s.name)}</span>`;
    const del = el("span", "cdel", "remove");
    del.onclick = async () => { await fetch("/api/skills/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name }) }); loadCmdData(); renderSkills(); };
    row.appendChild(del); box.appendChild(row);
  });
}
document.querySelector("#skillAdd").onclick = async () => {
  const name = document.querySelector("#skillName").value.trim(); if (!name) return;
  await fetch("/api/skills/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, content: document.querySelector("#skillBody").value }) });
  document.querySelector("#skillName").value = ""; document.querySelector("#skillBody").value = "";
  loadCmdData(); renderSkills();
};
document.querySelector("#skillSearch").oninput = () => renderSkills();

/* ---- settings modal ---- */
function openSettings(tab) {
  const modal = document.querySelector("#settingsModal"); modal.classList.remove("hidden");
  fetch("/api/settings").then((r) => r.json()).then((s) => {
    document.querySelector("#setInstr").value = s.instructions || ""; document.querySelector("#setTone").value = s.tone || ""; document.querySelector("#setMem").value = (s.memory || []).join("\n");
    try { renderProviders2(s); } catch (e) { console.error("providers render failed", e); }
    try { renderMcp(s); } catch (e) { console.error("mcp render failed", e); }
    try { renderSkills(); } catch (e) { console.error("skills render failed", e); }
    try { renderVoices(s); } catch (e) { console.error("voices render failed", e); }
    const cl = document.querySelector("#connList"); cl.innerHTML = ""; (s.connectors || []).forEach((c) => {
      const row = el("div", "conn");
      const top = el("div", "conntop");
      top.innerHTML = `<span class="connname">${escapeHtml(c.name)} — ${escapeHtml(c.url)}</span>`;
      const acts = el("div", "prow-actions");
      acts.appendChild(connAuthButton(c.name, row));
      const del = el("span", "cdel", "remove");
      del.onclick = async () => { const cur = (await (await fetch("/api/settings")).json()).connectors || []; await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectors: cur.filter((x) => x.name !== c.name) }) }); openSettings("conn"); };
      acts.appendChild(del); top.appendChild(acts); row.appendChild(top); cl.appendChild(row);
    });
  });
  document.querySelector("#qr2").src = "/qr.png?" + Date.now(); document.querySelector("#lanUrl2").textContent = (typeof cfg !== "undefined" && cfg && cfg.lan_url) || "";
  if (tab) switchTab(tab);
}
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("sel", t.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
}
(() => { const g = document.querySelector("#iconSettings"); if (g) g.onclick = () => openSettings("providers"); })();
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
document.querySelector("#setSave").onclick = async () => {
  const body = { instructions: document.querySelector("#setInstr").value, tone: document.querySelector("#setTone").value, memory: document.querySelector("#setMem").value.split("\n").map((x) => x.trim()).filter(Boolean) };
  await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  document.querySelector("#settingsModal").classList.add("hidden"); loadMemoryRail();
};
document.querySelector("#connAdd").onclick = async () => {
  const name = document.querySelector("#connName").value.trim(), url = document.querySelector("#connUrl").value.trim();
  const msg = document.querySelector("#connMsg");
  if (msg) { msg.className = "muted small"; msg.textContent = ""; }
  if (!name || !url) { if (msg) { msg.className = "muted small bad"; msg.textContent = "Name and URL are both required."; } return; }
  const btn = document.querySelector("#connAdd"); const label = btn.textContent; btn.disabled = true; btn.textContent = "Adding…";
  try {
    const cur = (await (await fetch("/api/settings")).json()).connectors || [];
    cur.push({ name, url, header_name: document.querySelector("#connHName").value.trim(), header_value: document.querySelector("#connHVal").value.trim() });
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectors: cur }) });
    if (!res.ok) throw new Error("server returned " + res.status);
    document.querySelector("#connName").value = document.querySelector("#connUrl").value = document.querySelector("#connHName").value = document.querySelector("#connHVal").value = "";
    openSettings("conn");
  } catch (e) {
    if (msg) { msg.className = "muted small bad"; msg.textContent = "Couldn't add connector: " + e.message; }
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
};

/* ---- conversation list (the greeting pill is the conversation switcher) ---- */
const Convos = (() => {
  const LS = "juile.convos", LSA = "juile.active";
  let list = [], activeId = null;
  const T = () => document.querySelector("#transcript");
  function load() { try { list = JSON.parse(localStorage.getItem(LS)) || []; } catch { list = []; } activeId = localStorage.getItem(LSA); }
  function persist() { localStorage.setItem(LS, JSON.stringify(list)); if (activeId) localStorage.setItem(LSA, activeId); serverSave(); }
  let _saveT;
  function serverSave() { clearTimeout(_saveT); _saveT = setTimeout(() => { try { fetch("/api/convos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversations: list }) }); } catch {} }, 500); }
  async function nameWithAI(c) {
    if (!c || c._naming) return; c._naming = true;
    try {
      const r = await fetch("/api/title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: settings.provider, model: settings.model, messages: (c.msgs || []).slice(0, 2).map((m) => ({ role: m.role, content: m.text })) }) });
      const j = await r.json();
      if (j.title) { c.name = j.title; c.named = true; persist(); setPill(c.name); if (window.renderConvPanel) window.renderConvPanel(); }
    } catch {}
    c._naming = false;
  }
  function active() { return list.find((c) => c.id === activeId); }
  function uid() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function setPill(name) { const t = document.querySelector("#greetingText"); if (t) t.textContent = name || "New Conversation"; }
  function ensure() { if (!active()) { const c = { id: uid(), name: "New Conversation", msgs: [] }; list.unshift(c); activeId = c.id; persist(); } setPill(active().name); }
  function clearT() { const t = T(); if (t) t.innerHTML = ""; }
  function sendLoad(msgs) { try { send({ type: "load", conv_id: activeId, messages: (msgs || []).map((m) => ({ role: m.role, content: m.text })) }); } catch {} }
  function appendAssistantTo(cid, text) { const c = list.find((x) => x.id === cid); if (!c) return; c.msgs.push({ role: "assistant", text: text || "" }); persist(); if (window.renderConvPanel) window.renderConvPanel(); }
  function renderT(c) {
    clearT(); const t = T(); if (!t) return;
    (c.msgs || []).forEach((m, i) => {
      if (m.role === "user") { const u = el("div", "msg user"); u.appendChild(el("span", "umtext", escapeHtml(m.text))); if (typeof attachUserActions === "function") attachUserActions(u, i, m.text); t.appendChild(u); }
      else { const a = el("div", "msg juile"); try { a.appendChild(renderMarkdown(m.text)); } catch { a.textContent = m.text; } if (typeof msgActions === "function") a.appendChild(msgActions([{ title: "Regenerate", icon: IC_REGEN, fn: () => regenerateMsg(i) }, { title: "Copy", icon: IC_COPY, fn: (b) => copyText(m.text, b) }])); t.appendChild(a); }
    });
    t.scrollTop = t.scrollHeight;
  }
  function newConversation() { const c = { id: uid(), name: "New Conversation", msgs: [] }; list.unshift(c); activeId = c.id; persist(); setPill(c.name); clearT(); sendLoad([]); closeMenu(); }
  function switchTo(id) { const c = list.find((x) => x.id === id); if (!c) return; activeId = id; persist(); setPill(c.name); renderT(c); sendLoad(c.msgs); closeMenu(); }
  function remove(id) { list = list.filter((c) => c.id !== id); if (activeId === id) activeId = (list[0] || {}).id || null; persist(); if (!active()) newConversation(); else { setPill(active().name); renderT(active()); sendLoad(active().msgs); } closeMenu(); }
  function deriveTitle(t) { t = (t || "").replace(/\s+/g, " ").trim(); const w = t.split(" ").slice(0, 6).join(" "); return ((w.charAt(0).toUpperCase() + w.slice(1)).slice(0, 42)) || "New Conversation"; }
  function onUser(text) {
    ensure(); const c = active(); c.msgs.push({ role: "user", text: text || "" });
    if (!c.named && c.name === "New Conversation" && (text || "").trim()) { setPill("Naming…"); nameWithAI(c); }
    persist(); return c.msgs.length - 1;
  }
  function len() { const c = active(); return c ? c.msgs.length : 0; }
  function msgAt(i) { const c = active(); return c && c.msgs[i]; }
  function rewindTo(idx) { const c = active(); if (!c) return; c.msgs = c.msgs.slice(0, Math.max(0, idx)); persist(); renderT(c); sendLoad(c.msgs); }
  async function onAssistant(text) {
    const c = active(); if (!c) return;
    c.msgs.push({ role: "assistant", text: text || "" }); persist();
    if (!c.named && c.msgs.filter((m) => m.role === "user").length === 1) {
      c.named = true;
      try {
        const r = await fetch("/api/title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: settings.provider, model: settings.model, messages: c.msgs.slice(0, 2).map((m) => ({ role: m.role, content: m.text })) }) });
        const j = await r.json(); if (j.title) { c.name = j.title; persist(); setPill(c.name); if (window.renderConvPanel) window.renderConvPanel(); }
      } catch {}
    }
  }
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener("click", closeMenu); } }
  function toggleMenu() {
    if (menu) { closeMenu(); return; }
    menu = el("div", "convmenu");
    const nb = el("button", "convnew", "+ New Conversation"); nb.onclick = (e) => { e.stopPropagation(); newConversation(); }; menu.appendChild(nb);
    list.forEach((c) => {
      const it = el("div", "convitem" + (c.id === activeId ? " sel" : ""));
      it.appendChild(el("span", "convname", c.name));
      const del = el("span", "convdel", "✕"); del.title = "Delete"; del.onclick = (e) => { e.stopPropagation(); remove(c.id); };
      it.appendChild(del); it.onclick = (e) => { e.stopPropagation(); switchTo(c.id); }; menu.appendChild(it);
    });
    document.querySelector("#bar").appendChild(menu);
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
  }
  function init() {
    load(); ensure(); const c = active(); if (c && c.msgs.length) renderT(c);
    (async () => {
      try {
        const r = await fetch("/api/convos"); const j = await r.json();
        if (j && j.conversations && j.conversations.length) {
          list = j.conversations;
          if (!active()) activeId = (list[0] || {}).id || activeId;
          localStorage.setItem(LS, JSON.stringify(list));
          setPill((active() || {}).name); const a = active(); if (a) renderT(a);
          if (window.renderConvPanel) window.renderConvPanel();
        }
      } catch {}
    })();
  }
  function syncServer() { const c = active(); if (c) sendLoad(c.msgs); }
  return { init, onUser, onAssistant, toggleMenu, newConversation, switchTo, remove, appendAssistantTo, list: () => list, activeId: () => activeId, syncServer, len, msgAt, rewindTo };
})();
window.Convos = Convos;

function renderConvPanel() {
  const box = document.querySelector("#convPanelList"); if (!box || !window.Convos) return;
  box.innerHTML = "";
  const items = Convos.list(); const aid = Convos.activeId();
  items.forEach((c) => {
    const running = window._running && window._running.has(c.id);
    const row = el("div", "convrow" + (c.id === aid ? " active" : ""));
    if (running) row.appendChild(el("span", "convrun"));
    row.appendChild(el("span", "convrowname", c.name || "New Conversation"));
    const del = el("button", "convrowdel", "✕"); del.title = "Delete";
    del.onclick = (e) => { e.stopPropagation(); Convos.remove(c.id); renderConvPanel(); };
    row.appendChild(del);
    row.onclick = () => { Convos.switchTo(c.id); renderConvPanel(); };
    box.appendChild(row);
  });
}
window.renderConvPanel = renderConvPanel;
(() => {
  const nw = document.querySelector("#cpNew"); if (nw) nw.onclick = () => { Convos.newConversation(); renderConvPanel(); };
  const cl = document.querySelector("#cpClose"); if (cl) cl.onclick = () => document.querySelector("#convPanel").classList.remove("open");
})();

/* ---- project + folders bar (the chips Juile can edit) ---- */
const Ctx = (() => {
  let folders = [], projectName = "Project 1";
  async function loadState() {
    try { const s = await (await fetch("/api/settings")).json(); folders = s.folders || []; projectName = s.project_name || "Project 1"; } catch {}
    render();
  }
  async function save() {
    try { await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folders, project_name: projectName }) }); } catch {}
  }
  function render() {
    const pn = document.querySelector("#projectName"); if (pn) pn.textContent = projectName;
    const box = document.querySelector("#folderChips"); if (!box) return; box.innerHTML = "";
    folders.forEach((f, i) => {
      const chip = el("span", "foldchip");
      const short = f.split(/[\\/]/).filter(Boolean).pop() || f;
      chip.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span title="${escapeHtml(f)}">${escapeHtml(short)}</span>`;
      const x = el("span", "fx", "✕"); x.onclick = () => { folders.splice(i, 1); save(); render(); };
      chip.appendChild(x); box.appendChild(chip);
    });
  }
  function addFolder() { const p = prompt("Folder path Juile can read & edit (e.g. C:\\Users\\you\\project):"); if (p && p.trim()) { folders.push(p.trim()); save(); render(); } }
  function rename() { const n = prompt("Project name:", projectName); if (n && n.trim()) { projectName = n.trim(); save(); render(); } }
  function init() {
    const add = document.querySelector("#ctxAdd"); if (add) add.onclick = (e) => { e.stopPropagation(); addFolder(); };
    const pc = document.querySelector("#projectChip"); if (pc) pc.onclick = (e) => { e.stopPropagation(); rename(); };
    loadState();
  }
  return { init };
})();
window.Ctx = Ctx;

/* ---- rail widgets: clock + weather + markets ---- */
function startClock() {
  const b = document.querySelector("#clockBody"); if (!b) return;
  const upd = () => { const d = new Date(); b.innerHTML = `<div class="clocktime">${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div><div class="clockdate">${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>`; };
  upd(); clearInterval(window._clk); window._clk = setInterval(upd, 20000);
}
async function loadWeather() {
  const b = document.querySelector("#weatherBody"); if (!b) return;
  try {
    const d = await (await fetch("/api/weather")).json();
    if (d.ok) b.innerHTML = `<div class="wxtemp">${d.tempC}°<span>C</span></div><div class="wxdesc">${escapeHtml(d.desc)}${d.city ? " · " + escapeHtml(d.city) : ""}</div><div class="wxsub">Feels ${d.feels}° · Humidity ${d.humidity}%</div>`;
    else b.innerHTML = '<div class="muted small">Weather unavailable</div>';
  } catch { b.innerHTML = '<div class="muted small">Weather unavailable</div>'; }
}
async function loadMarkets() {
  const b = document.querySelector("#marketsBody"); if (!b) return;
  try {
    const d = await (await fetch("/api/markets")).json();
    if (d.ok && d.items.length) { b.innerHTML = ""; d.items.forEach((it) => { const up = (it.chg || 0) >= 0; const row = el("div", "mktrow"); row.innerHTML = `<span class="mktname">${escapeHtml(it.name)} <b>${escapeHtml(it.sym)}</b></span><span class="mktprice">$${Number(it.price || 0).toLocaleString()}</span><span class="mktchg ${up ? "up" : "down"}">${up ? "+" : ""}${(it.chg || 0).toFixed(2)}%</span>`; b.appendChild(row); }); }
    else b.innerHTML = '<div class="muted small">Markets unavailable</div>';
  } catch { b.innerHTML = '<div class="muted small">Markets unavailable</div>'; }
}
(() => { const r = document.querySelector("#wxRefresh"); if (r) r.onclick = () => { loadWeather(); loadMarkets(); }; })();

/* ---- boot ---- */
setTimeout(() => { Convos.init(); Ctx.init(); loadCmdData(); }, 300);
