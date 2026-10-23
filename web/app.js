// Console theatre: five bays, one in focus. Same API, different shape.
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
let open = (new URLSearchParams(location.search).get("bay")) || "status";
let results = [];
const hist = [];

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
  { id: "procedures", label: "procedures", glyph: "P", note: "board and runs",
    number: (s) => `${(s.board.doing || []).length}`, unit: () => "in progress",
    render: renderProcedures },
];

const totalNotes = (s) => (s.knowledge.domains || []).reduce((a, d) => a + d.notes, 0);

function meter(used, total) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  return `<div class="meter"><i style="width:${pct}%"></i></div>`;
}

function renderStatus(s) {
  const needs = s.needs || [];
  const list = needs.length
    ? needs.map((n) => `<div class="row ${n.kind === "alert" ? "bad" : ""}"> - - ${esc(n.text)}</div>`).join("")
    : `<div class="row ok">nothing waiting on you</div>`;
  const log = (s.activity || []).map(esc).join("\n") || "idle";
  return `<div class="panel"><h3>needs you</h3>${list}</div>
          <div class="panel"><h3>activity</h3><pre class="log">${log}</pre></div>`;
}

function renderTelemetry(s) {
  const g = s.gpu, r = s.ram;
  const gpu = g.present
    ? `<div class="big"><span data-live="vram-free">${fmt(g.free_mib)}</span><small>MiB free of ${fmt(g.total_mib)}</small></div>
       ${meter(g.used_mib, g.total_mib)}
       <div class="row">${esc(g.name)}  - - util ${g.util_pct}%  - - ${g.power_w ?? "--"} W</div>`
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
  return (s.projects || []).map((p) => `<div class="panel">
      <h3>${esc(p.slug)}</h3>
      <div class="row">${esc(p.title)}</div>
      <div class="row dim">${esc(p.answers)}</div>
      <div class="row dim">${p.open} open card(s)</div></div>`).join("")
    || `<div class="row dim">no project overlays</div>`;
}

