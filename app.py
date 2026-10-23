#!/usr/bin/env python3
"""Muther as a normal Windows app window: WebView2, no browser chrome.

    pythonw app.py          # the app (no console)
    python app.py           # same, with a console for errors

The page is the same `web/` dashboard; the difference from `window.py --open` is
that there is no Chrome, no tabs and no address bar — it is a window owned by this
program, titled MU/TH/UR 6000, sized like an app.

Why WebView2 and not Electron: WebView2 is already installed on Windows 11 and a
WebView2 window costs far less than a 529 MB Chromium profile. Why not Tauri:
that needs a Rust toolchain, which this machine does not have.

Measured: see README.md. Close it before a benchmark; the 150k coder leaves only
~1-2 GiB free.
"""
from __future__ import annotations

import os
import sys
import threading

import webview

import window

PORT = 8123


def report_failure(exc: BaseException) -> None:
    """A window that dies silently is worse than one that says why."""
    import traceback
    from pathlib import Path
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    log = Path(__file__).with_name("console-error.log")
    try:
        log.write_text(text, encoding="utf-8")
    except OSError:
        pass
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text[-1200:] + f"\n\nlog: {log}",
                                         "Console failed to start", 0x10)
    except Exception:
        pass


class WindowApi:
    """The page calls these for window behaviour the browser cannot do itself."""

    def __init__(self) -> None:
        self.window = None

    def toggle_fullscreen(self) -> bool:
        if self.window is not None:
            self.window.toggle_fullscreen()
            return bool(self.window.fullscreen)
        return False

    def minimize(self) -> None:
        if self.window is not None:
            self.window.minimize()

    def close_window(self) -> None:
        if self.window is not None:
            self.window.destroy()


def free_port(start: int = 8123, tries: int = 8) -> int:
    """First port we can actually bind; a stale server must not crash the app."""
    import socket
    for candidate in range(start, start + tries):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", candidate))
                return candidate
            except OSError:
                continue
    raise SystemExit("no free port for the console")


def main() -> int:
    global PORT
    PORT = free_port(PORT)
    httpd = window.serve(PORT)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        api = WindowApi()
        api.window = webview.create_window(
            "MU/TH/UR 6000",
            f"http://127.0.0.1:{PORT}/",
            width=1220,
            height=840,
            min_size=(860, 560),
            background_color="#08080a",
            text_select=True,
            fullscreen=True,
            js_api=api,
        )
        import tempfile
        from pathlib import Path
        storage = Path(tempfile.gettempdir()) / f"console-ui-{os.getpid()}"
        webview.start(storage_path=str(storage))  # blocks until the window closes
    except Exception as exc:
        report_failure(exc)
        return 1
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
