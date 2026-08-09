"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tomato", {
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  pickExecutable: () => ipcRenderer.invoke("dialog:pick-executable"),
  listApps: (kind) => ipcRenderer.invoke("apps:list", kind),
  startFocus: (config) => ipcRenderer.invoke("focus:start", config),
  getFocusStatus: () => ipcRenderer.invoke("focus:status"),
  stopFocus: (payload) => ipcRenderer.invoke("focus:stop", payload),
  beginEmergencyUnlock: () => ipcRenderer.invoke("focus:begin-emergency"),
  launchAllowedApp: (app) => ipcRenderer.invoke("focus:launch-allowed", app),
  setClockStyle: (style) => ipcRenderer.invoke("focus:set-clock-style", style),
  showDashboard: () => ipcRenderer.invoke("window:show-dashboard"),
  showLock: () => ipcRenderer.invoke("window:show-lock"),
  setStartWithWindows: (enabled) => ipcRenderer.invoke("app:set-login", enabled),
  onFocusUpdate: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("focus:update", listener);
    return () => ipcRenderer.removeListener("focus:update", listener);
  },
  onStateChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  }
});
