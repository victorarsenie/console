#!/usr/bin/env python3
"""Muther's terminal face: an amber status board over the same files the agents read.

    python tui.py           # live board (q quits, r refreshes now)
    python tui.py --once    # print one frame and exit (used by checks)

No dependencies. Collection happens on a worker thread because tasklist costs
~1 s; the board redraws on a 0.5 s tick regardless. Padding is computed on the
visible text, never on the escape sequences, or the borders drift.
"""
from __future__ import annotations

import ctypes
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import status as collector
import actions

AMBER = "\x1b[38;5;214m"
AMBER_DIM = "\x1b[38;5;172m"
GREY = "\x1b[38;5;245m"
RED = "\x1b[38;5;203m"
GREEN = "\x1b[38;5;114m"
RESET = "\x1b[0m"
BOLD = "\x1b[1m"

WIDTH = 78
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def enable_vt() -> None:
    """Windows consoles need this before ANSI escapes do anything."""
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_ulong()
        kernel32.GetConsoleMode(handle, ctypes.byref(mode))
        kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        pass


def visible(text: str) -> int:
    return len(ANSI.sub("", text))


def fit(text: str, width: int) -> str:
    text = text[:width]
    return text + " " * (width - len(text))


def bar(used: int, total: int, width: int = 24) -> str:
    if total <= 0:
        return ""
    filled = max(0, min(width, round(width * used / total)))
    return "[" + "#" * filled + "." * (width - filled) + "]"


def panel(title: str, rows: list[tuple[str, str]]) -> list[str]:
    rule = f"{AMBER_DIM}+{'-' * (WIDTH - 2)}+{RESET}"
    out = [rule,
           f"{AMBER_DIM}|{RESET} {AMBER}{BOLD}{fit(title, WIDTH - 3)}{RESET}{AMBER_DIM}|{RESET}",
           rule]
    for text, colour in rows:
        out.append(f"{AMBER_DIM}|{RESET} {colour}{fit(text, WIDTH - 3)}{RESET}{AMBER_DIM}|{RESET}")
    return out


def render(data: dict) -> str:
    g, r, m = data["gpu"], data["ram"], data["memory"]
    lines: list[str] = []

    head = fit(" MU/TH/UR 6000   interface terminal", WIDTH - 9)
    lines.append(f"{AMBER}{BOLD}{head}{datetime.now().strftime('%H:%M:%S')}{RESET}")
    lines.append(f"{AMBER_DIM}{'=' * WIDTH}{RESET}")

    if g.get("present"):
        gpu_rows = [
            (f"{g['name']}   {g['used_mib']:>5} / {g['total_mib']} MiB   "
             f"{bar(g['used_mib'], g['total_mib'])}", AMBER),
            (f"free {g['free_mib']:>5} MiB   util {g['util_pct']:>3}%   "
             f"power {g['power_w'] if g['power_w'] is not None else '--'} W", AMBER),
        ]
    else:
        gpu_rows = [("no NVIDIA device reported by nvidia-smi", RED)]
    lines += panel("POWER / VRAM", gpu_rows)

    lines += panel("MEMORY", [
        (f"{r['available_mib']:>6} MiB available of {r['total_mib']}   load {r['load_pct']}%   "
         f"{bar(r['total_mib'] - r['available_mib'], r['total_mib'])}", AMBER),
        (f"{data['disk']['drive']} free {data['disk']['free_gib']} GiB", GREY),
    ])

    engine_rows: list[tuple[str, str]] = []
    for p in data["ports"]:
        engine_rows.append((f":{p['port']:<5} {p['what']:<16} "
                            + ("LISTEN" if p["open"] else "closed"),
                            GREEN if p["open"] else GREY))
    for proc in data["processes"]:
        engine_rows.append((f"pid {proc['pid']:<6} {proc['name']:<16} rss {proc['rss_mib']} MiB",
                            AMBER))
    for key, rec in sorted(data.get("managed", {}).items()):
        up = rec.get("alive")
        engine_rows.append((f"[{key}] {rec.get('name', key):<14} "
                            + ("up  " if up else "dead") + f" pid {rec.get('pid')}",
                            GREEN if up else GREY))
    if not data["processes"]:
        engine_rows.append(("no engine process holding the card", GREY))
    lines += panel("ENGINES", engine_rows)

    last = m["last_injection"] or "no injection logged"
    lines += panel("KNOWLEDGE", [
        (f"{m['notes']} notes   map {m['map_chars']} chars", AMBER),
        (last, GREY),
    ])

    if data["alerts"]:
        lines += panel("ATTENTION", [(a, RED) for a in data["alerts"]])
    else:
        lines += panel("ATTENTION", [("all systems within limits", GREEN)])

    activity = [ln.strip() for ln in m.get("log_lines", [])][-3:]
    lines += panel("ACTIVITY", [(a, GREY) for a in activity] or [("idle", GREY)])

    lines.append(f"{AMBER_DIM}{'=' * WIDTH}{RESET}")
    note = LAST.get("msg")
    if note and time.time() - LAST.get("at", 0) < 6:
        lines.append(f"{AMBER}{fit(note, WIDTH)}{RESET}")
    lines.append(f"{AMBER_DIM} 1/2/3 start-stop   s stop all   w window   q quit   "
                 f"r refresh   {data['ts'][11:19]}{RESET}")
    return "\n".join(lines)


