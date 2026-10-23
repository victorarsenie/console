#!/usr/bin/env python3
"""Collect machine state for the Muther interface.

Writes one JSON document. Everything here is measured, nothing is estimated:
GPU through nvidia-smi, RAM through GlobalMemoryStatusEx, ports through a TCP
connect, the memory layer by reading its files, activity from the injection log.

    python status.py            # write status.json next to this file
    python status.py --json     # print it instead

Stdlib only. Takes ~150 ms because tasklist and nvidia-smi are subprocesses.
"""
from __future__ import annotations

import ctypes
import json
import os
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HOME = Path(r"E:\AI\memory\ai-unlimited-memory")
OUT = Path(__file__).resolve().parent / "status.json"
INJECT_LOG = Path(__import__("os").environ.get("TEMP", r"C:\Windows\Temp")) / "kb-inject.log"
PORTS = {8080: "model server", 8090: "embedder", 3000: "portfolio dev"}


def _run(cmd: list[str], timeout: float = 4.0) -> str:
    # CREATE_NO_WINDOW: without it every child of a windowless process gets its
    # own console, so a 2 s poll flashes a cmd window on the desktop.
    flags = 0x08000000 if os.name == "nt" else 0
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                             creationflags=flags)
        return res.stdout.strip()
    except Exception:
        return ""


def gpu() -> dict:
    out = _run(["nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,power.draw",
                "--format=csv,noheader,nounits"])
    if not out:
        return {"present": False}
    name, total, used, free, util, power = [p.strip() for p in out.split(",")]
    return {
        "present": True, "name": name,
        "total_mib": int(float(total)), "used_mib": int(float(used)),
        "free_mib": int(float(free)), "util_pct": int(float(util)),
        "power_w": float(power) if power not in ("[N/A]", "") else None,
    }


def ram() -> dict:
    class MEMSTATUS(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    stat = MEMSTATUS()
    stat.dwLength = ctypes.sizeof(MEMSTATUS)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
    return {
        "total_mib": int(stat.ullTotalPhys / 1048576),
        "available_mib": int(stat.ullAvailPhys / 1048576),
        "load_pct": int(stat.dwMemoryLoad),
    }


def disk(letter: str = "E:") -> dict:
    try:
        free = ctypes.c_ulonglong(0)
        ctypes.windll.kernel32.GetDiskFreeSpaceExW(
            ctypes.c_wchar_p(letter + "\\"), None, None, ctypes.byref(free))
        return {"drive": letter, "free_gib": round(free.value / 1073741824, 1)}
    except Exception:
        return {"drive": letter, "free_gib": None}


def ports() -> list[dict]:
    out = []
    for port, what in PORTS.items():
        s = socket.socket()
        s.settimeout(0.15)
        try:
            s.connect(("127.0.0.1", port))
            out.append({"port": port, "what": what, "open": True})
        except OSError:
            out.append({"port": port, "what": what, "open": False})
        finally:
            s.close()
    return out


def tasklist_rows() -> list[tuple[str, int, int]]:
    """One tasklist call, reused for engine detection and managed-pid checks."""
    rows = []
    for line in _run(["tasklist", "/fo", "csv", "/nh"]).splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) < 2 or not parts[1].isdigit():
            continue
        digits = "".join(c for c in parts[-1].split()[0] if c.isdigit())
        rows.append((parts[0], int(parts[1]), round(int(digits) / 1024) if digits else 0))
    return rows


def engines_from(rows: list[tuple[str, int, int]]) -> list[dict]:
    wanted = {"llama-server.exe", "strata.exe", "strata-poly.exe"}
    return [{"name": n, "pid": p, "rss_mib": r} for n, p, r in rows if n.lower() in wanted]


def managed_from(rows: list[tuple[str, int, int]]) -> dict:
    """Engines the interface started, with liveness checked against the same rows."""
    try:
        record = json.loads((Path(__file__).resolve().parent / "engines.json").read_text(encoding="utf-8"))
    except Exception:
        return {}
    pids = {p for _, p, _ in rows}
    return {k: dict(v, alive=v.get("pid") in pids) for k, v in record.items()}


def _tail_lines(path: Path, count: int = 5) -> list[str]:
    try:
        with path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 8192))
            lines = fh.read().decode("utf-8", "replace").splitlines()
        return [ln for ln in lines if ln.strip()][-count:]
    except OSError:
        return []


def memory_layer() -> dict:
    kb = HOME / "knowledge"
    notes = [p for p in kb.rglob("*.md")
             if p.name.lower() not in ("index.md", "_domain.md")
             and "_archive" not in p.parts and "pending" not in p.parts]
    try:
        map_size = (kb / "INDEX.md").stat().st_size
    except OSError:
        map_size = 0
    tail = _tail_lines(INJECT_LOG, 1)
    last = tail[-1] if tail else ""
    return {
        "notes": len(notes),
        "map_chars": map_size,
        "last_injection": last[:120] if last else None,
        "log_lines": _tail_lines(INJECT_LOG, 5),
    }


