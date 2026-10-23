// Electron shell for the console: starts the Python server, waits for it, then
// shows the UI in a chrome-less window. The UI itself is unchanged.
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const LOG = path.join(__dirname, "electron-error.log");
function log(line) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch (e) {}
}
process.on("uncaughtException", (err) => { log("uncaught: " + (err && err.stack || err)); });
process.on("unhandledRejection", (err) => { log("rejection: " + err); });
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let server = null;
let mainWindow = null;
let port = 8123;

function probe(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: p, path: "/", timeout: 250 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    for (let p = 8123; p < 8126; p++) {
      if (await probe(p)) { port = p; return true; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startServer() {
  const out = fs.openSync(path.join(__dirname, "server.log"), "a");
  const proc = spawn("pythonw.exe", [path.join(ROOT, "window.py")], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["ignore", out, out],
  });
  proc.on("exit", (code) => log(`server exited ${code}`));
  log("server started pid " + proc.pid);
  return proc;
}

ipcMain.on("win:minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("win:fullscreen", () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); });
ipcMain.on("win:close", () => { if (mainWindow) mainWindow.close(); });

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const loading = "data:text/html," + encodeURIComponent(
    '<body style="background:#08080a;color:#ffb000;font-family:monospace;padding:40px">' +
    'MU/TH/UR 6000<br><br><span id="s">starting services...</span></body>');
  mainWindow.loadURL(loading);
  mainWindow.setFullScreen(true);
  mainWindow.webContents.on("render-process-gone", (_e, d) => log("render gone: " + JSON.stringify(d)));
  mainWindow.on("closed", () => { mainWindow = null; if (server) { server.kill(); server = null; } });

  server = startServer();
  let ok = await waitForServer(24);
  if (!ok) {
    log("first attempt failed; retrying");
    try { server.kill(); } catch (e) {}
    server = startServer();
    ok = await waitForServer(40);
  }
  log("server ready: " + ok + " port " + port);
  if (ok) mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  else mainWindow.loadURL("data:text/html," + encodeURIComponent(
    '<body style="background:#08080a;color:#ff6b5e;font-family:monospace;padding:40px">' +
    'server did not start - see electron/server.log</body>'));
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