LAST: dict = {"msg": "", "at": 0.0}


def chime(kind: str = "boot") -> None:
    """Machine-room cue. Short, synthesised, no sample files."""
    def play() -> None:
        try:
            import winsound
            seq = {"boot": [(196, 110), (147, 170), (98, 240)],
                   "ok": [(440, 80)], "warn": [(220, 140), (220, 140)]}[kind]
            for freq, ms in seq:
                winsound.Beep(freq, ms)
        except Exception:
            pass
    threading.Thread(target=play, daemon=True).start()


def boot() -> None:
    for line in ("MU/TH/UR 6000", "core interface .......... online",
                 "knowledge layer ......... mounted", "engines ................. polling"):
        print(f"{AMBER_DIM}{line}{RESET}", flush=True)
        time.sleep(0.12)


def main() -> int:
    if "--once" in sys.argv:
        print(render(collector.collect()))
        return 0

    enable_vt()
    if "--no-sound" not in sys.argv:
        chime("boot")
    boot()
    state: dict = {"data": None, "busy": False}
    pending: dict = {"key": None, "at": 0.0}

    def worker() -> None:
        try:
            state["data"] = collector.collect()
        finally:
            state["busy"] = False

    def refresh() -> None:
        if not state["busy"]:
            state["busy"] = True
            threading.Thread(target=worker, daemon=True).start()

    def run_action(fn, key: str) -> None:
        def go() -> None:
            try:
                ok, message = fn(key)
            except Exception as exc:
                ok, message = False, f"{key}: {exc}"
            LAST.update(msg=message, at=time.time())
            chime("ok" if ok else "warn")
            refresh()
        threading.Thread(target=go, daemon=True).start()

    refresh()
    deadline = time.time() + 8
    while state["data"] is None and time.time() < deadline:
        time.sleep(0.05)

    next_refresh = time.time() + 5
    try:
        import msvcrt
        while True:
            if state["data"]:
                sys.stdout.write("\x1b[2J\x1b[H" + render(state["data"]))
                sys.stdout.flush()
            if time.time() >= next_refresh:
                refresh()
                next_refresh = time.time() + 5
            if msvcrt.kbhit():
                key = msvcrt.getwch().lower()
                if key == "q":
                    break
                if key == "r":
                    refresh()
                elif key in actions.ENGINES:
                    running = actions.state().get(key)
                    if running and running.get("alive"):
                        if pending["key"] == key and time.time() - pending["at"] < 4:
                            run_action(actions.stop, key)
                            pending["key"] = None
                        else:
                            pending.update(key=key, at=time.time())
                            LAST.update(msg=f"press {key} again within 4s to stop "
                                            f"{running['name']}", at=time.time())
                    else:
                        pending["key"] = None
                        run_action(actions.start, key)
                elif key == "s":
                    for k in list(actions.state()):
                        run_action(actions.stop, k)
                elif key == "w":
                    subprocess.Popen(
                        [sys.executable, str(Path(__file__).resolve().parent / "window.py"), "--open"],
                        creationflags=0x00000008,  # detached: it is a server, not a console
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    LAST.update(msg="window: http://127.0.0.1:8123/ (529 MB while open)", at=time.time())
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write(RESET + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
