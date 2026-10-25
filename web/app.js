// Console theatre: five bays, one in focus. Same API, different shape.
import { cue, start as startAudio, bootCue, audioState, standbyOn, standbyOff, setMuted, isMuted } from "/audio.js";

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (n ?? 0).toLocaleString();
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COLUMNS = ["backlog", "next", "doing", "done"];
const ENGINES = {
  "1": { name: "strata-flash-coder-150k", ctx: "150k" },
  "2": { name: "swift-27b-120k-MTP", ctx: "120k" },
  "3": { name: "swift-27b-131k", ctx: "131k" },
  "4": { name: "swift-27b-80k-MTP", ctx: "80k" },
  "5": { name: "old-27b-128k", ctx: "131k" },
  "6": { name: "flash-next-262k", ctx: "262k" },
};
let state = null;
let lastSig = "";
let lastRender = 0;
let open = (new URLSearchParams(location.search).get("bay")) || "status";
let results = [];
const hist = [];
let projectFilter = "";

/* ---------- bay views ---------- */
const BAYS = [
  { id: "status", label: "status", glyph: "S", note: "what needs you",
    number: (s) => (s.alerts.length ? `${s.alerts.length}` : "nominal"),
    unit: (s) => (s.alerts.length ? "alerts" : ""), render: renderStatus },
  { id: "telemetry", label: "telemetry", glyph: "T", note: "card, ram, engines",
    number: (s) => (s.gpu.present ? fmt(s.gpu.free_mib) : "--"), unit: () => "MiB free",
    render: renderTelemetry },
  { id: "archive", label: "archive", glyph: "A", note: "notes and recall",
    number: (s) => fmt(totalNotes(s)), unit: () => "notes", render: renderArchive },
  { id: "berth", label: "berth", glyph: "B", note: "projects and cards",
    number: (s) => `${s.projects.length}`, unit: () => "projects", render: renderBerth },
  { id: "terminal", label: "terminal", glyph: "C", note: "opencode conversation",
    number: () => `${chat.length}`, unit: () => "messages", render: renderTerminal },
  { id: "procedures", label: "procedures", glyph: "P", note: "board and runs",
    number: (s) => `${(s.board.doing || []).length}`, unit: () => "in progress",
    render: renderProcedures },
];

const totalNotes = (s) => (s.knowledge.domains || []).reduce((a, d) => a + d.notes, 0);

function meter(used, total) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  return `<div class="meter"><i style="width:${pct}%"></i></div>`;
}

function captureBar() {
  return `<div class="panel"><h3>capture</h3><div class="adder">
    <input id="cap" placeholder="one line - task or finding">
    <button data-act="capture-card">card</button>
    <button data-act="capture-note">note</button>
  </div></div>`;
}

function renderStatus(s) {
  const needs = s.needs || [];
  const list = needs.length
    ? needs.map((n) => `<div class="row ${n.kind === "alert" ? "bad" : ""}"> - ${esc(n.text)}</div>`).join("")
    : `<div class="row ok">nothing waiting on you</div>`;
  const log = (s.activity || []).map(esc).join("\n") || "idle";
  const cap = captureBar();
  return cap + `<div class="panel"><h3>needs you</h3>${list}</div>
          <div class="panel"><h3>timeline</h3>${(s.timeline || []).map((e) =>
            `<div class="row dim">${e.kind} - ${esc(e.text)}</div>`).join("") || `<div class="row dim">idle</div>`}</div>`;
}

function renderTelemetry(s) {
  const g = s.gpu, r = s.ram;
  const gpu = g.present
    ? `<div class="big"><span data-live="vram-free">${fmt(g.free_mib)}</span><small>MiB free of ${fmt(g.total_mib)}</small></div>
       ${meter(g.used_mib, g.total_mib)}
       <div class="row">${esc(g.name)}  - util ${g.util_pct}%  - ${g.power_w ?? "--"} W</div>`
    : `<div class="row">no NVIDIA device</div>`;
  const managed = s.managed || {};
  const engines = Object.entries(ENGINES).map(([key, spec]) => {
    const rec = managed[key];
    const up = rec && rec.alive;
    return `<div class="engine" data-act="engine" data-key="${key}" data-op="${up ? "stop" : "start"}"><span class="name">[${key}] ${spec.name} <span class="dim">${spec.ctx}</span></span>
      <span class="state ${up ? "up" : ""}">${up ? "running" : "stopped"}</span>
      <button data-act="engine" data-key="${key}" data-op="${up ? "stop" : "start"}"
        class="${up ? "danger" : ""}">${up ? "stop" : "start"}</button></div>`;
  }).join("");
  const ports = s.ports.map((p) => `<span class="${p.open ? "on" : ""}">:${p.port} ${p.what}</span>`).join("");
  return `<div class="panel"><h3>card</h3>${gpu}</div>
    <div class="grid2">
      <div class="panel"><h3>memory</h3><div class="big"><span data-live="ram">${fmt(r.available_mib)}</span><small>MiB</small></div>
        ${meter(r.total_mib - r.available_mib, r.total_mib)}<div class="row" data-live="ram-row">load ${r.load_pct}%</div></div>
      <div class="panel"><h3>storage</h3><div class="big"><span data-live="disk">${s.disk.free_gib}</span><small>GiB</small></div>
        <div class="row">${s.disk.drive} volume</div></div>
    </div>
    <div class="panel"><h3>engines</h3><div class="ports">${ports}</div>${engines}</div>
    <div class="panel"><h3>models on disk</h3>${(s.models || []).map((m) =>
      `<div class="row file" data-open="${esc(m.path || "")}"><span class="dim">${m.gib} GiB</span> - ${esc(m.name)}</div>`).join("")
      || `<div class="row dim">none</div>`}</div>
    <div class="panel"><h3>vram free - last ${hist.length} samples</h3><div data-live="spark">${spark(hist)}</div></div>`;
}

