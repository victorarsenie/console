#!/usr/bin/env python3
"""Start and stop the local engines from the interface, safely.

Rules that matter more than features:
  - never start a second engine while :8080 is occupied (the port belongs to one
    arm at a time; a stale server silently serves the wrong model);
  - only stop a process this module started, tracked by pid;
  - kill the whole tree, because the launcher is a .bat that spawns the server.

    python actions.py --list        # registry + whether each launcher exists
    python actions.py --state       # what this module has running
    python actions.py --start 1     # start entry 1
    python actions.py --stop 1      # stop entry 1

Stdlib only.
"""
from __future__ import annotations

import json
import socket
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "engines.json"
LLAMA = Path(r"E:\AI\engines\llama")
STRATA = Path(r"E:\AI\engines\strata")

ENGINES = {
    "1": {"name": "strata-flash-coder-150k", "ctx": 150000, "bat": STRATA / "run-coder-iq1_m.bat"},
    "2": {"name": "swift-27b-120k-MTP", "ctx": 120000, "bat": LLAMA / "run_swift_IQ3XXS_120k_k8v4_MTP.bat"},
    "3": {"name": "swift-27b-131k", "ctx": 131072, "bat": LLAMA / "run_swift_IQ3S_131k_k8v4.bat"},
    "4": {"name": "swift-27b-80k-MTP", "ctx": 80000, "bat": LLAMA / "run_swift_IQ3S_80k_k8v4_MTP.bat"},
    "5": {"name": "old-27b-128k", "ctx": 131072, "bat": LLAMA / "run_3.8_vision_128k.bat"},
    "6": {"name": "flash-next-262k", "ctx": 262144, "bat": STRATA / "run-iq2_xs.bat"},
}

CREATE_NEW_CONSOLE = 0x00000010
NO_WINDOW = 0x08000000


def port_open(port: int = 8080, host: str = "127.0.0.1") -> bool:
    s = socket.socket()
    s.settimeout(0.15)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def load() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save(data: dict) -> None:
    STATE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def alive(pid: int) -> bool:
    if not pid:
        return False
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                         capture_output=True, text=True,
                         creationflags=NO_WINDOW).stdout
    return str(pid) in out


def start(key: str) -> tuple[bool, str]:
    entry = ENGINES.get(key)
    if not entry:
        return False, f"no engine {key}"
    if not entry["bat"].is_file():
        return False, f"launcher missing: {entry['bat']}"
    if port_open():
        return False, "port 8080 is already in use - refusing to start a second engine"
    running = {k: v for k, v in load().items() if alive(v.get("pid", 0))}
    if running:
        return False, f"already running: {', '.join(v['name'] for v in running.values())} - stop it first"
    proc = subprocess.Popen([str(entry["bat"])], cwd=str(entry["bat"].parent),
                            creationflags=CREATE_NEW_CONSOLE)
    state = load()
    state[key] = {"name": entry["name"], "pid": proc.pid,
                  "started": datetime.now().isoformat(timespec="seconds"),
                  "bat": str(entry["bat"])}
    save(state)
    return True, f"started {entry['name']} (pid {proc.pid}); waiting for :8080"


def stop(key: str) -> tuple[bool, str]:
    state = load()
    record = state.get(key)
    if not record:
        return False, f"nothing recorded for engine {key}"
    pid = record.get("pid")
    if pid and alive(pid):
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, text=True, creationflags=NO_WINDOW)
        state.pop(key, None)
        save(state)
        return True, f"stopped {record['name']} (pid {pid})"
    state.pop(key, None)
    save(state)
    return False, f"{record['name']} was already gone"


def state() -> dict:
    data = load()
    out = {}
    for key, record in data.items():
        out[key] = dict(record, alive=alive(record.get("pid", 0)))
    return out


def main() -> int:
    args = sys.argv[1:]
    if "--list" in args:
        for key, entry in ENGINES.items():
            mark = "ok" if entry["bat"].is_file() else "MISSING"
            print(f"  [{key}] {entry['name']:<16} {mark:<8} {entry['bat']}")
        print(f"  port 8080: {'in use' if port_open() else 'free'}")
        return 0
    if "--state" in args:
        print(json.dumps({"running": state(), "port_8080": port_open()}, indent=2))
        return 0
    for flag, fn in (("--start", start), ("--stop", stop)):
        if flag in args:
            key = args[args.index(flag) + 1] if len(args) > args.index(flag) + 1 else ""
            ok, message = fn(key)
            print(message)
            return 0 if ok else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
