# Console — research log

Findings from building the operations console, kept because most of them cost a
session each. Anything that worked first time is not here.

## Shell（how the UI is hosted）

| attempt | result |
|---|---|
| **browser tab** (`window.py --open`) | stable, browser chrome, ~450 MB. The fallback that never failed. |
| **pywebview 6.2.1 / WebView2** | crashed natively, four times, with **no traceback** — `fullscreen=True` at `create_window` kills the process below Python, so the error handler never runs. Setting fullscreen 0.6 s *after* creation survived three launches in a row. Still abandoned as unstable. |
| **Chrome `--app`** | chrome-less window, but a malformed flag leaves a headless server and no window ("python not responding"). |
| **Electron 45** | working: 294 MB, starts the Python server itself, IPC bridge for the window buttons, fullscreen at creation is fine here. |

**Rule learned:** a window-state change at native-construction time is the fragile
part, not the renderer. And `npm install electron` can leave the package without
its binary; `node node_modules/electron/install.js` fixes it.

## Process and port hazards

- The server must bind the **first free port** (8123 → 8130); a stale instance holding
  8123 made the first launch die silently.
- A `.bat` that runs `pythonw app.py` **synchronously** keeps its console open for
  the app's whole life — that was the mysterious second window. Use `start`.
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
- `text_select=False` on the window disables all selection — and with it copy.
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

- pywebview stability (would save ~150 MB versus Electron) — not worth another session.
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
