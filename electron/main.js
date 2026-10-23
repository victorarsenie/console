// Electron shell for the console: starts the Python server, waits for it, then
// shows the UI in a chrome-less window. The UI itself is unchanged.
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let server = null;
let port = 8123;

function probe(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: p, path: "/", timeout: 700 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    for (let p = 8123; p < 8131; p++) {
      if (await probe(p)) { port = p; return true; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

app.whenReady().then(async () => {
  server = spawn("python.exe", [path.join(ROOT, "window.py")], {
    cwd: ROOT,
    windowsHide: true,
    stdio: "ignore",
  });
  const ok = await waitForServer();
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadURL(ok ? `http://127.0.0.1:${port}/` : "data:text/html,<body style='background:%2308080a;color:%23ffb000;font-family:monospace'>server did not start - check window.py</body>");
  mainWindow = win;
  win.on("closed", () => { if (server) { server.kill(); server = null; } });
});

let mainWindow = null;
ipcMain.on("win:minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("win:fullscreen", () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); });
ipcMain.on("win:close", () => { if (mainWindow) mainWindow.close(); });

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
