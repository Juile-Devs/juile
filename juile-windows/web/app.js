"use strict";
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const enc = encodeURIComponent;

const transcript = $("#transcript");
const circles = $("#circles");
const CIRC = [...circles.children];

/* ---- icons (no emojis anywhere) ---- */
const CABLE = `<svg viewBox="0 0 24 24"><path d="M7 2v5M17 2v5M6 7h12v3a6 6 0 0 1-12 0V7zM12 16v6"/></svg>`;
const SEND_ARROW = `<svg viewBox="0 0 24 24" fill="#111"><path d="M12 2L4 20l8-4 8 4z"/></svg>`;
const STOP_SQUARE = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="#111"/></svg>`;
const FORCE = `<svg viewBox="0 0 24 24"><path d="M5 12h13M12 6l6 6-6 6"/></svg>`;
const WARN = `<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const BULB = `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.4 1 2.5h6c0-1.1.2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>`;
const GMAIL = `<svg viewBox="0 0 48 48"><path fill="#4caf50" d="M45 16.2l-5 4.8V40h7c1 0 1-.9 1-1V11z"/><path fill="#1e88e5" d="M3 16.2l5 4.8V40H1c-1 0-1-.9-1-1V11z"/><path fill="#e53935" d="M40 11l-16 12L8 11v6l16 12 16-12z"/><path fill="#c62828" d="M3 11l5 4 .9 7.5L3 17z"/><path fill="#fbc02d" d="M45 11l-5 4-.9 7.5L45 17z"/></svg>`;

const EFFORTS = ["low", "medium", "high", "extra", "max"];
const EFFORT_LABELS = ["Low Effort", "Medium Effort", "High Effort", "Extra Effort", "Max Effort"];

let settings = { provider: "openai", model: "", permission_mode: "ask", effort: "max", imode: "agent", speed: "extended" };
let cfg = null;
let pendingAttachments = [];
let ws = null;
let ttsOn = false, soundOn = true, ttsVoice = "en-US-AriaNeural", ttsRate = "+0%", ttsPitch = "+0Hz";
let busy = false, manualStop = false;
let queue = [];

/* ============ circle state ============ */
const BASE_H = 116, GROW_H = 152;
let suppressStatus = false;
function setState(s) { circles.dataset.state = (s === "idle" ? "" : s); }
function setBusyState() { if (circles.dataset.state !== "speak") setState("busy"); }
function setHeights(a) { CIRC.forEach((c, i) => { c.style.height = (BASE_H + Math.max(0, Math.min(1, a[i] || 0)) * GROW_H).toFixed(1) + "px"; }); }
function clearHeights() { CIRC.forEach((c) => { c.style.height = ""; }); }

/* ============ audio: sound FX ============ */
let audioCtx;
function ac() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); return audioCtx; }
function beep(f, d, type = "sine", g = 0.05, slide = null) {
  if (!soundOn) return;
  try { const c = ac(), o = c.createOscillator(), gn = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d); gn.gain.setValueAtTime(g, c.currentTime); gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d); o.connect(gn); gn.connect(c.destination); o.start(); o.stop(c.currentTime + d); } catch {}
}
const sfxSend = () => beep(620, 0.10, "sine", 0.05, 920);
const sfxReceive = () => { beep(540, 0.10, "sine", 0.045); setTimeout(() => beep(760, 0.12, "sine", 0.045), 95); };
const sfxAction = () => beep(300, 0.05, "triangle", 0.04);
const sfxError = () => beep(180, 0.28, "sawtooth", 0.05, 110);