function spark(values) {
  if (values.length < 2) return `<div class="row dim">collecting samples - </div>`;
  const w = 260, h = 44;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) =>
    `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="#ffb000" stroke-width="1.1" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function renderArchive(s) {
  const domains = (s.knowledge.domains || []).map((d) =>
    `<div class="d">${d.name}<span>${d.notes}</span></div>`).join("");
  const recent = (s.recent || []).map((r) => `<div class="r" data-open="${esc(r.path || "")}">${r.updated} - ${esc(r.note)}</div>`).join("");
  const hits = results.length
    ? results.map((r) => `<div class="hit"><b>${r.score.toFixed(2)}</b> ${esc(r.note)}<br>${esc(r.answers)}</div>`).join("")
    : "";
  return `<div class="panel"><h3>recall</h3>
      <div class="adder"><input id="q" placeholder="ask in words - BM25 ranks the notes">
      <button data-act="search">search</button></div>${hits}</div>
    <div class="grid2"><div class="panel"><h3>domains</h3>${domains}</div>
      <div class="panel"><h3>recent</h3>${recent}</div></div>`;
}

function renderBerth(s) {
  return (s.projects || []).map((p) => `<div class="panel" data-proj="${esc(p.slug)}" style="cursor:pointer">
      <h3>${esc(p.slug)}</h3>
      <div class="row">${esc(p.title)}</div>
      <div class="row dim">${esc(p.answers)}</div>
      <div class="row dim">${p.open} open card(s)</div></div>`).join("")
    || `<div class="row dim">no project overlays</div>`;
}

function renderProcedures(s) {
  const board = s.board || {};
  const filter = projectFilter.toLowerCase();
  const chip = filter
    ? `<div class="row dim">project: ${esc(projectFilter)} <button data-act="clear-filter">clear</button></div>`
    : "";
  const cols = COLUMNS.map((column) => {
    const cards = (board[column] || []).filter((c) => !filter || (c.project || "").toLowerCase() === filter);
    const items = cards.map((c) => `<div class="card">
        <div class="t">${esc(c.title)}</div>
        <div class="meta"><span>${esc(c.project || " - ")}</span><span>${c.date || ""}</span></div>
        <div class="acts">
          <button data-act="card" data-id="${c.id}" data-op="left"> - </button>
          <button data-act="card" data-id="${c.id}" data-op="right"> - </button>
          <button data-act="card" data-id="${c.id}" data-op="done"> - "</button>
          <button class="danger" data-act="card" data-id="${c.id}" data-op="delete"> - </button>
        </div></div>`).join("");
    return `<div class="column"><h3>${column}<span>${cards.length}</span></h3>${items || '<div class="empty">empty</div>'}</div>`;
  }).join("");
  const flows = `<div class="panel"><h3>workflows</h3>` + (window.__flows || []).map((f) =>
      `<div class="row"><button data-act="flow" data-name="${f.name}">run</button> ${f.label}</div>`).join("") + `</div>`;
  return chip + flows + `<div class="panel"><h3>add</h3><div class="adder">
      <input id="t" placeholder="ask in words - BM25 ranks the notes">
      <button data-act="add">add</button></div></div>
    <div class="board">${cols}</div>`;
}

/* ---------- shell ---------- */
function renderSessions() {
  const rows = window.__sessions || [];
  if (!rows.length) return `<div class="row dim">no sessions, or the service is down</div>`;
  return rows.slice(0, 12).map((s) => `<div class="panel" data-session="${esc(s.id)}" style="cursor:pointer">
      <h3>${esc(s.title).slice(0, 58)}</h3>
      <div class="row dim">${esc(s.dir)}</div>
      <div class="row dim">${esc(s.model)} - ${esc(s.outcome)} - ${s.cost} usd</div>
    </div>`).join("");
}

async function loadSessions() {
  try {
    const res = await fetch("/api/sessions", { cache: "no-store" });
    const data = await res.json();
    window.__sessions = data.sessions || [];
    const list = document.getElementById("sess-list");
    if (list) list.innerHTML = sessionRows();
    if (open === "terminal" && !activeSession && window.__sessions.length) {
      activeSession = window.__sessions[0].id;
      loadChat();
    }
  } catch (err) { window.__sessions = []; }
}

function openBay(id) {
  if (id === open) return;
  cue.bay();
  open = id;
  lastLogHtml = "";
  render();
  if (id === "terminal") { fillModels(); loadChat(); }
}

let activeSession = "";
let chat = [];

function sessionRows() {
  const sessions = (window.__sessions || []).slice(0, 40);
  return sessions.map((s) => `
      <div class="sess ${s.id === activeSession ? "on" : ""}" data-session="${esc(s.id)}">
        <div class="t">${esc((s.title || "untitled").slice(0, 46))}</div>
        <div class="m">${esc((s.model || "").slice(0, 28))}</div>
      </div>`).join("") || `<div class="row dim">no sessions</div>`;
}

function modelOf() {
  const current = (window.__sessions || []).find((s) => s.id === activeSession);
  return current ? current.model : "";
}

function fillModels() {
  const sel = document.getElementById("model-pick");
  const list = window.__models || [];
  if (!sel || !list.length) return;
  const saved = localStorage.getItem("console.model")
    || (window.__sessions || [])[0]?.model
    || list[0];
  const chosen = list.includes(saved) ? saved : list[0];
  sel.innerHTML = list.map((m) =>
    `<option value="${esc(m)}"${m === chosen ? " selected" : ""}>${esc(m)}</option>`).join("");
}

function renderTerminal() {
  return `<section class="crt-term">
      <div class="term-head"><span id="term-meta">${activeSession ? esc(activeSession) : "no session"}</span><span class="dim" id="term-model">${esc(modelOf())}</span></div>
      <div class="term-log" id="chatlog"></div>
      <div class="term-input">
        <span class="prompt-caret">&gt;</span>
        <input id="chat-text" placeholder="type a prompt, enter to send" autocomplete="off">
        <button data-act="chat-send">send</button>
      </div>
    </section>`;
}

function renderSessionPane() {
  return `<div class="side-head">sessions <button data-act="session-new">+ new</button></div>
    <div class="side-list" id="sess-list">${sessionRows()}</div>
    <div class="side-model">model<span id="sess-model">${esc(modelOf() || "no model")}</span>
      <select id="model-pick" title="model for a new session"></select></div>`;
}

window.__sendPrompt = function () {
  const input = document.getElementById("chat-text");
  const text = input && input.value.trim();
  if (!text) return;
  if (!activeSession) { toast("pick a session first", true); return; }
  input.value = "";
  sendPrompt(text);
};

let lastLogHtml = "";

function argLabel(p) {
  try {
    const o = JSON.parse(p.args || "{}");
    return String(o.command || o.path || o.filePath || o.pattern || o.query || p.args || "");
  } catch (err) {
    return String(p.args || "");
  }
}

function transcriptHtml(messages) {
  return (messages || [])
    .filter((m) => m.role !== "idle" && m.role !== "synthetic")
    .slice(-40).map((m) => {
      const who = m.role === "user" ? "you" : m.role === "assistant" ? "mu/th/ur" : m.role;
      const seen = new Set();
      const body = (m.parts || []).filter((p) => {
        const key = p.key || `${p.kind}|${p.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((p, i) => {
        const key = esc(p.key || `${m.id || ""}-${i}`);
        if (p.kind === "text") return `<div class="line">${esc(p.text)}</div>`;
        if (p.kind === "error") return `<div class="line bad">${esc(p.text)}</div>`;
        if (p.kind === "reasoning") {
          return `<details class="fold think" data-key="r${key}"><summary>thinking</summary><pre>${esc(p.text || "")}</pre></details>`;
        }
        const args = argLabel(p);
        const body = [p.args ? "input: " + p.args : "", p.out ? "output: " + p.out : ""]
          .filter(Boolean).join("\n\n") || "no payload";
        return `<details class="fold tool${p.status === "running" ? " running" : ""}" data-key="t${key}"><summary><span class="chip">${esc(p.text)}</span> ${esc(p.status || "")} ${esc(args)}</summary><pre>${esc(body)}</pre></details>`;
      }).join("");
      return body ? `<div class="msg ${m.role}" data-id="${esc(m.id || "")}"><div class="who">${who}</div>${body}</div>` : "";
    }).join("");
}

