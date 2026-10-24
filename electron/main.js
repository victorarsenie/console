// Electron shell for the console. Written fresh: window first, then the server.
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOG = path.join(__dirname, "electron-error.log");
const PORTS = [8123, 8124, 8125];

let server = null;
let win = null;
let port = 0;

function log(message) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`); } catch (e) {}
}
process.on("uncaughtException", (err) => log("uncaught: " + (err && err.stack || err)));
process.on("unhandledRejection", (err) => log("rejection: " + err));

function probe(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: p, path: "/", timeout: 300 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function findServer(tries) {
  for (let i = 0; i < tries; i++) {
    for (const p of PORTS) {
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
  proc.on("exit", (code) => log("server exit " + code));
  log("server pid " + proc.pid);
  return proc;
}

ipcMain.on("win:minimize", () => { if (win) win.minimize(); });
ipcMain.on("win:fullscreen", () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.on("win:close", () => { if (win) win.close(); });

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#04100a",
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  const splash = "data:text/html," + encodeURIComponent(
    '<body style="background:#04100a;color:#35ff7a;font-family:monospace;padding:48px">' +
    'MU/TH/UR 6000<br><br>starting services...</body>');
  win.loadURL(splash);
  log("window created");

  server = startServer();
  let ok = await findServer(40);
  if (!ok) {
    log("retrying server");
    try { server.kill(); } catch (e) {}
    server = startServer();
    ok = await findServer(60);
  }
  log("ready=" + ok + " port=" + port);
  win.loadURL(ok
    ? `http://127.0.0.1:${port}/`
    : "data:text/html," + encodeURIComponent(
      '<body style="background:#04100a;color:#ff6b5e;font-family:monospace;padding:48px">' +
      'server did not start - see electron/server.log</body>'));
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