def models(limit: int = 6) -> list[dict]:
    folder = Path(r"E:\AI\models\gguf")
    rows = []
    for p in folder.glob("*.gguf"):
        try:
            rows.append({"name": p.stem, "gib": round(p.stat().st_size / 1073741824, 1)})
        except OSError:
            continue
    return sorted(rows, key=lambda r: -r["gib"])[:limit]


def recent_notes(limit: int = 5) -> list[dict]:
    """Notes by front-matter `updated`, newest first — the same field kb.py indexes."""
    kb = HOME / "knowledge"
    rows = []
    for p in kb.rglob("*.md"):
        if p.name.lower() in ("index.md", "_domain.md") or "_archive" in p.parts:
            continue
        try:
            head = p.read_text(encoding="utf-8-sig")[:400]
        except OSError:
            continue
        stamp = ""
        for line in head.splitlines():
            if line.startswith("updated:"):
                stamp = line.split(":", 1)[1].strip()
                break
        if stamp:
            rows.append({"note": str(p.relative_to(kb)).replace("\\", "/"), "updated": stamp})
    return sorted(rows, key=lambda r: r["updated"], reverse=True)[:limit]


def work_state() -> dict:
    try:
        import work
        board = work.load()
        return {column: cards for column, cards in board.items()}
    except Exception:
        return {}


def projects() -> list[dict]:
    """One row per project overlay: what it is, and how many open cards it has."""
    root = HOME / "knowledge" / "projects"
    open_cards: dict[str, int] = {}
    for column, cards in work_state().items():
        if column == "done":
            continue
        for card in cards:
            key = card.get("project") or ""
            open_cards[key] = open_cards.get(key, 0) + 1
    rows = []
    for folder in sorted(root.iterdir()) if root.is_dir() else []:
        meta_file = folder / "project.md"
        if not (folder.is_dir() and meta_file.is_file()):
            continue
        head = meta_file.read_text(encoding="utf-8-sig")[:600]
        title = next((l.split(":", 1)[1].strip() for l in head.splitlines()
                      if l.startswith("title:")), folder.name)
        answers = next((l.split(":", 1)[1].strip() for l in head.splitlines()
                        if l.startswith("answers:")), "")
        rows.append({"slug": folder.name, "title": title, "answers": answers,
                     "open": open_cards.get(folder.name, 0)})
    return rows


def knowledge() -> dict:
    kb = HOME / "knowledge"
    domains = []
    for folder in sorted(kb.iterdir()) if kb.is_dir() else []:
        meta_file = folder / "_domain.md"
        if not (folder.is_dir() and meta_file.is_file()):
            continue
        notes = [p for p in folder.glob("*.md") if p.name.lower() not in ("index.md", "_domain.md")]
        domains.append({"name": folder.name, "notes": len(notes)})
    pending_dir = kb / "pending"
    pending = 0
    if pending_dir.is_dir():
        for file in pending_dir.glob("*.md"):
            pending += sum(1 for line in file.read_text(encoding="utf-8-sig").splitlines()
                           if line.startswith("- "))
    return {"domains": domains, "pending": pending}


def needs() -> list[dict]:
    """What waits for a human, in one list."""
    items = [{"kind": "alert", "text": alert} for alert in collect_alerts()]
    pending = knowledge().get("pending", 0)
    if pending:
        items.append({"kind": "capture", "text": f"{pending} capture candidate(s) awaiting review"})
    for column, cards in work_state().items():
        if column != "doing":
            continue
        for card in cards:
            items.append({"kind": "card", "text": f"in progress: {card['title']}"})
    return items


def collect_alerts() -> list[str]:
    g, r = gpu(), ram()
    alerts = []
    if g.get("present") and g["free_mib"] < 1024:
        alerts.append(f"VRAM free {g['free_mib']} MiB - below the 1024 reserve")
    if g.get("present") and g["free_mib"] < 300:
        alerts.append("VRAM in the WDDM eviction zone (<300 MiB)")
    if r["available_mib"] < 2048:
        alerts.append(f"RAM available {r['available_mib']} MiB - expert spill likely")
    return alerts


def collect() -> dict:
    g, r = gpu(), ram()
    rows = tasklist_rows()
    procs = engines_from(rows)
    return {
        "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "gpu": g, "ram": r, "disk": disk(), "ports": ports(),
        "processes": procs, "managed": managed_from(rows),
        "memory": memory_layer(), "alerts": collect_alerts(),
        "models": models(), "recent": recent_notes(),
        "board": work_state(), "projects": projects(),
        "knowledge": knowledge(), "needs": needs(),
    }


def main() -> int:
    data = collect()
    if "--json" in sys.argv:
        print(json.dumps(data, indent=2))
        return 0
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"status: {OUT} ({len(data['alerts'])} alert(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