const typedLen = new Map();
let typeTimer = null;
let isBusy = false;
let activeUntil = 0;
let loadingChat = false;

function typeLast(log) {
  const lines = log.querySelectorAll(".line");
  if (!lines.length) return;
  const el = lines[lines.length - 1];
  const msg = el.closest(".msg");
  const idx = msg ? [...msg.querySelectorAll(".line")].indexOf(el) : 0;
  const full = el.textContent;
  const key = (msg ? msg.dataset.id : "") + "#" + idx;
  let shown = typedLen.get(key) || 0;
  if (shown >= full.length) return;
  if (typeTimer) clearInterval(typeTimer);
  el.textContent = full.slice(0, shown);
  typeTimer = setInterval(() => {
    shown = Math.min(full.length, shown + 2);
    el.textContent = full.slice(0, shown);
    typedLen.set(key, shown);
    if (shown % 6 === 0) cue.type();
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (near) log.scrollTop = log.scrollHeight;
    if (shown >= full.length) { clearInterval(typeTimer); typeTimer = null; }
  }, 18);
}

function paintLog() {
  const log = document.getElementById("chatlog");
  if (!log) return;
  const html = transcriptHtml(chat) || '<div class="row dim">no messages yet - type below</div>';
  if (html === lastLogHtml) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.innerHTML = html;
  lastLogHtml = html;
  log.querySelectorAll("details.fold").forEach((d) => {
    if (openFolds.has(d.dataset.key)) d.open = true;
  });
  if (stick) log.scrollTop = log.scrollHeight;
  typeLast(log);
}

