const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("creatorDesktop", {
  version: "0.7.0",
  openBrowser: () => ipcRenderer.invoke("ci:open-browser"),
  setTheme: (theme) => ipcRenderer.invoke("ci:theme", theme),
  updates: {
    status: () => ipcRenderer.invoke("ci:update-status"),
    check: () => ipcRenderer.invoke("ci:update-action", "check"),
    download: () => ipcRenderer.invoke("ci:update-action", "download"),
    install: () => ipcRenderer.invoke("ci:update-action", "install"),
    subscribe: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("ci:update-state", listener);
      return () => ipcRenderer.removeListener("ci:update-state", listener);
    },
  },
  onStatus: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on("ci:status", listener);
    return () => ipcRenderer.removeListener("ci:status", listener);
  },
});
