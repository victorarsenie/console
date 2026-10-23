// Console theatre: five bays, one in focus. Same API, different shape.
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (n ?? 0).toLocaleString();
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COLUMNS = ["backlog", "next", "doing", "done"];
const ENGINES = { "1": "swift 120k", "2": "coder strata", "3": "swift 64k" };
let state = null;
let lastSig = "";
let open = "status";
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
    ? needs.map((n) => `<div class="row ${n.kind === "alert" ? "bad" : ""}">Ãƒâ€šÃ‚Â· ${esc(n.text)}</div>`).join("")
    : `<div class="row ok">nothing waiting on you</div>`;
  const log = (s.memory.log_lines || []).slice(-6).map(esc).join("\n") || "idle";
  return `<div class="panel"><h3>needs you</h3>${list}</div>
          <div class="panel"><h3>activity</h3><pre class="log">${log}</pre></div>`;
}

function renderTelemetry(s) {
  const g = s.gpu, r = s.ram;
  const gpu = g.present
    ? `<div class="big">${fmt(g.free_mib)}<small>MiB free of ${fmt(g.total_mib)}</small></div>
       ${meter(g.used_mib, g.total_mib)}
       <div class="row">${esc(g.name)} Ãƒâ€šÃ‚Â· util ${g.util_pct}% Ãƒâ€šÃ‚Â· ${g.power_w ?? "--"} W</div>`
    : `<div class="row">no NVIDIA device</div>`;
  const managed = s.managed || {};
  const engines = Object.entries(ENGINES).map(([key, name]) => {
    const rec = managed[key];
    const up = rec && rec.alive;
    return `<div class="engine"><span class="name">[${key}] ${name}</span>
      <span class="state ${up ? "up" : ""}">${up ? "running" : "stopped"}</span>
      <button data-act="engine" data-key="${key}" data-op="${up ? "stop" : "start"}"
        class="${up ? "danger" : ""}">${up ? "stop" : "start"}</button></div>`;
  }).join("");
  const ports = s.ports.map((p) => `<span class="${p.open ? "on" : ""}">:${p.port} ${p.what}</span>`).join("");
  return `<div class="panel"><h3>card</h3>${gpu}</div>
    <div class="grid2">
      <div class="panel"><h3>memory</h3><div class="big">${fmt(r.available_mib)}<small>MiB</small></div>
        ${meter(r.total_mib - r.available_mib, r.total_mib)}<div class="row">load ${r.load_pct}%</div></div>
      <div class="panel"><h3>storage</h3><div class="big">${s.disk.free_gib}<small>GiB</small></div>
        <div class="row">${s.disk.drive} volume</div></div>
    </div>
    <div class="panel"><h3>engines</h3><div class="ports">${ports}</div>${engines}</div>
    <div class="panel"><h3>models on disk</h3>${(s.models || []).map((m) =>
      `<div class="row"><span class="dim">${m.gib} GiB</span> - ${esc(m.name)}</div>`).join("")
      || `<div class="row dim">none</div>`}</div>
    <div class="panel"><h3>vram free - last ${hist.length} samples</h3>${spark(hist)}</div>`;
}

function spark(values) {
  if (values.length < 2) return `<div class="row dim">collecting samplesâ€¦</div>`;
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
  const recent = (s.recent || []).map((r) => `<div class="r">${r.updated} Ãƒâ€šÃ‚Â· ${esc(r.note)}</div>`).join("");
  const hits = results.length
    ? results.map((r) => `<div class="hit"><b>${r.score.toFixed(2)}</b> ${esc(r.note)}<br>${esc(r.answers)}</div>`).join("")
    : "";
  return `<div class="panel"><h3>recall</h3>
      <div class="adder"><input id="q" placeholder="ask in words ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â BM25 ranks the notes">
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
        <div class="meta"><span>${esc(c.project || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â")}</span><span>${c.date || ""}</span></div>
        <div class="acts">
          <button data-act="card" data-id="${c.id}" data-op="left">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹</button>
          <button data-act="card" data-id="${c.id}" data-op="right">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº</button>
          <button data-act="card" data-id="${c.id}" data-op="done">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</button>
          <button class="danger" data-act="card" data-id="${c.id}" data-op="delete">ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¢</button>
        </div></div>`).join("");
    return `<div class="column"><h3>${column}<span>${cards.length}</span></h3>${items || '<div class="empty">empty</div>'}</div>`;
  }).join("");
  return `<div class="panel"><h3>add</h3><div class="adder">
      <input id="t" placeholder="new card">
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
        </div>
        <div class="copy">${bay.render(state)}</div>
      </div>
    </article>`;
  };
  const left = BAYS.slice(0, openIndex).map((bay, i) => spine(bay, i)).join("");
  const right = BAYS.slice(openIndex + 1).map((bay, i) => spine(bay, openIndex + 1 + i)).join("");
  track.innerHTML = left + focused(BAYS[openIndex], openIndex) + right;
}

function render() {
  if (!state) return;
  renderShell();
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
  const bay = event.target.closest(".baycard");
  if (bay && !event.target.closest("button") && !event.target.closest("input")) {
    open = bay.dataset.bay;
    render();
    return;
  }
  const button = event.target.closest("button[data-act]");
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
    const sig = JSON.stringify(state, (key, value) => (key === "ts" ? undefined : value));
    if (sig !== lastSig) { lastSig = sig; render(); }
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