async function loadChat() {
  if (loadingChat) return;
  loadingChat = true;
  if (!activeSession) {
    const first = (window.__sessions || [])[0];
    if (!first) return;
    activeSession = first.id;
  }
  const meta = document.getElementById("term-meta");
  const modelEl = document.getElementById("term-model");
  const sideModel = document.getElementById("sess-model");
  if (meta) meta.textContent = activeSession;
  if (modelEl) modelEl.textContent = modelOf();
  if (sideModel) sideModel.textContent = modelOf();
  try {
    const res = await fetch(`/api/chat?session=${activeSession}`, { cache: "no-store" });    const data = await res.json();
    chat = data.messages || [];
    const log = document.getElementById("chatlog");
    const live = chat.filter((m) => m.role !== "idle" && m.role !== "synthetic");
    const lastMsg = live[live.length - 1];
    const parts = (lastMsg && lastMsg.parts) || [];
    const lastPart = parts[parts.length - 1];
    const thinking = !!lastPart && lastPart.kind === "reasoning"
      && lastMsg.role === "assistant";
    const running = parts.some((p) => p.kind === "tool" && p.status === "running");
    const busy = thinking || running || Date.now() < activeUntil;
    if (busy && !isBusy) { standbyOn(); cue.think(); }
    if (!busy && isBusy) standbyOff();
    isBusy = busy;
    if (log) log.dataset.busy = busy ? "1" : "0";
    paintLog();
  } catch (err) {
    const log = document.getElementById("chatlog");
    if (log) log.innerHTML = `<div class="line bad">link down: ${esc(String(err))}</div>`;
  } finally {
    loadingChat = false;
  }
}

async function sendPrompt(text) {
  if (!activeSession) return toast("select a session first", true);
  chat = chat.concat([{ id: "local-" + Date.now(), role: "user", parts: [{ kind: "text", text }] }]);
  lastLogHtml = "";
  paintLog();
  const res = await fetch(`/api/chat/send?session=${activeSession}&text=${encodeURIComponent(text)}`, { method: "POST" });
  const data = await res.json();
  toast(data.ok ? "sent" : (data.message || "send failed"), !data.ok);
  if (data.ok) activeUntil = Date.now() + 90000;
  setTimeout(loadChat, 1200);
  setTimeout(loadChat, 4000);
}

function splitOf(id) {
  const v = localStorage.getItem("console.split." + id);
  return v ? `--split:${v}px` : "";
}

function renderShell() {
  const track = $("#track");
  const openIndex = BAYS.findIndex((b) => b.id === open);
  const spine = (bay, index) => `
    <article class="baycard" data-bay="${bay.id}">
      <div class="atm"></div>
      <button class="solo-btn" data-act="solo" data-bay="${bay.id}" title="fullscreen">[ ]</button>
      <div class="spine">
        <div class="vlabel">${bay.label}</div>
        <div class="vmono">${bay.glyph}</div>
        <div class="vnum">${String(bay.number(state)).slice(0, 7)}</div>
      </div>
      <div class="inside" style="display:none;${splitOf(bay.id)}">
        <div class="visual">
          <div class="label">${bay.label}</div>
          <div class="glyph">${bay.glyph}</div>
          <div class="huge mid">${bay.number(state)}</div>
          <div class="cap">${bay.unit(state) || bay.note}</div>
        </div>
        <div class="vsplit" title="drag to resize"></div>
        <div class="copy">${(bay.render || (() => ""))(state)}</div>
      </div>
    </article>`;
  const focused = (bay, index) => {
    const number = bay.number(state);
    const unit = bay.unit(state);
    const numeric = /^[\d,]+$/.test(String(number));
    const size = !numeric || String(number).length > 7 ? " mid" : "";
    const isOpen = bay.id === open;
    return `<article class="baycard ${isOpen ? "open" : ""}" data-bay="${bay.id}">
      <button class="solo-btn" data-act="solo" data-bay="${bay.id}" title="fullscreen">[ ]</button>
      <div class="atm"></div>
      <div class="inside" style="display:${isOpen ? "grid" : "none"};${splitOf(bay.id)}">
        <div class="visual">
          <div class="label">${bay.label}</div>
          <div class="glyph">${bay.glyph}</div>
          <div class="huge${size}">${number}</div>
          <div class="cap">${unit || bay.note}</div>
          ${bayVisual(bay.id, state)}
        </div>
        <div class="vsplit" title="drag to resize"></div>
        <div class="copy">${(bay.render || (() => ""))(state)}</div>
      </div>
    </article>`;
  };
  const left = BAYS.slice(0, openIndex).map((bay, i) => spine(bay, i)).join("");
  const right = BAYS.slice(openIndex + 1).map((bay, i) => spine(bay, openIndex + 1 + i)).join("");
  track.innerHTML = left + focused(BAYS[openIndex], openIndex) + right;
}