function renderProcedures(s) {
  const board = s.board || {};
  const cols = COLUMNS.map((column) => {
    const cards = board[column] || [];
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
  return `<div class="panel"><h3>add</h3><div class="adder">
      <input id="t" placeholder="ask in words - BM25 ranks the notes">
      <button data-act="add">add</button></div></div>
    <div class="board">${cols}</div>`;
}

/* ---------- shell ---------- */
function renderShell() {
  const track = $("#track");
  const openIndex = BAYS.findIndex((b) => b.id === open);
  const spine = (bay, index) => `
    <article class="baycard" data-bay="${bay.id}">
      <div class="atm"></div>
      <div class="spine">
        <div class="vlabel">${bay.label}</div>
        <div class="vmono">${bay.glyph}</div>
        <div class="vnum">${String(bay.number(state)).slice(0, 7)}</div>
      </div>
    </article>`;
  const focused = (bay, index) => {
    const number = bay.number(state);
    const unit = bay.unit(state);
    const numeric = /^[\d,]+$/.test(String(number));
    const size = !numeric || String(number).length > 7 ? " mid" : "";
    return `<article class="baycard open" data-bay="${bay.id}">
      <div class="atm"></div>
      <div class="inside">
        <div class="visual">
          <div class="label">${bay.label}</div>
          <div class="glyph">${bay.glyph}</div>
          <div class="huge${size}">${number}</div>
          <div class="cap">${unit || bay.note}</div>
          ${bayVisual(bay.id, state)}
        </div>
        <div class="copy">${bay.render(state)}</div>
      </div>
    </article>`;
  };
  const left = BAYS.slice(0, openIndex).map((bay, i) => spine(bay, i)).join("");
  const right = BAYS.slice(openIndex + 1).map((bay, i) => spine(bay, openIndex + 1 + i)).join("");
  track.innerHTML = left + focused(BAYS[openIndex], openIndex) + right;
}

function bayVisual(id, s) {
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
  if (String(window.getSelection() || "").length > 0) return;
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

document.addEventListener("click", (event) => {
  // keep a selection alive: a click must not clear what the user highlighted
  if (String(window.getSelection() || "").length > 0) return;
  const fileRow = event.target.closest("[data-open]");
  if (fileRow && fileRow.dataset.open) {
    fetch(`/api/open?path=${encodeURIComponent(fileRow.dataset.open)}`)
      .then((r) => r.json()).then((d) => toast(d.message, !d.ok));
    return;
  }
  const bay = event.target.closest(".baycard");
  if (bay && !event.target.closest("button") && !event.target.closest("input")) {
    open = bay.dataset.bay;
    render();
    return;
  }
  const button = event.target.closest("button[data-act], .engine[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "engine") api(`/api/engine?key=${button.dataset.key}&action=${button.dataset.op}`);
  else if (act === "card") api(`/api/card?action=move&id=${button.dataset.id}&direction=${button.dataset.op === "delete" ? "" : button.dataset.op}`);
  else if (act === "add") {
    const input = document.querySelector(".baycard.open #t");
    const title = input?.value.trim();
    if (title) api(`/api/card?action=add&title=${encodeURIComponent(title)}&project=`);
  } else if (act === "search") {
    const query = document.querySelector(".baycard.open #q")?.value.trim();
    if (query) search(query);
  }
});

document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT"].includes(event.target.tagName)) {
    if (event.key === "Enter" && event.target.id === "t") {
      const v = event.target.value.trim();
      if (v) api(`/api/card?action=add&title=${encodeURIComponent(v)}&project=`);
      event.target.value = "";
    }
    if (event.key === "Enter" && event.target.id === "q") {
      const v = event.target.value.trim();
      if (v) search(v);
    }
    return;
  }
  const index = BAYS.findIndex((b) => b.id === open);
  if (/^[1-5]$/.test(event.key)) { open = BAYS[Number(event.key) - 1].id; render(); }
  else if (event.key === "ArrowRight") { open = BAYS[Math.min(BAYS.length - 1, index + 1)].id; render(); }
  else if (event.key === "ArrowLeft") { open = BAYS[Math.max(0, index - 1)].id; render(); }
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

async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    state = await res.json();
    if (state.gpu && state.gpu.present) { hist.push(state.gpu.free_mib); if (hist.length > 90) hist.shift(); }
    const sig = structuralSig(state);
    if (sig !== lastSig) { lastSig = sig; render(); } else { updateLive(); }
  } catch (err) {
    $("#dot").className = "dot bad";
    toast("collector unreachable", true);
  }
}

function tick() { $("#clock").textContent = new Date().toTimeString().slice(0, 8); }
tick(); setInterval(tick, 1000);
poll(); setInterval(poll, 3000);

$("#prev").addEventListener("click", () => step(-1));
$("#next").addEventListener("click", () => step(1));
function step(delta) {
  const index = BAYS.findIndex((b) => b.id === open);
  const next = Math.max(0, Math.min(BAYS.length - 1, index + delta));
  if (next !== index) { open = BAYS[next].id; render(); }
}

/* ---------- command palette ---------- */
const COMMANDS = [
  { label: "go: status", run: () => setOpen("status") },
  { label: "go: telemetry", run: () => setOpen("telemetry") },
  { label: "go: archive", run: () => setOpen("archive") },
  { label: "go: berth", run: () => setOpen("berth") },
  { label: "go: procedures", run: () => setOpen("procedures") },
  { label: "engine: start swift 120k", run: () => api("/api/engine?key=1&action=start") },
  { label: "engine: start coder strata", run: () => api("/api/engine?key=2&action=start") },
  { label: "engine: start swift 64k", run: () => api("/api/engine?key=3&action=start") },
  { label: "engine: stop all", run: () => api("/api/engine?key=1&action=stop") },
  { label: "board: move in-progress cards to done", run: () => (state?.board?.doing || []).forEach((c) => api(`/api/card?action=move&id=${c.id}&direction=done`)) },
  { label: "refresh", run: () => poll() },
];

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
  if (window.pywebview && window.pywebview.api && window.pywebview.api.toggle_fullscreen) {
    await window.pywebview.api.toggle_fullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}
function winClose() {
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
  if (full) full.addEventListener("click", winToggle);
  if (close) close.addEventListener("click", winClose);
});
