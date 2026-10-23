#!/usr/bin/env python3
"""Muther's window: a real app window over the live machine state.

    python window.py                 # serve on :8123, open nothing
    python window.py --open          # serve and open a Chrome app window
    python window.py --open --disable-gpu

The page is plain HTML/CSS/JS in `web/` served by a stdlib HTTP server; the window
is Chrome in app mode (no tabs, no address bar), which is why it reads as a native
app without shipping Electron or building Tauri.

Routes:
    GET  /                    the dashboard
    GET  /app.css /app.js     static assets
    GET  /api/state           collector JSON
    POST /api/engine?key=1&action=start|stop    engine control with guards

Measured cost: ~529 MB RAM, ~3 MB VRAM while open. Close it before a benchmark;
at 150k the coder leaves only ~1-2 GiB free.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import actions
import status as collector

PORT = 8123
WEB = Path(__file__).resolve().parent / "web"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml"}


def search_knowledge(query: str) -> dict:
    """Ask kb.py for a BM25 ranking; the memory repo owns that logic, not this UI."""
    kb = Path(r"E:\AI\memory\ai-unlimited-memory\kb.py")
    if not kb.is_file():
        return {"ok": False, "results": [], "message": "kb.py not found"}
    try:
        res = subprocess.run([sys.executable, str(kb), "similar", query, "--top", "6"],
                             cwd=str(kb.parent), capture_output=True, text=True,
                             timeout=25, creationflags=0x08000000)
    except Exception as exc:
        return {"ok": False, "results": [], "message": str(exc)}
    results = []
    for line in res.stdout.splitlines():
        match = re.match(r"^\s+([\d.]+)\s+(\S+)\s+(.*)$", line)
        if match:
            results.append({"score": float(match.group(1)),
                            "note": match.group(2), "answers": match.group(3).strip()})
    return {"ok": bool(results), "results": results,
            "message": "" if results else res.stdout.strip()[:200]}


ALLOWED_ROOTS = (
    r"E:\AI\memory\ai-unlimited-memory",
    r"E:\AI\console",
    r"E:\AI\muther",
    r"E:\AI\research",
)


def open_path(raw: str, dry: bool = False) -> tuple[bool, str]:
    """Open a file with the OS default application, inside allowed roots only."""
    import os
    from pathlib import Path
    try:
        path = Path(raw).expanduser().resolve()
    except Exception as exc:
        return False, f"bad path: {exc}"
    if not any(str(path).lower().startswith(root.lower()) for root in ALLOWED_ROOTS):
        return False, "outside the allowed roots"
    if not path.is_file():
        return False, "not a file"
    if dry:
        return True, f"would open {path.name}"
    try:
        os.startfile(str(path))
        return True, f"opened {path.name}"
    except Exception as exc:
        return False, str(exc)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict, code: int = 200) -> None:
        self._send(code, json.dumps(payload).encode("utf-8"), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/state":
            try:
                self._json(collector.collect())
            except Exception as exc:
                self._json({"error": str(exc)}, 500)
            return
        if path == "/api/workflows":
            import workflows
            self._json({"workflows": workflows.list_workflows()})
            return
        if path == "/api/open":
            query = parse_qs(urlparse(self.path).query)
            ok, message = open_path((query.get("path") or [""])[0], bool(query.get("dry")))
            self._json({"ok": ok, "message": message})
            return
        if path == "/api/search":
            query = (parse_qs(urlparse(self.path).query).get("q") or [""])[0].strip()
            if not query:
                self._json({"ok": False, "results": [], "message": "empty query"}, 400)
                return
            self._json(search_knowledge(query))
            return
        file = WEB / ("index.html" if path == "/" else path.lstrip("/"))
        if not file.is_file() or WEB not in file.resolve().parents:
            self._send(404, b"not found", "text/plain")
            return
        self._send(200, file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"))

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/card":
            import work
            action = (query.get("action") or [""])[0]
            try:
                if action == "add":
                    card = work.add((query.get("title") or [""])[0],
                                    (query.get("project") or [""])[0])
                    self._json({"ok": True, "card": card, "board": work.summary()})
                elif action == "move":
                    card = work.move((query.get("id") or [""])[0],
                                     (query.get("direction") or ["next"])[0])
                    self._json({"ok": bool(card), "board": work.summary()})
                elif action == "delete":
                    self._json({"ok": work.remove((query.get("id") or [""])[0]),
                                "board": work.summary()})
                else:
                    self._json({"ok": False, "message": f"unknown action: {action}"}, 400)
            except Exception as exc:
                self._json({"ok": False, "message": str(exc)}, 500)
            return
        if parsed.path == "/api/run":
            import workflows
            ok, message = workflows.run((query.get("name") or [""])[0])
            self._json({"ok": ok, "message": message})
            return
        if parsed.path != "/api/engine":
            self._json({"ok": False, "message": "unknown endpoint"}, 404)
            return
        key = (query.get("key") or [""])[0]
        action = (query.get("action") or [""])[0]
        try:
            if action == "start":
                ok, message = actions.start(key)
            elif action == "stop":
                ok, message = actions.stop(key)
            else:
                ok, message = False, f"unknown action: {action}"
        except Exception as exc:
            ok, message = False, f"{key}: {exc}"
        self._json({"ok": ok, "message": message})

    def log_message(self, *args) -> None:
        pass


def free_port(start: int = PORT, tries: int = 8) -> int:
    import socket
    for candidate in range(start, start + tries):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", candidate)); return candidate
            except OSError:
                continue
    raise SystemExit("no free port")


def serve(port: int = PORT) -> ThreadingHTTPServer:
    """Bind the dashboard server; the caller decides where it runs."""
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> int:
    global PORT
    args = sys.argv[1:]
    if "--port" in args:
        PORT = int(args[args.index("--port") + 1])
    PORT = free_port(PORT)
    httpd = serve(PORT)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"window: {url}")
    if "--open" in args:
        if not CHROME.is_file():
            print("window: chrome not found, open the URL manually")
        else:
            flags = [str(CHROME), f"--app={url}", "--window-size=1220,840",
                     *(["--start-fullscreen"] if "--fullscreen" in args else []),
                     "--no-first-run", "--no-default-browser-check",
                     f"--user-data-dir={Path.home() / '.muther-ui'}"]
            if "--disable-gpu" in args:
                flags.append("--disable-gpu")
            threading.Timer(0.8, lambda: subprocess.Popen(
                flags, creationflags=0x00000008,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
