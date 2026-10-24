# Muther research log

One log for Muther: the assistant and its interface (`E:\AI\console`). Findings kept
because most of them cost a session each.
session each. Anything that worked first time is not here.

## Shellï¼ˆhow the UI is hostedï¼‰

| attempt | result |
|---|---|
| **browser tab** (`window.py --open`) | stable, browser chrome, ~450 MB. The fallback that never failed. |
| **pywebview 6.2.1 / WebView2** | crashed natively, four times, with **no traceback** â€” `fullscreen=True` at `create_window` kills the process below Python, so the error handler never runs. Setting fullscreen 0.6 s *after* creation survived three launches in a row. Still abandoned as unstable. |
| **Chrome `--app`** | chrome-less window, but a malformed flag leaves a headless server and no window ("python not responding"). |
| **Electron 45** | working: 294 MB, starts the Python server itself, IPC bridge for the window buttons, fullscreen at creation is fine here. |

**Rule learned:** a window-state change at native-construction time is the fragile
part, not the renderer. And `npm install electron` can leave the package without
its binary; `node node_modules/electron/install.js` fixes it.

## Process and port hazards

- The server must bind the **first free port** (8123 â†’ 8130); a stale instance holding
  8123 made the first launch die silently.
- A `.bat` that runs `pythonw app.py` **synchronously** keeps its console open for
  the app's whole life â€” that was the mysterious second window. Use `start`.
- Children of a windowless process get **their own console** unless
  `CREATE_NO_WINDOW` is set: this is why the collector flashed cmd windows every
  1.5 s. Applies to `tasklist`, `nvidia-smi`, `taskkill`.
- Shared WebView2 profiles lock the second instance out; give each launch its own
  storage directory.
- `node_modules` must never be committed: GitHub rejects the push with
  `pre-receive hook declined` when a blob is over 100 MB.

## UI defects worth remembering

- A palette panel with `display: grid` **overrides** `[hidden]`; the overlay stays on
  screen and Escape "closes" nothing. Always add `.x[hidden] { display: none }`.
- Re-rendering the whole DOM every poll makes the panels blink. Update volatile
  numbers in place (`data-live`), rebuild only when structure changes.
- CSS selectors that assume a wrapper (`.domains .d`) silently stop applying when the
  parent changes; match the row class directly.
- `text_select=False` on the window disables all selection â€” and with it copy.
- A click handler that rebuilds the DOM clears the user's text selection; bail out
  while `window.getSelection()` is non-empty.
- Non-ASCII separators in these files are unsafe: PowerShell round trips mangle them
  into double-encoded garbage. Keep the UI files ASCII.

## Data and API notes

- Six models, each mapped to the launcher whose context and weights agree; the Hermes
  labels are not launcher names, so the mapping was done by reading `-c` and the
  `.gguf` name out of each `.bat`.
- `activity` shows commits and note writes; the injection log was noise.
- `/api/open` is prefix-allowlisted to the memory, console, muther and research roots.
  That is enough locally; a tunnel would need resolved-parent checks.
- Workflows stay parameterless and non-destructive; anything risky stays a human
  decision in the palette.

## Open

- pywebview stability (would save ~150 MB versus Electron) â€” not worth another session.
- Sub-tabs inside bays: the refactor broke the page once (BAYS referenced deleted
  render functions). Add the new functions beside the old ones, switch references in
  the same edit, and assert the page still renders before committing.

## OpenCode session API (2026-10-24)

- The service authenticates; every direct `/api*` request returns **401**. Guessing
  header styles (Bearer, Basic ":"+password, x-opencode-password, x-api-key) all fail.
  `service.json` holds only a `password` field, and it is not the API credential.
- **The supported path works:** `opencode api GET /api/session` returns the session
  list as JSON - id, title, model, tokens, cost, outcome, `location.directory`. The CLI
  authenticates itself, so the console never handles the secret.
- `/api/sessions` is 404; the plural is wrong. `/api/session` is the collection.
- Anything that is not an API path returns the SPA HTML with 200, so a `200` alone
  proves nothing; check the content type.
- GUI rule that keeps biting: a bay renderer wired with `bay.render` throws when the
  BAYS entry has no `render` key, and the whole page goes blank (42 KB screenshot).

## Two Windows traps worth keeping (2026-10-24)

- `spawn("python.exe")` kept a console alive and could stall; `pythonw.exe` removes it.
  The shell now starts the server with pythonw and retries once before showing an error.
- Subprocesses cannot execute the npm shim: `opencode` resolves to `opencode.cmd`, and
  `CreateProcess` will not run a `.cmd`. The sessions API was empty until the console
  called `...\@opencode\cli\bin\opencode.exe` by absolute path. Same class of bug as
  `Set-Content` writing a BOM: the tool works in a shell, not from a process.
- A previously started server keeps the old code in memory. After changing `window.py`
  the tab showed "no sessions" until the app was restarted; the fix looked broken while
  the fix was only not loaded.

## Portfolio value

The console is both a project and a line of research: a working desktop application
with an HTTP API, a file-backed board, a knowledge-layer integration and a written
log of every failure that shaped it. For a portfolio its value is not the feature
list but the traceable decisions - Electron over pywebview (four native crashes),
one asset-free shell over a browser tab, ASCII over glyphs (mojibake twice), and
guards over permissions (one engine on :8080 at a time).

## Terminal bay (2026-10-24)

The terminal bay owns the whole stage now: sessions on the left half (own scroll,
+ new), the CRT screen on the right, and a gutter that resizes the split and remembers
the width in localStorage. The separate sessions card is gone - it duplicated the pane.

The bug that made sending look dead was ordering, not transport. The API returns a
session's messages newest-first, and the view rendered that order while scrolling to
the bottom - so the newest turn sat off-screen at the top and the visible last line was
the oldest. `_messages` sorts by `time.created` before slicing now. Send itself had
been working since the route moved into do_POST.

What this bay needs to feel like the OpenCode terminal, in order:

- model selection per session (the readout is honest now, but read-only),
- approvals and queued prompts while a turn is running,
- streaming instead of 3 s polling (the CLI blocks per call, ~2-4 s).

Traps confirmed today:

- A prompt inside a <form> navigates the Electron window to the submit URL. That is
  the "console restarted" report. No form anywhere; button + keydown only.
- A click handler that begins with "if text is selected, return" swallows every button
  under it. The send branch must be the first check in the handler.
- A route added to do_GET answers "unknown endpoint" when the UI POSTs.
- User messages keep their text under payload.text, not in content[].
- render() rebuilding the stage on every poll wipes a live transcript; skip the shell
  render while the console is mounted and update only #chatlog.

### Two regressions after the split (same day)

- The terminal tab looked dead. Every spine card eagerly renders its bay content, so a
  hidden `#console` already existed inside the terminal card and the "already mounted"
  guard in `render()` skipped the render on click. The guard now tests `console-mode`
  on `#track`, not the presence of the id.
- The drone was removed on request. `start()` no longer calls `startHum`, and the hum
  builder is gone; key clicks, bay chirps, the alert and boot chatter remain.

Verified in a real browser: click on the terminal spine -> `track console-mode`, 0
cards, live transcript, gutter drag 220px -> 360px persisted, no console errors.