function bayVisual(id, s) {
  if (id === "terminal") return renderSessionPane();
  if (id === "telemetry") return `<div class="vgraf">${spark(hist)}<div class="cap">vram free, rolling</div></div>`;
  if (id === "archive") {
    const rows = s.knowledge.domains || [];
    const max = Math.max(1, ...rows.map((r) => r.notes));
    return `<div class="vgraf bars">` + rows.map((r) =>
      `<div class="brow"><span>${r.name}</span><i style="width:${(r.notes / max) * 100}%"></i><b>${r.notes}</b></div>`).join("") + `</div>`;
  }
  if (id === "berth") {
    const rows = s.projects || [];
    const max = Math.max(1, ...rows.map((r) => r.open));
    return `<div class="vgraf bars">` + rows.map((r) =>
      `<div class="brow"><span>${r.slug}</span><i style="width:${(r.open / max) * 100}%"></i><b>${r.open}</b></div>`).join("") + `</div>`;
  }
  if (id === "procedures") {
    const b = s.board || {};
    const total = COLUMNS.reduce((a, c) => a + ((b[c] || []).length), 0) || 1;
    return `<div class="vgraf"><div class="stack">` + COLUMNS.map((c) =>
      `<i class="${c}" style="width:${((b[c] || []).length / total) * 100}%"></i>`).join("") +
      `</div><div class="cap">${COLUMNS.map((c) => `${c} ${(b[c] || []).length}`).join("   ")}</div></div>`;
  }
  const needs = s.needs || [];
  return `<div class="vgraf"><div class="cap">${needs.length ? needs.length + " item(s) need you" : "no blockers"}</div></div>`;
}

function render() {
  if (!state) return;
  lastRender = Date.now();
  if (String(window.getSelection() || "").length > 0) return;
  if (open === "terminal" && document.querySelector('.baycard.open[data-bay="terminal"]')) return;
  renderShell();
  updateLive();
  $("#dot").className = "dot" + (state.alerts.length ? " bad" : "");
}

/* ---------- actions ---------- */
async function api(path) {
  const res = await fetch(path, { method: "POST" });
  const data = await res.json();
  if (data.message) toast(data.message, !data.ok);
  await poll();
}

function toast(message, bad) {
  const el = $("#toast");
  el.textContent = message || "";
  el.style.color = bad ? "var(--bad)" : "var(--soft)";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.textContent = ""), 6000);
}

["pointerdown", "keydown"].forEach((evt) =>
  window.addEventListener(evt, () => startAudio(), { once: true }));

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-act='chat-send']")) { window.__sendPrompt(); return; }
  // keep a selection alive: a click must not clear what the user highlighted
  if (String(window.getSelection() || "").length > 0) return;
  if (event.target.closest("[data-act='clear-filter']")) { projectFilter = ""; render(); return; }
  if (event.target.closest("[data-act='chat-send']")) {
    const input = document.getElementById("chat-text");
    const text = input && input.value.trim();
    if (text) { input.value = ""; sendPrompt(text); }
    return;
  }
  const soloBtn = event.target.closest("[data-act='solo']");
  if (soloBtn) {
    const track = document.getElementById("track");
    if (track.classList.contains("solo") && open === soloBtn.dataset.bay) track.classList.remove("solo");
    else { openBay(soloBtn.dataset.bay); track.classList.add("solo"); }
    return;
  }
  if (event.target.closest("[data-act='session-new']")) {
    const pick = document.getElementById("model-pick");
    const model = pick ? pick.value : (localStorage.getItem("console.model") || "");
    fetch(`/api/session/new?model=${encodeURIComponent(model)}`, { method: "POST" })
      .then((r) => r.json()).then((d) => {
        toast(d.ok ? "session created" : (d.message || "create failed"), !d.ok);
        if (d.ok && d.session) {
          activeSession = d.session;
          loadSessions();
          setTimeout(loadChat, 900);
          render();
        }
      });
    return;
  }
  const sessRow = event.target.closest("[data-session]");
  if (sessRow) { activeSession = sessRow.dataset.session; chat = []; lastLogHtml = ""; openBay("terminal"); loadChat(); return; }
  if (event.target.closest("[data-act='chat-refresh']")) { loadChat(); return; }
  const projRow = event.target.closest("[data-proj]");
  if (projRow) { projectFilter = projRow.dataset.proj; open = "procedures"; render(); return; }
  const capBtn = event.target.closest("[data-act='capture-card'], [data-act='capture-note']");
  if (capBtn) {
    const which = capBtn.dataset.act;
    const input = document.querySelector(".baycard.open #cap");
    const text = input && input.value.trim();
    if (!text) { toast("nothing to capture", true); return; }
    const url = which === "capture-card"
      ? `/api/card?action=add&title=${encodeURIComponent(text)}&project=`
      : `/api/note?text=${encodeURIComponent(text)}`;
    fetch(url, { method: "POST" }).then((r) => r.json()).then((d) => {
      toast(d.message || (d.ok ? "captured" : "failed"), !d.ok);
      if (input) input.value = "";
      poll();
    });
    return;
  }
  const fileRow = event.target.closest("[data-open]");
  if (fileRow && fileRow.dataset.open) {
    fetch(`/api/open?path=${encodeURIComponent(fileRow.dataset.open)}`)
      .then((r) => r.json()).then((d) => toast(d.message, !d.ok));
    return;
  }
  const bay = event.target.closest(".baycard");
  if (bay && !event.target.closest("button") && !event.target.closest("input")) {
    openBay(bay.dataset.bay);
    return;
  }
  const button = event.target.closest("button[data-act], .engine[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "engine") api(`/api/engine?key=${button.dataset.key}&action=${button.dataset.op}`);
  else if (act === "card") api(`/api/card?action=move&id=${button.dataset.id}&direction=${button.dataset.op === "delete" ? "" : button.dataset.op}`);
  else if (act === "flow") {
    fetch(`/api/run?name=${encodeURIComponent(button.dataset.name)}`, { method: "POST" })
      .then((r) => r.json()).then((d) => { toast(d.message, !d.ok); poll(); });
  } else if (act === "add") {
    const input = document.querySelector(".baycard.open #t");
    const title = input?.value.trim();
    if (title) api(`/api/card?action=add&title=${encodeURIComponent(title)}&project=`);
  } else if (act === "search") {
    const query = document.querySelector(".baycard.open #q")?.value.trim();
    if (query) search(query);
  }
});