/* ============ websocket ============ */
function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onclose = () => { showStatus("reconnecting", false); setTimeout(connect, 1000); };
  ws.onopen = () => { hideStatus(); if (window.Convos) Convos.syncServer(); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

/* ============ status ============ */
function forceStatus(t, err) { const s = $("#jstatus"); s.textContent = t; s.classList.remove("hidden"); s.classList.toggle("err", !!err); }
function showStatus(t, err) { if (suppressStatus) return; forceStatus(t, err); }
function hideStatus() { $("#jstatus").classList.add("hidden"); }

/* ============ live render ============ */
let livePre = null, thinkActive = false, thinkStart = 0;
function ensureLive() { if (!livePre) { const m = el("div", "msg juile"); livePre = el("pre", "live"); m.appendChild(livePre); transcript.appendChild(m); scroll(); } return livePre; }
function startThinking() { if (!thinkActive) { thinkActive = true; thinkStart = Date.now(); } showStatus("Thinking"); setBusyState(); }
function fmtThought(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `Thought for ${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60), r = s % 60;
  let out = `Thought for ${m} minute${m === 1 ? "" : "s"}`;
  if (r) out += ` and ${r} second${r === 1 ? "" : "s"}`;
  return out;
}
function finishThink() {
  if (thinkActive) {
    transcript.appendChild(el("div", "thought", BULB + "<span>" + fmtThought(Date.now() - thinkStart) + "</span>"));
    thinkActive = false; scroll();
  }
}
function finishThinkSilent() { thinkActive = false; }
function dropLive() { if (livePre) { livePre.parentElement.remove(); livePre = null; } }

function handle(e) {
  // parallel tasks: track running + capture results for non-active conversations
  if (e.type === "done" && e.conv_id && window._running) { window._running.delete(e.conv_id); if (window.renderConvPanel) renderConvPanel(); }
  if (e.conv_id && window.Convos && e.conv_id !== Convos.activeId()) {
    if (e.type === "final" && Convos.appendAssistantTo) Convos.appendAssistantTo(e.conv_id, e.text);
    return;   // don't render another conversation's live stream into this one
  }
  switch (e.type) {
    case "hello": settings = e.settings; refreshChip(); break;
    case "settings": settings = e.settings; refreshChip(); break;
    case "speaking": break;
    case "status": if (e.state === "thinking") startThinking(); break;
    case "think_token": startThinking(); break;
    case "token": finishThink(); hideStatus(); setBusyState(); ensureLive().textContent += e.text; scroll(); break;
    case "assistant_note": finishThinkSilent(); transcript.appendChild(el("div", "note", escapeHtml(e.text))); scroll(); break;
    case "drop_live": dropLive(); break;
    case "action": finishThinkSilent(); showStatus(statusWord(e.tool, e.args)); setBusyState(); sfxAction(); dropLive(); addAction(e.tool, e.args); break;
    case "action_result": resolveAction(e.tool, e.result); break;
    case "final": finishThink(); hideStatus(); sfxReceive(); finalize(e.text); break;
    case "error": finishThink(); hideStatus(); sfxError(); transcript.appendChild(el("div", "errbox", WARN + "<span>" + escapeHtml(e.text) + "</span>")); scroll(); break;
    case "stopped": stopSpeak(); break;
    case "done": setBusyUI(false); if (manualStop) { manualStop = false; setState("idle"); } else { if (!isSpeaking()) setState("idle"); dequeueNext(); } break;
    case "permission_request": askPermission(e); break;
    case "remote_text": input.value = e.text || ""; autosize(); if (e.send !== false && !busy) doSend(); break;
    case "ask": showAsk(e.id, e.spec); break;
    case "plan": showPlan(e.title, e.steps); break;
    case "subagents": showAgents(e.agents); break;
    case "subagent_update": updateAgent(e.idx, e.result); break;
    case "slides_progress": showSlidesProgress(e); break;
    case "slides_done": showSlidesDone(e); break;
  }
}
function finalize(text) {
  let acts = [];
  const clean = text.replace(/```actions\s*([\s\S]*?)```/g, (m, body) => { try { const a = JSON.parse(body.trim()); if (Array.isArray(a)) acts = acts.concat(a); } catch {} return ""; }).trim();
  const container = livePre ? livePre.parentElement : (() => { const m = el("div", "msg juile"); transcript.appendChild(m); return m; })();
  container.innerHTML = ""; container.className = "msg juile"; container.appendChild(renderMarkdown(clean)); livePre = null; scroll(); speak(clean);
  if (window.Convos) {
    Convos.onAssistant(clean); const aidx = Convos.len() - 1;
    const bar = msgActions([{ title: "Regenerate", icon: IC_REGEN, fn: () => regenerateMsg(aidx) }, { title: "Copy", icon: IC_COPY, fn: (b) => copyText(clean, b) }]);
    acts.slice(0, 5).forEach((a) => bar.appendChild(makeDynIcon(a)));
    container.appendChild(bar);
  }
}

const IC_EDIT = `<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const IC_COPY = `<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`;
const IC_REGEN = `<svg viewBox="0 0 24 24"><path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;
function msgActions(items) {
  const bar = el("div", "msgacts");
  items.forEach((it) => { const b = el("button", "msgact"); b.title = it.title; b.innerHTML = it.icon; b.onclick = (e) => { e.stopPropagation(); it.fn(b); }; bar.appendChild(b); });
  return bar;
}
function copyText(text, btn) { try { navigator.clipboard.writeText(text); if (btn) { const o = btn.innerHTML; btn.innerHTML = "✓"; setTimeout(() => (btn.innerHTML = o), 1000); } } catch {} }
function attachUserActions(um, idx, text) {
  um.appendChild(msgActions([
    { title: "Edit", icon: IC_EDIT, fn: () => editUserMsg(um, idx, text) },
    { title: "Copy", icon: IC_COPY, fn: (b) => copyText(text, b) },
  ]));
}
function editUserMsg(um, idx, oldText) {
  um.innerHTML = "";
  const ta = el("textarea", "editta"); ta.value = oldText;
  const row = el("div", "editrow");
  const cancel = el("button", "editbtn ghost", "Cancel"); const save = el("button", "editbtn", "Save & resend");
  cancel.onclick = () => { um.innerHTML = ""; um.appendChild(el("span", "umtext", escapeHtml(oldText))); attachUserActions(um, idx, oldText); };
  save.onclick = () => { const t = ta.value.trim(); if (!t) return; if (window.Convos) Convos.rewindTo(idx); sendNow(t); };
  row.append(cancel, save); um.append(ta, row); ta.focus();
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save.onclick(); } };
}
function regenerateMsg(aidx) {
  const m = window.Convos ? Convos.msgAt(aidx - 1) : null;
  if (!m || m.role !== "user") return;
  Convos.rewindTo(aidx - 1); sendNow(m.text);
}
/* dynamic action icons Juile can attach to its replies (pixelated-shader colored) */
const ICONLIB = {
  rocket: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 13c-1.5.5-3 2-3 6 4 0 5.5-1.5 6-3l-3-3zm9.5-9.5C12 6 9 11 9 11l4 4s5-3 7.5-5.5C22 8 22 4 22 2c-2 0-6 0-7.5 1.5zM16 8a2 2 0 1 1-2-2 2 2 0 0 1 2 2z"/></svg>',
  star: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.3 18.2 21l-1.7-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z"/></svg>',
  code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  image: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z"/></svg>',
  expand: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h7v2H6v5H4V4zm16 0v7h-2V6h-5V4h7zM4 13h2v5h5v2H4v-7zm14 0h2v7h-7v-2h5v-5z"/></svg>',
  bolt: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  brain: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 0-4 4 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 4 2 3 3 0 0 0 4-2 3 3 0 0 0 2-5 3 3 0 0 0-2-5 4 4 0 0 0-4-4z"/></svg>',
  doc: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  chart: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3v18h18v-2H5V3H3zm4 12h2v4H7v-4zm4-6h2v10h-2V9zm4 3h2v7h-2v-7zm4-6h2v13h-2V6z"/></svg>',
  wand: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 9l-1.3 2.7L15 13l2.7 1.3L19 17l1.3-2.7L23 13l-2.7-1.3zM7.5 5.6 5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7zM11.3 11.3l1.4 1.4L4 21.4 2.6 20z"/></svg>',
  folder: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};
function makeDynIcon(a) {
  const b = el("button", "msgact dynicon"); b.title = a.label || a.prompt || "";
  const sp = document.createElement("span"); sp.className = "dyn";
  sp.style.setProperty("--m", `url("data:image/svg+xml,${encodeURIComponent(ICONLIB[a.icon] || ICONLIB.bolt)}")`);
  b.appendChild(sp);
  b.onclick = (e) => { e.stopPropagation(); const p = a.prompt || a.label || ""; if (!p) return; input.value = p; doSend(); };
  return b;
}

/* ============ tool-call status (NO boxes) + activity log ============ */
function prettyTool(tool, args) {
  if (tool === "mcp") {
    const map = { composio: "Composio MCP", zapier: "Zapier MCP", higgsfield: "Higgsfield" };
    return map[(args.server || "").toLowerCase()] || (args.server || "MCP");
  }
  const names = { web_search: "Web Search", deep_research: "Deep Research", write_file: "Write", create_file: "Create File", read_file: "Read", list_dir: "List", create_xlsx: "Spreadsheet", make_dir: "New Folder", move_path: "Move", copy_path: "Copy", delete_path: "Delete", python: "Python", shell: "Shell", computer: "Computer", open_app: "Open App", skill: "Skill", remember: "Remember", make_plan: "Plan", spawn_agents: "Sub-agents", ask_user: "Question" };
  return names[tool] || (tool.charAt(0).toUpperCase() + tool.slice(1));
}
function statusWord(tool, args) {
  if (tool === "web_search" || tool === "deep_research" || (tool === "mcp" && args.op === "list")) return "Searching";
  if (tool === "mcp" && /generate_image|edit_image|generate_video|slides/i.test(args.tool || "")) return "Manifesting";
  if (tool === "write_file" || tool === "create_file" || tool === "create_xlsx") return "Writing";
  if (tool === "spawn_agents") return "Delegating";
  return "Working";
}
let actionQueue = [];
function isImageGen(tool, args) {
  return tool === "mcp" && args && (args.server || "").toLowerCase() === "higgsfield"
    && /generate_image|edit_image/i.test(args.tool || "");
}
/* placeholder image card with the sweeping "Creating Image…" shimmer */
function buildCreatingCard() {
  const card = el("div", "imgcard creating");
  card.appendChild(el("div", "imgcreating", '<span class="shimtext">Creating Image…</span>'));
  return card;
}
/* swap the placeholder for the finished image (image fills the card, label + Recreate layered on top) */
function fillImageCard(card, url, args) {
  const p = (args && args.arguments && args.arguments.params) || {};
  card.classList.remove("creating"); card.innerHTML = "";
  const img = document.createElement("img"); img.src = url; img.loading = "lazy"; img.alt = "image";
  const aspect = p.aspect_ratio || "";
  card.appendChild(img);
  card.appendChild(el("div", "imgtag", escapeHtml("Nano Banana Pro" + (aspect ? " - " + aspect : ""))));
  const btn = el("button", "imgrecreate", "Recreate Image");
  const prompt = p.prompt || "";
  btn.onclick = () => { input.value = "Create an image" + (prompt ? ": " + prompt : ""); autosize(); doSend(); };
  card.appendChild(btn);
}
function addAction(tool, args) {
  const item = { tool, args, t0: Date.now() };
  if (isImageGen(tool, args)) { item.card = buildCreatingCard(); transcript.appendChild(item.card); scroll(); }
  const line = el("div", "toolline");
  line.innerHTML = `<span class="tlmain">Calling <b>${escapeHtml(prettyTool(tool, args))}</b>…</span> <span class="tltime"></span>`;
  transcript.appendChild(line);
  item.line = line;
  item.timer = setInterval(() => { const t = line.querySelector(".tltime"); const s = Math.round((Date.now() - item.t0) / 1000); if (t) t.textContent = s > 0 ? s + "s" : ""; }, 300);
  actionQueue.push(item); addLog(tool); scroll();
}
function resolveAction(tool, result) {
  const ctx = actionQueue.shift() || { tool, args: {} };
  result = result || "";
  const err = /^error|exception|denied/i.test(result.trim());
  if (ctx.timer) clearInterval(ctx.timer);
  const secs = ctx.t0 ? Math.max(1, Math.round((Date.now() - ctx.t0) / 1000)) : 0;
  const line = ctx.line;
  const diff = result.match(/\[\[DIFF:(.+?):(\d+):(\d+)\]\]/);
  if (line) {
    if (err) line.classList.add("err");
    if (diff && !err) {
      const name = diff[1], added = +diff[2], removed = +diff[3];
      const verb = /^Updated/.test(result) ? "Edited file" : "Created";
      line.classList.add("tlfile");
      line.innerHTML = `<span class="tlmain">${verb} <b>${escapeHtml(name)}</b></span> <span class="tldiff"><span class="dfadd">+${added}</span> <span class="dfdel">-${removed}</span></span>`;
      const openb = el("button", "tlopen", "Open"); openb.onclick = (e) => { e.stopPropagation(); fetch("/api/reveal?name=" + enc(name)); };
      line.appendChild(openb);
      const body = el("pre", "diffbody"); body.style.display = "none"; let loaded = false;
      line.onclick = async () => {
        if (body.style.display === "none") { body.style.display = "block"; if (!loaded) { loaded = true; try { const j = await (await fetch("/api/diff?name=" + enc(name))).json(); body.innerHTML = colorizeDiff(j.diff); } catch { body.textContent = "(diff unavailable)"; } } }
        else body.style.display = "none";
      };
      line.after(body);
    } else {
      const t = line.querySelector(".tltime"); if (t) t.textContent = secs ? secs + "s" : "";
    }
  }
  if (ctx.card) {
    const img = result.match(/\[\[IMG:(.+?)\]\]/);
    if (img && !err) fillImageCard(ctx.card, img[1], ctx.args);
    else { ctx.card.classList.add("imgfailed"); const sh = ctx.card.querySelector(".shimtext"); if (sh) sh.textContent = err ? "Image failed" : "Couldn't load the image"; }
  }
  const shot = result.match(/\[\[SHOT:(.+?)\]\]/);
  const file = result.match(/\[\[FILE:(.+?)\]\]/);
  if (shot) { const img = document.createElement("img"); img.src = "/shots/" + shot[1]; img.className = "shotimg"; transcript.appendChild(img); }
  if (file) transcript.appendChild(fileCard(file[1]));
  updateLastLog(tool, result); scroll();
}
const logItems = $("#logItems");
const ts = () => new Date().toLocaleTimeString();
function addLog(tool) { const row = el("div", "logrow pending"); row.appendChild(el("div", null, `<b>${escapeHtml(tool)}</b><div class="t">${ts()}</div>`)); row._tool = tool; logItems.prepend(row); }
function updateLastLog(tool, result) { const row = [...logItems.children].find((r) => r._tool === tool && !r.dataset.done); if (row) { row.dataset.done = "1"; row.className = "logrow " + (/^error|exception|denied/i.test(result.trim()) ? "err" : "done"); } }

/* ============ permission (prominent card above the composer) ============ */
function askPermission(e) {
  const menu = $("#permMenu"); menu.classList.remove("hidden"); menu.innerHTML = "";
  menu.appendChild(el("div", "permtitle", "Allow this action?"));
  menu.appendChild(el("div", "permtool", "<span>" + escapeHtml("Run " + prettyTool(e.tool, e.args)) + "</span>"));
  const argstr = JSON.stringify(e.args || {}, null, 2);
  if (argstr && argstr !== "{}") menu.appendChild(el("div", "permargs", escapeHtml(argstr)));
  const foot = el("div", "permfoot");
  const yes = el("button", "permyes", "Allow");
  const no = el("button", "permno", "Deny");
  const close = () => { menu.classList.add("hidden"); menu.innerHTML = ""; };
  yes.onclick = () => { send({ type: "permission", id: e.id, approve: true }); close(); };
  no.onclick = () => { send({ type: "permission", id: e.id, approve: false }); close(); };
  foot.append(no, yes); menu.appendChild(foot); scroll();
}

/* ============ markdown + widgets ============ */
marked.setOptions({ breaks: true, gfm: true });
const CARD_COLORS = { blue: "#c4ddf5", pink: "#f9bcbc", red: "#f9bcbc", green: "#bfe6c6", purple: "#d9c8f7", orange: "#ffd9a8", yellow: "#fbe7a8", grey: "#dcdce2", gray: "#dcdce2" };
function renderMarkdown(text) {
  const ww = text.replace(/```(chart|table|email|steps|cards|svg|sim|image|slides|panel|callout|meter|columns|quote)[ \t]*\r?\n?([\s\S]*?)```/g, (m, k, b) => `\n\n<div class="jwidget" data-kind="${k}" data-spec="${enc(b.trim())}"></div>\n\n`);
  const div = el("div", "md");
  div.innerHTML = DOMPurify.sanitize(marked.parse(ww), { ADD_ATTR: ["target", "data-kind", "data-spec"] });
  div.querySelectorAll(".jwidget").forEach(hydrate);
  return div;
}
function hydrate(node) {
  const kind = node.dataset.kind, raw = decodeURIComponent(node.dataset.spec);
  if (kind === "svg") { node.innerHTML = `<div class="blueprint">${DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })}</div>`; return; }
  if (kind === "sim") { const box = el("div", "sim"); const f = document.createElement("iframe"); f.setAttribute("sandbox", "allow-scripts allow-pointer-lock"); f.srcdoc = raw; box.appendChild(f); node.innerHTML = ""; node.appendChild(box); return; }
  let spec; try { spec = JSON.parse(raw); } catch { node.textContent = "(invalid widget)"; return; }
  node.innerHTML = "";
  if (kind === "chart") { const box = el("div", "chartbox"); const cv = document.createElement("canvas"); box.appendChild(cv); node.appendChild(box); try { new Chart(cv, spec); } catch (err) { node.textContent = "Chart error: " + err; } }
  else if (kind === "cards") { const wrap = el("div", "statcards"); (spec.items || []).forEach((it) => { const c = el("div", "statcard"); c.style.background = CARD_COLORS[it.color] || it.color || "#dcdce2"; c.appendChild(el("div", "lbl", escapeHtml(it.label || ""))); c.appendChild(el("div", "val", escapeHtml(String(it.value == null ? "" : it.value)))); wrap.appendChild(c); }); node.appendChild(wrap); }
  else if (kind === "table") node.appendChild(buildTable(spec));
  else if (kind === "email") node.appendChild(buildEmail(spec));
  else if (kind === "steps") { if (spec.title) node.appendChild(el("h3", null, escapeHtml(spec.title))); const wrap = el("div", "steps"); (spec.steps || []).forEach((s) => wrap.appendChild(el("div", "step", escapeHtml(s)))); node.appendChild(wrap); }
  else if (kind === "image") node.appendChild(buildImageCard(spec));
  else if (kind === "slides") node.appendChild(buildSlides(spec));
  else if (kind === "panel") node.appendChild(buildPanel(spec));
  else if (kind === "callout") node.appendChild(buildCallout(spec));
  else if (kind === "meter") node.appendChild(buildMeter(spec));
  else if (kind === "columns") node.appendChild(buildColumns(spec));
  else if (kind === "quote") node.appendChild(buildQuote(spec));
}
function buildCallout(spec) {
  const c = el("div", "callout"); const col = PANEL_COLORS[spec.color] || spec.color;
  if (col) { c.style.background = col; c.classList.add("light"); }
  if (spec.title) c.appendChild(el("div", "cot", escapeHtml(spec.title)));
  if (spec.body) c.appendChild(el("div", "cob", escapeHtml(spec.body)));
  return c;
}
function buildMeter(spec) {
  const wrap = el("div", "meterbox");
  if (spec.title) wrap.appendChild(el("div", "metertitle", escapeHtml(spec.title)));
  (spec.items || []).forEach((it) => {
    const v = Math.max(0, Math.min(100, Number(it.value) || 0));
    const row = el("div", "meterrow");
    row.innerHTML = `<div class="meterlbl"><span>${escapeHtml(it.label || "")}</span><span>${v}%</span></div><div class="metertrack"><div class="meterfill" style="width:${v}%;background:${PANEL_COLORS[it.color] || it.color || "#3aa0ff"}"></div></div>`;
    wrap.appendChild(row);
  });
  return wrap;
}
function buildColumns(spec) {
  const wrap = el("div", "colsbox");
  (spec.columns || []).forEach((cl) => {
    const c = el("div", "colcard");
    if (cl.title) c.appendChild(el("div", "colt", escapeHtml(cl.title)));
    if (cl.body) c.appendChild(el("div", "colb", escapeHtml(cl.body)));
    wrap.appendChild(c);
  });
  return wrap;
}
function buildQuote(spec) {
  const q = el("div", "quotebox");
  q.appendChild(el("div", "qt", escapeHtml(spec.text || "")));
  if (spec.by) q.appendChild(el("div", "qby", "— " + escapeHtml(spec.by)));
  return q;
}
let slidesCard = null;
function showSlidesProgress(e) {
  if (!slidesCard) { slidesCard = el("div", "slidegen"); transcript.appendChild(slidesCard); }
  slidesCard.innerHTML = `<div class="sgshim">Generating Slide…</div><div class="sgsub">${e.done || 0}/${e.total || 0} of pages generated</div>`;
  scroll();
}
function showSlidesDone(e) {
  const deck = buildSlides(e.deck || {});
  if (slidesCard) { slidesCard.replaceWith(deck); slidesCard = null; } else transcript.appendChild(deck);
  scroll();
}

