# Muther interface

Two faces, one collector, one set of engine guards.

| face | launch | RAM | when |
|---|---|---|---|
| **board** (default) | `muther.bat` | **25–31 MB** | always — runs fine while a model is pinned |
| **dashboard** | `muther-web.bat` | ~550 MB (94 python + 457 WebView2) | when no model is loaded |
| terminal board | `python tui.py` | 17 MB | inside an existing terminal |
| Chrome app | `python window.py --open` | 529 MB | fallback if WebView2 is missing |

`muther.bat` starts `board.py` with `pythonw`, so there is no console window. The
dashboard is the same page in a WebView2 window (`app.py`), no Chrome branding,
no tabs, no address bar.

## Keys (board and dashboard)

| key | action |
|---|---|
| `1` `2` `3` | start that engine, or arm its stop (press again within 4 s) |
| `s` | stop every engine the board started |
| `r` | refresh |
| `q` | quit (board) |

Engines: `1` swift 120k, `2` coder strata, `3` swift 64k. Registry in `actions.py`.

## Guards (why `actions.py` exists)

- Refuses to start while **:8080 is occupied** — one arm at a time, or the next
  process silently talks to a stale model.
- Refuses a second start while an engine it manages is alive.
- Stops only pids it recorded (`engines.json`), killing the `.bat` tree.
- Nothing stops a model because a window closed.

## Files

| file | role |
|---|---|
| `status.py` | collector: GPU, RAM, disk, ports, engine processes, knowledge counts, models on disk, recent notes |
| `actions.py` | engine registry, start/stop with guards |
| `board.py` | tkinter app window (default face) |
| `app.py` | WebView2 window hosting the dashboard |
| `window.py` | dashboard server + `/api/state`, `/api/engine`; Chrome fallback |
| `web/` | the dashboard: `index.html`, `app.css`, `app.js` |
| `tui.py` | terminal board |

## Verified

- Collector + dashboard API: `/api/state` returns live values; `/api/engine` returns
  refusals correctly (`stop` with nothing recorded, unknown key).
- Port guard: with a dummy listener on :8080, a start refuses and exits 1.
- Dashboard visual check: headless screenshot, panels and values correct, grid
  spans fixed.
- Board: window opens, renders the amber panels, 30.9 MB RSS; layout confirmed by
  screen capture.
- WebView2 app: window opens, API served from inside it, 94 + 457 MB.

## Not verified

No engine has been started by the interface: that is a model run, and model runs
are explicit work. The last two board tweaks (models/recent panels, dark title bar)
were not re-captured; they render from the same data path and raise no error.