const openFolds = new Set();

document.addEventListener("toggle", (event) => {
  const d = event.target;
  if (!d || !d.classList || !d.classList.contains("fold")) return;
  if (d.open) openFolds.add(d.dataset.key);
  else openFolds.delete(d.dataset.key);
}, true);

document.addEventListener("change", (event) => {
  if (event.target && event.target.id === "model-pick") {
    localStorage.setItem("console.model", event.target.value);
  }
});

document.addEventListener("mousedown", (event) => {
  const split = event.target.closest(".vsplit");
  if (!split) return;
  const box = split.parentElement;
  if (!box) return;
  event.preventDefault();
  const move = (ev) => {
    const rect = box.getBoundingClientRect();
    const px = Math.max(200, Math.min(rect.width - 260, ev.clientX - rect.left));
    box.style.setProperty("--split", px + "px");
    const card = box.closest(".baycard");
    if (card) localStorage.setItem("console.split." + card.dataset.bay, String(Math.round(px)));
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

document.addEventListener("mousedown", (event) => {
  if (!event.target.closest("#gutter")) return;
  const box = document.getElementById("console");
  if (!box) return;
  event.preventDefault();
  const move = (ev) => {
    const rect = box.getBoundingClientRect();
    const px = Math.max(220, Math.min(rect.width - 360, ev.clientX - rect.left));
    box.style.setProperty("--split", px + "px");
    localStorage.setItem("console.split", String(Math.round(px)));
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT"].includes(event.target.tagName)) {
    if (event.key === "Enter" && event.target.id === "t") {
      const v = event.target.value.trim();
      if (v) api(`/api/card?action=add&title=${encodeURIComponent(v)}&project=`);
      event.target.value = "";
    }
    if (event.key === "Enter" && event.target.id === "chat-text") {
      event.preventDefault();
      window.__sendPrompt();
      return;
    }
    if (event.key === "Enter" && event.target.id === "q") {
      const v = event.target.value.trim();
      if (v) search(v);
    }
    return;
  }
  const index = BAYS.findIndex((b) => b.id === open);
  if (event.key.toLowerCase() === "f") {
    const track = document.getElementById("track");
    track.classList.toggle("solo");
    localStorage.setItem("console.solo", track.classList.contains("solo") ? "1" : "0");
    return;
  }
  if (/^[1-6]$/.test(event.key)) { openBay(BAYS[Number(event.key) - 1].id); }
  else if (event.key === "ArrowRight") { openBay(BAYS[Math.min(BAYS.length - 1, index + 1)].id); }
  else if (event.key === "ArrowLeft") { openBay(BAYS[Math.max(0, index - 1)].id); }
  else if (event.key.toLowerCase() === "r") poll();
  else if (ENGINES[event.key]) {
    const rec = (state?.managed || {})[event.key];
    api(`/api/engine?key=${event.key}&action=${rec && rec.alive ? "stop" : "start"}`);
  }
});

async function search(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  results = data.results || [];
  render();
}

async function loadFlows() {
  try {
    const res = await fetch("/api/workflows", { cache: "no-store" });
    const data = await res.json();
    window.__flows = data.workflows || [];
  } catch (err) { window.__flows = []; }
}

async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    state = await res.json();
    if (state.gpu && state.gpu.present) { hist.push(state.gpu.free_mib); if (hist.length > 90) hist.shift(); }
    // numbers update in place; the DOM is rebuilt only on a real structural change,
    // and then at most once a minute, so the bays stop blinking.
    const sig = structuralSig(state);
    if (sig !== lastSig && state.alerts && state.alerts.length) cue.alert();
    if (sig !== lastSig) {
      lastSig = sig;
      if (Date.now() - lastRender > 60000) { lastRender = Date.now(); render(); }
      else { updateLive(); }
    } else { updateLive(); }
  } catch (err) {
    $("#dot").className = "dot bad";
    toast("collector unreachable", true);
  }
}

function typeBoot() {
  const box = document.getElementById("boot");
  if (!box) return;
  const lines = [
    "MU/TH/UR 6000",
    "INTERFACE 2037 READY FOR INQUIRY",
    "CORE ................ OK",
    "KNOWLEDGE LAYER ..... MOUNTED",
    "WORK BOARD .......... LOADED",
    "ENGINES ............. POLLING",
    "OPENCODE ............ LINKED",
    "SESSION BUS ......... SYNCED",
    "TELEMETRY .......... ONLINE",
  ];
  box.innerHTML = '<div class="boot-inner"></div>';
  try {
    startAudio();
    bootCue();
  } catch (err) { /* audio must never block the boot */ }
  {
    const st = audioState();
    lines.push(`AUDIO .............. ${st.muted ? "MUTED" : (st.state === "running" ? "ONLINE" : st.state.toUpperCase())}`);
    setTimeout(() => {
      const last = box.querySelector(".boot-line:last-child");
      if (!last) return;
      const now = audioState();
      last.textContent = `AUDIO .............. ${now.muted ? "MUTED" : (now.state === "running" ? "ONLINE" : now.state.toUpperCase())}`;
    }, 700);
  }
  const inner = box.querySelector(".boot-inner");
  let line = 0, char = 0, node = null;
  function step() {
    if (line >= lines.length) {
      setTimeout(() => { box.style.opacity = "0"; setTimeout(() => box.remove(), 400); }, 400);
      return;
    }
    if (!node) { node = document.createElement("div"); node.className = "boot-line" + (line ? " dim" : ""); inner.appendChild(node); }
    node.textContent = lines[line].slice(0, ++char);
    if (char >= lines[line].length) { line++; char = 0; node = null; setTimeout(step, 150); }
    else setTimeout(step, 19);
    if (char === 1) cue.key();
  }
  step();
}

function tick() { $("#clock").textContent = new Date().toTimeString().slice(0, 8); }
tick(); setInterval(tick, 1000);
loadFlows();
setTimeout(loadFlows, 600);
loadSessions();
typeBoot();
fetch("/api/models").then((r) => r.json()).then((d) => {
  window.__models = d.models || [];
  fillModels();
}).catch(() => {});
setInterval(loadSessions, 20000);
let stream = null;
let lastEventLoad = 0;

function openStream() {
  if (stream || typeof EventSource === "undefined") return;
  try { stream = new EventSource("/api/stream"); } catch (err) { return; }
  stream.onmessage = (event) => {
    if (open !== "terminal") return;
    let sid = "";
    try {
      const payload = JSON.parse(event.data);
      const data = payload.data || {};
      sid = data.sessionID || (data.info && data.info.sessionID) || "";
    } catch (err) { /* unknown frame: treat as relevant */ }
    if (sid && sid !== activeSession) return;
    const now = Date.now();
    if (now - lastEventLoad < 250) return;
    lastEventLoad = now;
    loadChat();
  };
  stream.onerror = () => {
    if (stream) { stream.close(); stream = null; }
    setTimeout(openStream, 5000);
  };
}

openStream();
setInterval(() => { if (open === "terminal") loadChat(); }, 3000);
setInterval(() => { if (open === "terminal" && Date.now() < activeUntil) loadChat(); }, 1200);
setInterval(() => { if (isBusy && open === "terminal") cue.think(); }, 1600);
poll(); setInterval(poll, 3000);

$("#prev").addEventListener("click", () => step(-1));
$("#next").addEventListener("click", () => step(1));
function step(delta) {
  const index = BAYS.findIndex((b) => b.id === open);
  const next = Math.max(0, Math.min(BAYS.length - 1, index + delta));
  if (next !== index) { open = BAYS[next].id; render(); }
}

/* ---------- command palette ---------- */
const savedViews = [
  { label: "view: my cards this week", run: () => { open = "procedures"; render(); } },
  { label: "view: notes touched today", run: () => { open = "archive"; render(); } },
  { label: "view: engines and card", run: () => { open = "telemetry"; render(); } },
  { label: "view: everything on muther", run: () => { projectFilter = "muther"; open = "procedures"; render(); } },
];

const COMMANDS = [
  { label: "go: status", run: () => setOpen("status") },
  { label: "go: telemetry", run: () => setOpen("telemetry") },
  { label: "go: archive", run: () => setOpen("archive") },
  { label: "go: berth", run: () => setOpen("berth") },
  { label: "go: procedures", run: () => setOpen("procedures") },
  { label: "view: fullscreen bay", run: () => {
      const track = document.getElementById("track");
      track.classList.toggle("solo");
      localStorage.setItem("console.solo", track.classList.contains("solo") ? "1" : "0");
    } },
  { label: "engine: start swift 120k", run: () => api("/api/engine?key=1&action=start") },
  { label: "engine: start coder strata", run: () => api("/api/engine?key=2&action=start") },
  { label: "engine: start swift 64k", run: () => api("/api/engine?key=3&action=start") },
  { label: "engine: stop all", run: () => api("/api/engine?key=1&action=stop") },
  { label: "board: move in-progress cards to done", run: () => (state?.board?.doing || []).forEach((c) => api(`/api/card?action=move&id=${c.id}&direction=done`)) },
  { label: "refresh", run: () => poll() },
];

savedViews.forEach((v) => COMMANDS.push(v));

Object.entries(ENGINES).forEach(([key, spec]) => {
  COMMANDS.push({ label: `engine: start ${spec.name}`, run: () => api(`/api/engine?key=${key}&action=start`) });
  COMMANDS.push({ label: `engine: stop ${spec.name}`, run: () => api(`/api/engine?key=${key}&action=stop`) });
});

let paletteIndex = 0;

function setOpen(bay) { open = bay; render(); }

function openPalette() {
  const box = $("#palette");
  box.hidden = false;
  const input = $("#palette-q");
  input.value = "";
  paletteIndex = 0;
  renderPalette("");
  input.focus();
}

function closePalette() {
  $("#palette").hidden = true;
}

function renderPalette(filter) {
  const term = filter.toLowerCase();
  const items = COMMANDS.filter((c) => c.label.toLowerCase().includes(term));
  paletteIndex = Math.min(paletteIndex, Math.max(0, items.length - 1));
  $("#palette-list").innerHTML = items.map((c, i) =>
    `<div class="cmd ${i === paletteIndex ? "on" : ""}" data-cmd="${COMMANDS.indexOf(c)}">${esc(c.label)}</div>`).join("")
    || `<div class="cmd">no command</div>`;
  return items;
}

function runPalette() {
  const term = $("#palette-q").value.trim();
  if (!term) return;
  const items = COMMANDS.filter((c) => c.label.toLowerCase().includes(term.toLowerCase()));
  if (!items.length) { toast("no such command", true); return; }
  items[Math.min(paletteIndex, items.length - 1)].run();
  closePalette();
}

document.addEventListener("keydown", (event) => {
  const paletteOpen = !$("#palette").hidden;
  if (event.key === "/" && !paletteOpen && !["INPUT", "SELECT"].includes(event.target.tagName)) {
    event.preventDefault();
    openPalette();
    return;
  }
  if (!paletteOpen) return;
  const items = COMMANDS.filter((c) => c.label.toLowerCase().includes($("#palette-q").value.trim().toLowerCase()));
  if (event.key === "Escape") closePalette();
  else if (event.key === "Enter") runPalette();
  else if (event.key === "ArrowDown") { paletteIndex = Math.min(items.length - 1, paletteIndex + 1); renderPalette($("#palette-q").value); }
  else if (event.key === "ArrowUp") { paletteIndex = Math.max(0, paletteIndex - 1); renderPalette($("#palette-q").value); }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "palette-q") { paletteIndex = 0; renderPalette(event.target.value); }
});

