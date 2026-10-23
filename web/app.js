// Muther dashboard: overview, kanban, knowledge, projects. Polls /api/state.
const COLUMNS = ["backlog", "next", "doing", "done"];
const ENGINES = { "1": "swift 120k", "2": "coder strata", "3": "swift 64k" };
const TITLES = { overview: "overview", board: "work board", knowledge: "knowledge", projects: "projects" };
let state = null;
let view = "overview";
const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function clock() { $("clock").textContent = new Date().toTimeString().slice(0, 5); }
function toast(message, bad) {
  const el = $("toast");
  el.textContent = message || "";
  el.style.color = bad ? "var(--bad)" : "var(--soft)";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.textContent = ""), 6000);
}
function bar(el, used, total) {
  el.style.width = (total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0) + "%";
}
async function post(url) {
  const res = await fetch(url, { method: "POST" });
  return res.json();
}

/* ---------- views ---------- */
function setView(name) {
  view = name;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "view-" + name));
  $("view-title").textContent = TITLES[name] || name;
  if (name === "knowledge") $("search-q").focus();
  render();
}

function renderOverview(s) {
  const g = s.gpu, r = s.ram;
  if (g.present) {
    $("vram-free").textContent = g.free_mib.toLocaleString();
    bar($("vram-bar"), g.used_mib, g.total_mib);
    $("vram-row").textContent = `${g.name} — ${g.used_mib} / ${g.total_mib} MiB · util ${g.util_pct}% · ${g.power_w ?? "--"} W`;
  }
  $("ram-free").textContent = r.available_mib.toLocaleString();
  bar($("ram-bar"), r.total_mib - r.available_mib, r.total_mib);
  $("ram-row").textContent = `of ${r.total_mib.toLocaleString()} · load ${r.load_pct}%`;
  $("disk-free").textContent = s.disk.free_gib;
  $("disk-row").textContent = `${s.disk.drive} volume`;

  $("ports").innerHTML = s.ports.map((p) =>
    `<span class="${p.open ? "on" : ""}">:${p.port} ${p.what}</span>`).join("");

  const managed = s.managed || {};
  const rows = Object.entries(managed).map(([key, rec]) => `
    <div class="engine">
      <span class="name">[${key}] ${rec.name}</span>
      <span class="state ${rec.alive ? "up" : ""}">${rec.alive ? "running" : "stopped"}</span>
      <span class="dim">pid ${rec.pid ?? "-"}</span>
      ${rec.alive
        ? `<button class="danger" onclick="engine('${key}','stop')">stop</button>`
        : `<button onclick="engine('${key}','start')">start</button>`}
    </div>`);
  const idle = Object.entries(ENGINES).filter(([k]) => !managed[k]).map(([key, name]) => `
    <div class="engine">
      <span class="name">[${key}] ${name}</span>
      <span class="state">stopped</span>
      <button onclick="engine('${key}','start')">start</button>
    </div>`);
  $("managed").innerHTML = rows.concat(idle).join("") || `<div class="empty">no engines</div>`;

  const needs = s.needs || [];
  $("needs").innerHTML = needs.length
    ? needs.map((n) => `<div class="item ${n.kind === "alert" ? "bad" : ""}">· ${n.text}</div>`).join("")
    : `<div class="item ok">nothing waiting on you</div>`;

  $("notes").textContent = s.knowledge ? s.knowledge.domains.reduce((a, d) => a + d.notes, 0) : "--";
  $("map-row").textContent = `${s.knowledge.domains.length} domains · ${s.knowledge.pending} pending`;
  $("log").textContent = (s.memory.log_lines || []).slice(-6).join("\n") || "idle";
  $("dot").className = "dot" + (s.alerts.length ? " bad" : "");
}

