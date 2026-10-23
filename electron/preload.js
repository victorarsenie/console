// Bridge for the window buttons: the page cannot touch the OS directly.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("consoleShell", {
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleFullscreen: () => ipcRenderer.send("win:fullscreen"),
  close: () => ipcRenderer.send("win:close"),
});
