#!/usr/bin/env python3
"""Muther board: the light Windows app face (tkinter, ~25 MB, no browser engine).

    pythonw board.py        # the app, no console window
    python board.py --once  # collect, print the numbers, exit (used by checks)

Same collector and the same engine guards as the web dashboard; only the view
differs. Keys: 1/2/3 start or arm-stop, s stops all, r refreshes, q quits.
"""
from __future__ import annotations

import os
import sys
import threading
import time
import tkinter as tk
from datetime import datetime
from pathlib import Path

import actions
import status as collector

BG = "#08080a"
PANEL = "#0d0d10"
LINE = "#3a2a10"
AMBER = "#ffb000"
AMBER_SOFT = "#ffd27a"
AMBER_DIM = "#9a6f1e"
OK = "#8fd18f"
BAD = "#ff6b5e"
FONT = "Consolas"


class Meter(tk.Canvas):
    def __init__(self, parent, width=320, height=6):
        super().__init__(parent, width=width, height=height, bg="#1a1408",
                         highlightthickness=0)
        self._bar = self.create_rectangle(0, 0, 0, height, fill=AMBER, outline="")

    def set(self, used: float, total: float) -> None:
        width = int(self.cget("width"))
        ratio = 0 if total <= 0 else max(0.0, min(1.0, used / total))
        self.coords(self._bar, 0, 0, width * ratio, int(self.cget("height")))
        colour = BAD if total and used / total > 0.95 else AMBER
        self.itemconfigure(self._bar, fill=colour)


class Panel(tk.Frame):
    def __init__(self, parent, title: str):
        super().__init__(parent, bg=PANEL, highlightbackground=LINE, highlightthickness=1)
        tk.Label(self, text=title.upper(), bg=PANEL, fg=AMBER_DIM, font=(FONT, 8),
                 anchor="w").pack(fill="x", padx=12, pady=(8, 2))
        self.body = tk.Frame(self, bg=PANEL)
        self.body.pack(fill="both", expand=True, padx=12, pady=(0, 10))

    def label(self, text="", size=10, colour=AMBER, bold=False) -> tk.Label:
        widget = tk.Label(self.body, text=text, bg=PANEL, fg=colour, anchor="w",
                          font=(FONT, size, "bold" if bold else "normal"), justify="left")
        widget.pack(fill="x")
        return widget


class Button(tk.Label):
    """Flat label that behaves like a button and looks like the film's console."""

    def __init__(self, parent, text: str, command, colour=AMBER):
        super().__init__(parent, text=text.upper(), bg=PANEL, fg=colour,
                         font=(FONT, 8), padx=8, pady=2, cursor="hand2")
        self._command = command
        self._colour = colour
        self.bind("<Button-1>", lambda _e: self._command())
        self.bind("<Enter>", lambda _e: self.configure(bg="#1c1508"))
        self.bind("<Leave>", lambda _e: self.configure(bg=PANEL))