/* generated image — fills the card; model/aspect label + Recreate button layered on top (Image 6) */
function buildImageCard(spec) {
  const card = el("div", "imgcard");
  const img = document.createElement("img"); img.src = spec.url || spec.src || ""; img.alt = spec.model || "image"; img.loading = "lazy";
  const tag = el("div", "imgtag", escapeHtml((spec.model || "Image") + (spec.aspect ? " - " + spec.aspect : "")));
  const btn = el("button", "imgrecreate", "Recreate Image");
  btn.onclick = () => { input.value = "Recreate this image" + (spec.prompt ? ": " + spec.prompt : ""); autosize(); doSend(); };
  card.append(img, tag, btn);
  return card;
}

/* vivid built-in backgrounds so a deck looks great with no generated images */
const SLIDE_GRADIENTS = [
  "linear-gradient(135deg,#2d6cff,#7b3ff2)", "linear-gradient(135deg,#0ea5e9,#2563eb)",
  "linear-gradient(135deg,#7b3ff2,#db2777)", "linear-gradient(135deg,#f97316,#db2777)",
  "linear-gradient(135deg,#059669,#0ea5e9)", "linear-gradient(135deg,#1e3a8a,#0f766e)",
  "linear-gradient(135deg,#9333ea,#4f46e5)", "linear-gradient(135deg,#0891b2,#1d4ed8)",
];
/* beautiful slide deck — 16:9 cards in a swipeable strip */
function buildSlides(spec) {
  const wrap = el("div", "slidedeck");
  if (spec.title) wrap.appendChild(el("div", "deckhead", escapeHtml(spec.title)));
  const strip = el("div", "deckstrip");
  (spec.slides || []).forEach((s, i) => {
    const slide = el("div", "slide");
    if (s.image) { const im = document.createElement("img"); im.className = "slideimg"; im.src = s.image; im.loading = "lazy"; slide.appendChild(im); }
    else { slide.style.background = SLIDE_GRADIENTS[i % SLIDE_GRADIENTS.length]; }
    const body = el("div", "slidebody");
    body.appendChild(el("div", "slidenum", String(i + 1)));
    if (s.title) body.appendChild(el("div", "slidetitle", escapeHtml(s.title)));
    if (s.bullets && s.bullets.length) { const ul = el("ul", "slidebullets"); s.bullets.forEach((b) => ul.appendChild(el("li", null, escapeHtml(b)))); body.appendChild(ul); }
    else if (s.body) body.appendChild(el("div", "slidetext", escapeHtml(s.body)));
    slide.appendChild(body); strip.appendChild(slide);
  });
  wrap.appendChild(strip);
  return wrap;
}