document.addEventListener("click", (event) => {
  const cmd = event.target.closest(".cmd[data-cmd]");
  if (cmd) { COMMANDS[Number(cmd.dataset.cmd)].run(); closePalette(); }
  if (event.target.id === "palette") closePalette();
});


/* ---------- live numbers: update in place, never rebuild ---------- */
function setLive(name, text) {
  document.querySelectorAll(`[data-live="${name}"]`).forEach((el) => { el.textContent = text; });
}

function updateLive() {
  if (!state) return;
  const g = state.gpu, r = state.ram;
  if (g.present) {
    setLive("vram-free", fmt(g.free_mib));
    setLive("vram-row", `${g.name} - util ${g.util_pct}% - ${g.power_w ?? "--"} W`);
    document.querySelectorAll('[data-live="vram-bar"]').forEach((el) => {
      el.style.width = Math.max(0, Math.min(100, (g.used_mib / g.total_mib) * 100)) + "%";
    });
  }
  setLive("ram", fmt(r.available_mib));
  setLive("ram-row", `load ${r.load_pct}%`);
  setLive("disk", state.disk.free_gib);
  const sparkEl = document.querySelector('[data-live="spark"]');
  if (sparkEl) sparkEl.innerHTML = spark(hist);
}

/* structural signature: only changes that need a rebuild */
function structuralSig(s) {
  return JSON.stringify({
    open,
    alerts: s.alerts,
    needs: (s.needs || []).map((n) => n.text),
    board: Object.fromEntries(Object.entries(s.board || {}).map(([k, v]) => [k, v.map((c) => c.id + c.title)])),
    projects: (s.projects || []).map((p) => p.slug + p.open),
    knowledge: s.knowledge,
    models: (s.models || []).map((m) => m.name),
    managed: s.managed,
    ports: s.ports.map((p) => p.port + p.open),
    notes: s.memory.notes + s.memory.map_chars,
  });
}