class Board:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.data: dict | None = None
        self.busy = False
        self.pending: dict = {"key": None, "at": 0.0}

        root.title("MU/TH/UR 6000")
        root.configure(bg=BG)
        root.geometry("1120x800")
        root.minsize(900, 640)
        root.protocol("WM_DELETE_WINDOW", root.destroy)

        self._build()
        root.bind("<Key>", self._key)
        self._tick()
        self._collect()
        root.after(500, self._apply)

    # ---- layout ---------------------------------------------------------
    def _build(self) -> None:
        head = tk.Frame(self.root, bg=BG)
        head.pack(fill="x", padx=18, pady=(14, 8))
        tk.Label(head, text="MU/TH/UR 6000", bg=BG, fg=AMBER_SOFT, font=(FONT, 13, "bold")
                 ).pack(side="left")
        tk.Label(head, text="   personal interface terminal", bg=BG, fg=AMBER_DIM,
                 font=(FONT, 8)).pack(side="left")
        self.clock = tk.Label(head, text="", bg=BG, fg=AMBER_DIM, font=(FONT, 10))
        self.clock.pack(side="right")
        self.dot = tk.Label(head, text="●", bg=BG, fg=AMBER, font=(FONT, 12))
        self.dot.pack(side="right", padx=(0, 8))
        tk.Frame(self.root, bg=LINE, height=1).pack(fill="x", padx=18)

        grid = tk.Frame(self.root, bg=BG)
        grid.pack(fill="both", expand=True, padx=18, pady=12)
        grid.columnconfigure(0, weight=3)
        grid.columnconfigure(1, weight=2)
        grid.rowconfigure(2, weight=1)
        grid.rowconfigure(3, weight=0)

        power = Panel(grid, "power / vram")
        power.grid(row=0, column=0, sticky="nsew", padx=(0, 12), pady=(0, 12))
        self.vram_big = power.label("--", size=26, colour=AMBER, bold=True)
        self.vram_bar = Meter(power.body, width=430)
        self.vram_bar.pack(fill="x", pady=(6, 6))
        self.vram_row = power.label("--", size=9, colour=AMBER_SOFT)

        mem = Panel(grid, "memory")
        mem.grid(row=0, column=1, sticky="nsew", pady=(0, 12))
        self.ram_big = mem.label("--", size=20, colour=AMBER, bold=True)
        self.ram_bar = Meter(mem.body, width=260)
        self.ram_bar.pack(fill="x", pady=(6, 6))
        self.ram_row = mem.label("--", size=9, colour=AMBER_DIM)

        engines = Panel(grid, "engines")
        engines.grid(row=1, column=0, sticky="nsew", padx=(0, 12), pady=(0, 12))
        self.ports = engines.label("", size=9, colour=AMBER_DIM)
        self.engine_rows = tk.Frame(engines.body, bg=PANEL)
        self.engine_rows.pack(fill="x", pady=(6, 0))

        know = Panel(grid, "knowledge")
        know.grid(row=1, column=1, sticky="nsew", pady=(0, 12))
        self.notes_big = know.label("--", size=20, colour=AMBER, bold=True)
        self.map_row = know.label("--", size=9, colour=AMBER_DIM)
        self.inject = know.label("", size=8, colour=AMBER_DIM)

        attention = Panel(grid, "attention")
        attention.grid(row=2, column=1, sticky="nsew")
        self.alerts = attention.label("--", size=10, colour=OK)

        activity = Panel(grid, "activity")
        activity.grid(row=2, column=0, sticky="nsew", padx=(0, 12))
        self.log = tk.Text(activity.body, bg=PANEL, fg=AMBER_DIM, font=(FONT, 8),
                           relief="flat", height=6, wrap="none", borderwidth=0)
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

        foot = tk.Frame(self.root, bg=BG)
        foot.pack(fill="x", padx=18, pady=(0, 10))
        tk.Label(foot, text="1 2 3  start / arm stop      S  stop all      R  refresh      Q  quit",
                 bg=BG, fg=AMBER_DIM, font=(FONT, 8)).pack(side="left")
        self.toast = tk.Label(foot, text="", bg=BG, fg=AMBER_SOFT, font=(FONT, 8))
        self.toast.pack(side="right")

        models = Panel(grid, "models on disk")
        models.grid(row=3, column=0, sticky="nsew", padx=(0, 12), pady=(12, 0))
        self.models_label = models.label("--", size=9, colour=AMBER_SOFT)

        recent = Panel(grid, "recently updated")
        recent.grid(row=3, column=1, sticky="nsew", pady=(12, 0))
        self.recent_label = recent.label("--", size=9, colour=AMBER_DIM)

    # ---- data -----------------------------------------------------------
    def _collect(self) -> None:
        if self.busy:
            return
        self.busy = True

        def work() -> None:
            try:
                self.data = collector.collect()
            finally:
                self.busy = False

        threading.Thread(target=work, daemon=True).start()

    def _tick(self) -> None:
        self.clock.configure(text=datetime.now().strftime("%H:%M:%S"))
        self.root.after(1000, self._tick)
        if not self.busy:
            self._collect()
        self._apply()
        self.root.after(1500, self._apply)

    def _apply(self) -> None:
        d = self.data
        if not d:
            return
        g, r, m = d["gpu"], d["ram"], d["memory"]
        if g.get("present"):
            self.vram_big.configure(text=f"{g['free_mib']:,} MiB free")
            self.vram_bar.set(g["used_mib"], g["total_mib"])
            self.vram_row.configure(
                text=f"{g['name']}   {g['used_mib']} / {g['total_mib']} MiB   "
                     f"util {g['util_pct']}%   power {g['power_w'] or '--'} W")
        self.ram_big.configure(text=f"{r['available_mib']:,} MiB available")
        self.ram_bar.set(r["total_mib"] - r["available_mib"], r["total_mib"])
        self.ram_row.configure(text=f"{r['total_mib']:,} MiB total   load {r['load_pct']}%   "
                                    f"{d['disk']['drive']} free {d['disk']['free_gib']} GiB")
        self.ports.configure(text="   ".join(
            f":{p['port']} {'UP' if p['open'] else '--'}" for p in d["ports"]))
        self.notes_big.configure(text=f"{m['notes']} notes")
        self.map_row.configure(text=f"map {m['map_chars']} chars")
        self.inject.configure(text=(m["last_injection"] or "")[:78])

        for child in self.engine_rows.winfo_children():
            child.destroy()
        managed = d.get("managed") or {}
        for key, spec in actions.ENGINES.items():
            rec = managed.get(key)
            alive = bool(rec and rec.get("alive"))
            row = tk.Frame(self.engine_rows, bg=PANEL)
            row.pack(fill="x", pady=1)
            tk.Label(row, text=f"[{key}] {spec['name']}", bg=PANEL, fg=AMBER,
                     font=(FONT, 10), anchor="w", width=22).pack(side="left")
            tk.Label(row, text="running" if alive else "stopped", bg=PANEL,
                     fg=OK if alive else AMBER_DIM, font=(FONT, 8), width=9
                     ).pack(side="left")
            button = Button(row, "stop" if alive else "start",
                            lambda k=key: self._action(k), BAD if alive else AMBER)
            button.pack(side="right")
            if rec and rec.get("pid"):
                tk.Label(row, text=f"pid {rec['pid']}", bg=PANEL, fg=AMBER_DIM,
                         font=(FONT, 8)).pack(side="right", padx=8)

        alerts = d["alerts"]
        self.alerts.configure(text="\n".join(alerts) if alerts else "all systems within limits",
                              fg=BAD if alerts else OK)
        self.dot.configure(fg=BAD if alerts else AMBER)

        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert("end", "\n".join(line.strip() for line in m.get("log_lines", [])[-6:]))
        self.log.configure(state="disabled")

        models = d.get("models") or []
        self.models_label.configure(text="\n".join(
            f"{item['gib']:>5.1f} GiB  {item['name'][:58]}" for item in models) or "no GGUF files")
        recent = d.get("recent") or []
        self.recent_label.configure(text="\n".join(
            f"{item['updated']}  {item['note']}" for item in recent) or "none")

    # ---- actions --------------------------------------------------------
    def _action(self, key: str) -> None:
        managed = (self.data or {}).get("managed") or {}
        rec = managed.get(key)
        if rec and rec.get("alive"):
            if self.pending["key"] == key and time.time() - self.pending["at"] < 4:
                self._run(actions.stop, key)
                self.pending["key"] = None
            else:
                self.pending.update(key=key, at=time.time())
                self._say(f"press {key} again within 4s to stop {rec.get('name', key)}")
        else:
            self.pending["key"] = None
            self._run(actions.start, key)

    def _run(self, fn, key: str) -> None:
        def work() -> None:
            try:
                ok, message = fn(key)
            except Exception as exc:
                ok, message = False, f"{key}: {exc}"
            self.root.after(0, lambda: self._say(message))

        threading.Thread(target=work, daemon=True).start()

    def _say(self, message: str) -> None:
        self.toast.configure(text=message[:96])
        self.root.after(6000, lambda: self.toast.configure(text=""))
        self._collect()

    def _key(self, event) -> None:
        key = (event.keysym or "").lower()
        if key in actions.ENGINES:
            self._action(key)
        elif key == "s":
            for k in list((self.data or {}).get("managed") or {}):
                self._run(actions.stop, k)
        elif key == "r":
            self._collect()
        elif key == "q":
            self.root.destroy()