/* rich reference-style panel — colored section cards (Images 4/5) */
const PANEL_COLORS = { purple: "#d9c8f7", green: "#bfe6c6", red: "#f9c3bc", pink: "#f9bcdb", orange: "#ffd9a8", blue: "#c4ddf5", yellow: "#fbe7a8", grey: "#dcdce2", gray: "#dcdce2" };
function buildPanel(spec) {
  const wrap = el("div", "refpanel");
  if (spec.title) wrap.appendChild(el("div", "refhead", escapeHtml(spec.title)));
  const grid = el("div", "refgrid");
  (spec.sections || []).forEach((s) => {
    const c = el("div", "refcard"); c.style.background = PANEL_COLORS[s.color] || s.color || "#1d1d20";
    const light = !!PANEL_COLORS[s.color]; if (light) c.classList.add("light");
    if (s.title) c.appendChild(el("div", "rct", escapeHtml(s.title)));
    if (s.body) c.appendChild(el("div", "rcb", escapeHtml(s.body)));
    grid.appendChild(c);
  });
  wrap.appendChild(grid);
  if (spec.footer) wrap.appendChild(el("div", "reffoot", escapeHtml(spec.footer)));
  return wrap;
}
function buildTable(spec) {
  const wrap = el("div", "dtable"); const bar = el("div", "topbar"); const btn = el("button", null, "Export CSV"); bar.appendChild(btn); wrap.appendChild(bar);
  const tbl = document.createElement("table"); const cols = spec.columns || [];
  tbl.innerHTML = "<thead><tr>" + cols.map((c) => `<th>${escapeHtml(String(c))}</th>`).join("") + "</tr></thead>";
  const tb = document.createElement("tbody"); (spec.rows || []).forEach((r) => { tb.innerHTML += "<tr>" + r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("") + "</tr>"; });
  tbl.appendChild(tb); wrap.appendChild(tbl);
  btn.onclick = () => { const csv = [cols, ...(spec.rows || [])].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"); const a = el("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "table.csv"; a.click(); };
  return wrap;
}
function buildEmail(spec) {
  const wrap = el("div", "email");
  wrap.appendChild(el("div", "ehead", `<div><span class="lbl">To</span>${escapeHtml(spec.to || "")}</div><div><span class="lbl">Subject</span>${escapeHtml(spec.subject || "")}</div>`));
  wrap.appendChild(el("div", "ebody", escapeHtml(spec.body || "")));
  const foot = el("div", "efoot"); const btn = el("button", "gmail-btn", GMAIL + "<span>Send to Gmail</span>");
  btn.onclick = () => window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${enc(spec.to || "")}&su=${enc(spec.subject || "")}&body=${enc(spec.body || "")}`, "_blank");
  foot.appendChild(btn); wrap.appendChild(foot); return wrap;
}

/* ============ TTS (neural) + amplitude → circle height ============ */
let curSrc = null, curRaf = 0;
function isSpeaking() { return circles.dataset.state === "speak"; }
function stopSpeak() { try { if (curSrc) curSrc.stop(); } catch {} curSrc = null; cancelAnimationFrame(curRaf); if (window.speechSynthesis) speechSynthesis.cancel(); clearHeights(); if (isSpeaking()) setState(busy ? "busy" : "idle"); }
const stripForSpeech = (t) => t.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/[#*_>`|]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/\n{2,}/g, ". ").trim().slice(0, 1100);
/* small per-utterance variation so the voice feels alive, not canned */
function jitter(base, span, unit) { const m = /^([+-])(\d+)/.exec(base) || ["", "+", "0"]; const v = (m[1] === "-" ? -1 : 1) * (+m[2]); const j = v + Math.round((Math.random() * 2 - 1) * span); return (j >= 0 ? "+" : "") + j + unit; }
async function speak(text) {
  if (!ttsOn) return;
  stopSpeak();
  const clean = stripForSpeech(text); if (!clean) return;
  try {
    const c = ac();
    const rate = jitter(ttsRate, 4, "%"), pitch = jitter(ttsPitch, 4, "Hz");
    const r = await fetch(`/api/tts?voice=${enc(ttsVoice)}&rate=${enc(rate)}&pitch=${enc(pitch)}&text=${enc(clean)}`);
    if (!r.ok) throw new Error("tts " + r.status);
    const audio = await c.decodeAudioData(await r.arrayBuffer());
    const src = c.createBufferSource(); src.buffer = audio;
    const an = c.createAnalyser(); an.fftSize = 64; an.smoothingTimeConstant = 0.78;
    src.connect(an); an.connect(c.destination); curSrc = src;
    const data = new Uint8Array(an.frequencyBinCount); setState("speak");
    const WEIGHT = [1, 1.5, 2.1, 3.0]; let fr = 0;
    const tick = () => {
      an.getByteFrequencyData(data); fr++;
      let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(1, (sum / data.length) / 90);     // overall loudness -> ALL circles react
      const h = [];
      for (let k = 0; k < 4; k++) {
        let s = 0; for (let i = 0; i < 6; i++) s += data[2 + k * 6 + i] || 0;
        const band = Math.min(1, ((s / 6) / 255) * WEIGHT[k]);  // per-circle character
        h[k] = Math.min(1, level * 0.5 + band * 0.7) * (0.85 + 0.15 * Math.sin(fr * 0.3 + k * 1.7));
      }
      setHeights(h); curRaf = requestAnimationFrame(tick);
    };
    tick();
    src.onended = () => { cancelAnimationFrame(curRaf); clearHeights(); curSrc = null; setState(busy ? "busy" : "idle"); };
    src.start();
  } catch { fallbackSpeak(clean); }
}
function fallbackSpeak(t) {
  if (!window.speechSynthesis) { setState(busy ? "busy" : "idle"); return; }
  const u = new SpeechSynthesisUtterance(t); const v = pickVoice(); if (v) u.voice = v; u.rate = 1.0; setState("speak");
  u.onboundary = () => { const a = 0.35 + Math.random() * 0.6; setHeights([a, 0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.5, a * 0.8]); };
  u.onend = () => { clearHeights(); setState(busy ? "busy" : "idle"); };
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function pickVoice() { const vs = speechSynthesis.getVoices(); return vs.find((v) => /natural/i.test(v.name)) || vs.find((v) => /aria|jenny|guy|libby/i.test(v.name)) || vs.find((v) => v.lang === "en-US") || vs[0]; }

/* ============ compose / send / queue / stop ============ */
const input = $("#input");
function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
$("#sendBtn").onclick = () => { if (busy) stopAll(); else doSend(); };

function setBusyUI(b) { busy = b; const btn = $("#sendBtn"); btn.className = b ? "send stop" : "send arrow"; btn.innerHTML = b ? STOP_SQUARE : SEND_ARROW; btn.title = b ? "Stop Juile" : "Send"; }
function doSend() {
  const text = input.value.trim(); const mode = window.__mode || null;
  if (!text && !pendingAttachments.length && !mode) return;
  if (busy) { enqueue(text, pendingAttachments, mode); } else { sendNow(text, pendingAttachments, mode); }
  input.value = ""; autosize(); pendingAttachments = []; renderAtts(); if (window.__clearMode) window.__clearMode();
}
function sendNow(text, atts, mode) {
  atts = atts || []; mode = mode || null;
  suppressStatus = false; thinkActive = false; sfxSend(); dropLive(); showStatus("Working"); manualStop = false; setBusyUI(true); setBusyState();
  const um = el("div", "msg user");
  um.innerHTML = (mode ? `<span class="ubcap">${escapeHtml(mode.label)}</span> ` : "") + escapeHtml(text) +
    (atts.length ? `<div style="color:var(--muted);font-size:12px;margin-top:6px">Attached: ${atts.map((a) => escapeHtml(a.name)).join(", ")}</div>` : "");
  transcript.appendChild(um); scroll();
  const uidx = window.Convos ? Convos.onUser(text) : -1;
  attachUserActions(um, uidx, text);
  const sendText = mode ? (mode.prefix + " " + text).trim() : text;
  const cid = window.Convos ? Convos.activeId() : null;
  if (cid) { window._running = window._running || new Set(); window._running.add(cid); if (window.renderConvPanel) renderConvPanel(); }
  send({ type: "chat", text: sendText, attachments: atts, provider: settings.provider, model: settings.model, permission_mode: settings.permission_mode, effort: settings.effort, imode: settings.imode, speed: settings.speed, conv_id: cid });
}
function enqueue(text, atts, mode) { queue.push({ text, atts, mode }); renderQueue(); }
function renderQueue() {
  const q = $("#queue"); q.innerHTML = "";
  queue.forEach((item, i) => {
    const row = el("div", "qmsg");
    row.appendChild(el("span", "qlabel", "Queued"));
    row.appendChild(el("span", "qtext", escapeHtml(item.text)));
    const btn = el("button", "qsend", FORCE); btn.title = "Send now (interrupt)"; btn.onclick = () => forceSend(i);
    row.appendChild(btn); q.appendChild(row);
  });
}
function forceSend(i) { const item = queue.splice(i, 1)[0]; renderQueue(); if (!item) return; stopSpeak(); sendNow(item.text, item.atts, item.mode); }
function dequeueNext() { if (queue.length) { const item = queue.shift(); renderQueue(); sendNow(item.text, item.atts, item.mode); } }
function stopAll() { send({ type: "stop" }); stopSpeak(); manualStop = true; suppressStatus = true; thinkActive = false; setBusyUI(false); setState("idle"); forceStatus("Stopped"); setTimeout(() => { if (suppressStatus) hideStatus(); }, 1600); }

/* ============ attachments ============ */
$("#addBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = async (e) => { for (const f of e.target.files) { const fd = new FormData(); fd.append("file", f); try { const r = await fetch("/api/upload", { method: "POST", body: fd }); pendingAttachments.push(await r.json()); } catch {} } renderAtts(); e.target.value = ""; };
function renderAtts() {
  const box = $("#attachments"); box.innerHTML = "";
  pendingAttachments.forEach((a, i) => {
    if (a.is_image) return;
    const chip = el("div", "att", escapeHtml(a.name)); const x = el("button", null, "✕"); x.onclick = () => { pendingAttachments.splice(i, 1); renderAtts(); }; chip.appendChild(x); box.appendChild(chip);
  });
  renderImgPreview();
}
function renderImgPreview() {
  const box = $("#imgPreview"); if (!box) return; box.innerHTML = "";
  pendingAttachments.forEach((a, i) => {
    if (!a.is_image || !a.image) return;
    const p = el("div", "imgprev");
    const img = document.createElement("img"); img.src = a.image; p.appendChild(img);
    const x = el("div", "ipx", "✕"); x.onclick = () => { pendingAttachments.splice(i, 1); renderAtts(); }; p.appendChild(x);
    box.appendChild(p);
  });
  box.classList.toggle("hidden", !pendingAttachments.some((a) => a.is_image));
}

/* ============ effort dropdown + permission ============ */
const effortMenu = $("#effortMenu");
$("#effortPill").onclick = (e) => { e.stopPropagation(); effortMenu.classList.toggle("hidden"); };
effortMenu.onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => effortMenu.classList.add("hidden"));
$("#effortSlider").oninput = (e) => { const idx = +e.target.value; settings.effort = EFFORTS[idx]; $("#effortLabel").textContent = EFFORT_LABELS[idx]; send({ type: "settings", effort: settings.effort }); };
effortMenu.querySelectorAll(".dd-opt").forEach((o) => o.onclick = () => { settings.permission_mode = o.dataset.perm; refreshChip(); send({ type: "settings", permission_mode: settings.permission_mode }); beep(700, 0.05, "sine", 0.04); });

/* ============ header controls ============ */
$("#iconPlus").onclick = () => { if (window.Convos) Convos.newConversation(); else location.reload(); };
$("#iconShare").onclick = () => $("#logPanel").classList.toggle("hidden");
$("#iconTune").onclick = () => { if (typeof openSettings === "function") openSettings("providers"); };
$("#modelChip").onclick = () => openModels();
$("#greetingPill").onclick = (e) => { e.stopPropagation(); const p = document.querySelector("#convPanel"); if (p) { p.classList.toggle("open"); if (window.renderConvPanel) renderConvPanel(); } };
(() => { const w = $("#welcomeClose"); if (w) w.onclick = () => $("#wWelcome").classList.add("hidden"); })();
(() => { const pc = $("#permChip"); if (pc) pc.onclick = () => { settings.permission_mode = settings.permission_mode === "ask" ? "bypass" : "ask"; refreshChip(); send({ type: "settings", permission_mode: settings.permission_mode }); beep(700, 0.05, "sine", 0.04); }; })();
$("#phoneOpt").onclick = () => $("#phonePanel").classList.toggle("hidden");
$("#ttsToggle").onclick = () => { ttsOn = !ttsOn; $("#ttsState").textContent = ttsOn ? "on" : "off"; $("#ttsState").classList.toggle("on", ttsOn); if (!ttsOn) stopSpeak(); ac(); };
$("#sfxToggle").onclick = () => { soundOn = !soundOn; $("#sfxState").textContent = soundOn ? "on" : "off"; $("#sfxState").classList.toggle("on", soundOn); if (soundOn) sfxAction(); };
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => $("#" + b.dataset.close).classList.add("hidden")));

