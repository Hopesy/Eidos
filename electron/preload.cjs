const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eidosUpdater", {
  getState() {
    return ipcRenderer.invoke("eidos-updater:get-state");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("eidos-updater:check");
  },
  downloadAndInstall() {
    return ipcRenderer.invoke("eidos-updater:download");
  },
  onStateChange(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, state) => {
      callback(state);
    };
    ipcRenderer.on("eidos-updater:state-changed", listener);
    return () => {
      ipcRenderer.removeListener("eidos-updater:state-changed", listener);
    };
  },
});