def dark_title(root: tk.Tk) -> None:
    """Windows draws a white title bar otherwise, which ruins an amber console."""
    try:
        import ctypes
        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        on = ctypes.c_int(1)
        for attr in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE, pre-20H1 variant
            ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd, attr, ctypes.byref(on), ctypes.sizeof(on))
    except Exception:
        pass


def report_failure(exc: BaseException) -> None:
    """Never die silently: log the traceback and show it when there is no console."""
    import traceback
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    log = Path(__file__).with_name("board-error.log")
    try:
        log.write_text(f"{datetime.now().isoformat(timespec='seconds')}\n{text}",
                       encoding="utf-8")
    except OSError:
        pass
    print(text, file=sys.stderr)
    if os.environ.get("MUTHER_NO_DIALOG") == "1":
        return
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            None, f"{text[-1200:]}\n\nlog: {log}", "Muther failed to start", 0x10)
    except Exception:
        pass


def main() -> int:
    if "--once" in sys.argv:
        d = collector.collect()
        print(f"vram {d['gpu'].get('free_mib')} MiB free, ram {d['ram']['available_mib']} MiB, "
              f"notes {d['memory']['notes']}, alerts {len(d['alerts'])}")
        return 0
    root = tk.Tk()
    try:
        Board(root)
        dark_title(root)
        root.mainloop()
    except Exception as exc:  # a crash must be readable, not a closed window
        report_failure(exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