function prettyModel(m) { return m ? m.split("/").pop().replace(/^@cf-?/, "") : ""; }
function refreshChip() {
  const p = cfg ? cfg.providers.find((x) => x.key === settings.provider) : null;
  $("#modelChip").querySelector("b").textContent = p ? p.label : settings.provider;
  $("#modelName").textContent = prettyModel(settings.model);
  const permEl = $("#permChipText"); if (permEl) permEl.textContent = settings.permission_mode === "ask" ? "Ask before doing" : "Bypass — run freely";
  $("#ckBypass").textContent = settings.permission_mode === "bypass" ? "●" : "";
  $("#ckAsk").textContent = settings.permission_mode === "ask" ? "●" : "";
  const ei = EFFORTS.indexOf(settings.effort || "max"); if (ei >= 0) { $("#effortSlider").value = ei; $("#effortLabel").textContent = EFFORT_LABELS[ei]; }
}

/* ============ model picker ============ */
function openModels() { const pn = $("#modelPanel"); pn.classList.toggle("hidden"); if (cfg && !pn.classList.contains("hidden")) renderProviders(); }
function renderProviders() {
  const list = $("#providerList"); list.innerHTML = "";
  cfg.providers.forEach((p) => { const o = el("div", "opt" + (p.key === settings.provider ? " sel" : ""), `<span>${escapeHtml(p.label)}</span><span class="badge ${p.configured ? "on" : ""}">${p.configured ? "ready" : "no key"}</span>`); o.onclick = () => { settings.provider = p.key; renderProviders(); loadModels(p.key, p.models); }; list.appendChild(o); });
  const cur = cfg.providers.find((x) => x.key === settings.provider); loadModels(settings.provider, cur ? cur.models : []);
}
async function loadModels(provider, fallback) {
  const list = $("#modelList"); list.innerHTML = `<div class="muted" style="padding:8px">Loading…</div>`;
  let models = fallback || [];
  try { const r = await fetch(`/api/models?provider=${provider}`); const j = await r.json(); if (j.models && j.models.length) models = j.models; } catch {}
  list.innerHTML = "";
  models.forEach((m) => { const o = el("div", "opt" + (m === settings.model ? " sel" : ""), `<span>${escapeHtml(m)}</span>`); o.onclick = () => { settings.model = m; settings.provider = provider; refreshChip(); send({ type: "settings", provider, model: m }); $("#modelPanel").classList.add("hidden"); }; list.appendChild(o); });
  if (!models.length) list.innerHTML = `<div class="muted" style="padding:8px">No models (start LM Studio, or check key).</div>`;
}

/* ============ misc ============ */
function scroll() { transcript.scrollTop = transcript.scrollHeight; }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function applyVoice(s) {
  if (!s) return;
  if (s.tts_voice) ttsVoice = s.tts_voice;
  if (s.tts_rate) ttsRate = s.tts_rate;
  if (s.tts_pitch) ttsPitch = s.tts_pitch;
}
window.applyVoice = applyVoice;
async function init() {
  setBusyUI(false);
  try {
    cfg = await (await fetch("/api/config")).json();
    settings.provider = cfg.default_provider; settings.model = cfg.default_model; settings.permission_mode = cfg.permission_mode; settings.effort = "max";
    $("#lanUrl").textContent = cfg.lan_url; $("#qr").src = "/qr.png?" + Date.now();
    refreshChip();
  } catch {}
  try { applyVoice(await (await fetch("/api/settings")).json()); } catch {}
  connect();
}
init();
