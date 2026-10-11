const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  exportPdf: (html) => ipcRenderer.invoke("export-pdf", html),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
});