function renderBoard(s) {
  const board = s.board || {};
  $("card-project").innerHTML = ["", ...(s.projects || []).map((p) => p.slug)]
    .map((slug) => `<option value="${slug}">${slug || "no project"}</option>`).join("");
  $("board").innerHTML = COLUMNS.map((column) => {
    const cards = board[column] || [];
    const items = cards.map((c) => `
      <div class="card">
        <div class="t">${escapeHtml(c.title)}</div>
        <div class="meta"><span>${escapeHtml(c.project || "—")}</span><span>${c.date || ""}</span></div>
        <div class="acts">
          <button onclick="card('move','${c.id}','left')" title="move left">‹</button>
          <button onclick="card('move','${c.id}','right')" title="move right">›</button>
          <button onclick="card('move','${c.id}','done')" title="done">✓</button>
          <button class="danger" onclick="card('delete','${c.id}','')" title="delete">✕</button>
        </div>
      </div>`).join("");
    return `<div class="column"><h3>${column}<span>${cards.length}</span></h3>${items || '<div class="empty">empty</div>'}</div>`;
  }).join("");
}

function renderKnowledge(s) {
  const k = s.knowledge || { domains: [], pending: 0 };
  $("domains").innerHTML = k.domains.map((d) =>
    `<div class="d">${d.name}<span>${d.notes}</span></div>`).join("") ||
    `<div class="empty">no domains</div>`;
  $("recent").innerHTML = (s.recent || []).map((r) =>
    `<div class="r"><b>${r.updated}</b> · ${escapeHtml(r.note)}</div>`).join("");
}

function renderProjects(s) {
  $("projects").innerHTML = (s.projects || []).map((p) => `
    <div class="project">
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.answers || "")}</p>
      <div class="foot"><span>${p.slug}</span><span>${p.open} open card(s)</span></div>
    </div>`).join("") || `<div class="empty">no project overlays</div>`;
}

function render() {
  if (!state) return;
  if (view === "overview") renderOverview(state);
  else if (view === "board") renderBoard(state);
  else if (view === "knowledge") renderKnowledge(state);
  else if (view === "projects") renderProjects(state);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- actions ---------- */
async function engine(key, action) {
  const data = await post(`/api/engine?key=${key}&action=${action}`);
  toast(data.message, !data.ok);
  poll();
}
async function card(action, id, direction) {
  const data = await post(`/api/card?action=${action}&id=${id}&direction=${direction}`);
  if (data.message) toast(data.message, !data.ok);
  poll();
}
async function search(query) {
  $("search-results").innerHTML = `<div class="hit">searching…</div>`;
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  $("search-results").innerHTML = (data.results || []).map((r) => `
    <div class="hit"><b>${r.score.toFixed(2)}</b> ${escapeHtml(r.note)}<br><span>${escapeHtml(r.answers)}</span></div>`).join("")
    || `<div class="hit">no match${data.message ? ": " + escapeHtml(data.message) : ""}</div>`;
}

/* ---------- polling ---------- */
async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    state = await res.json();
    renderProjects(state);
    render();
  } catch (err) {
    $("dot").className = "dot bad";
    toast("collector unreachable", true);
  }
}

/* ---------- wiring ---------- */
document.querySelectorAll(".nav").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view)));

$("card-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = $("card-title").value.trim();
  if (!title) return;
  const project = $("card-project").value;
  const data = await post(`/api/card?action=add&title=${encodeURIComponent(title)}&project=${encodeURIComponent(project)}`);
  if (!data.ok) toast(data.message || "could not add", true);
  $("card-title").value = "";
  poll();
});

$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = $("search-q").value.trim();
  if (q) search(q);
});

document.addEventListener("keydown", (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "SELECT") return;
  const key = event.key.toLowerCase();
  if (ENGINES[key]) {
    const rec = (state?.managed || {})[key];
    engine(key, rec && rec.alive ? "stop" : "start");
  } else if (key === "s") {
    Object.keys(state?.managed || {}).forEach((k) => engine(k, "stop"));
  } else if (key === "b") setView("board");
  else if (key === "k") setView("knowledge");
  else if (key === "o") setView("overview");
  else if (key === "p") setView("projects");
  else if (key === "r") poll();
});

clock(); setInterval(clock, 1000);
poll(); setInterval(poll, 3000);