/* ---------- window controls ---------- */
async function winToggle() {
  if (window.consoleShell) { window.consoleShell.toggleFullscreen(); return; }
  if (window.pywebview && window.pywebview.api && window.pywebview.api.toggle_fullscreen) {
    await window.pywebview.api.toggle_fullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}
function winMin() {
  if (window.consoleShell) { window.consoleShell.minimize(); return; }
  if (window.pywebview && window.pywebview.api && window.pywebview.api.minimize) {
    window.pywebview.api.minimize();
  }
}
function winClose() {
  if (window.consoleShell) { window.consoleShell.close(); return; }
  if (window.pywebview && window.pywebview.api && window.pywebview.api.close_window) {
    window.pywebview.api.close_window();
  }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "F11") { event.preventDefault(); winToggle(); }
  if (event.key === "Escape" && document.fullscreenElement) document.exitFullscreen();
});
window.addEventListener("DOMContentLoaded", () => {
  const full = document.getElementById("win-full");
  const close = document.getElementById("win-close");
  const mute = document.getElementById("win-mute");
  if (mute) {
    mute.style.opacity = isMuted() ? "0.45" : "1";
    mute.addEventListener("click", () => {
      setMuted(!isMuted());
      mute.style.opacity = isMuted() ? "0.45" : "1";
      toast(isMuted() ? "sound off" : "sound on");
    });
  }
  const min = document.getElementById("win-min");
  if (min) min.addEventListener("click", winMin);
  if (full) full.addEventListener("click", winToggle);
  if (close) close.addEventListener("click", winClose);
});
