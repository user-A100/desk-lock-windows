"use strict";

const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  EMERGENCY_PHRASE,
  createDefaultState,
  normalizeState,
  createId,
  sanitizeFocusConfig,
  isScheduleDue,
  scheduleTriggerKey
} = require("../src/core");

let mainWindow = null;
let overlays = [];
let foregroundMonitor = null;
let focusSession = null;
let focusTicker = null;
let scheduleTicker = null;
let allowQuit = false;
let lastForegroundInfo = null;
let allowedLaunchGraceUntil = 0;
const recentlyMinimized = new Map();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.exit(0);

app.on("second-instance", () => {
  if (focusSession) {
    showOverlays("专注仍在进行");
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const srcPath = (...parts) => path.join(__dirname, "..", "src", ...parts);

function executableScriptPath(fileName) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", fileName)
    : path.join(__dirname, fileName);
}

function stateFilePath() {
  return path.join(app.getPath("userData"), "focus-state.json");
}

function legacyStateFilePaths() {
  return [
    path.join(app.getPath("appData"), "tomato-todo-windows", "focus-state.json"),
    path.join(app.getPath("appData"), "番茄 Todo", "focus-state.json")
  ];
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(stateFilePath(), "utf8")));
  } catch {
    for (const legacyPath of legacyStateFilePaths()) {
      try {
        const migrated = normalizeState(JSON.parse(fs.readFileSync(legacyPath, "utf8")));
        saveState(migrated);
        return migrated;
      } catch {
        // Try the next known legacy data directory.
      }
    }
    return createDefaultState();
  }
}

function saveState(nextState) {
  const state = normalizeState(nextState);
  const target = stateFilePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporary, target);
  return state;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    title: "Desk Lock",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(srcPath("index.html"));
  mainWindow.on("blur", () => {
    if (!focusSession) return;
    // The foreground watchdog normally handles this transition. This delayed
    // check closes the gap if Windows drops a foreground-change notification.
    setTimeout(() => {
      if (!focusSession || mainWindow?.isFocused()) return;
      if (!isAllowedForeground(lastForegroundInfo)) {
        showOverlays(lastForegroundInfo?.title || lastForegroundInfo?.name || "未允许的应用");
      }
    }, 700);
  });
  mainWindow.on("close", (event) => {
    if (focusSession && !allowQuit) {
      event.preventDefault();
      mainWindow.hide();
      showOverlays("专注仍在进行");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function publicSession(extra = {}) {
  if (!focusSession) return null;
  const remainingMs = Math.max(0, focusSession.endAt - Date.now());
  return {
    id: focusSession.id,
    title: focusSession.title,
    mode: focusSession.mode,
    startedAt: focusSession.startedAt,
    endAt: focusSession.endAt,
    remainingMs,
    durationMinutes: focusSession.durationMinutes,
    whitelist: focusSession.whitelist,
    clockStyle: focusSession.clockStyle,
    clockColor: focusSession.clockColor,
    cooldownStartedAt: focusSession.cooldownStartedAt || null,
    blockedApp: focusSession.blockedApp || null,
    ...extra
  };
}

function broadcastFocus(extra = {}) {
  const payload = publicSession(extra);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("focus:update", payload);
  for (const overlay of overlays) {
    if (!overlay.isDestroyed()) overlay.webContents.send("focus:update", payload);
  }
}

function hideOverlays() {
  for (const overlay of overlays) {
    if (!overlay.isDestroyed()) overlay.hide();
  }
}

function showOverlays(blockedApp = "") {
  if (!focusSession) return;
  focusSession.blockedApp = blockedApp || focusSession.blockedApp || null;
  for (const [index, overlay] of overlays.entries()) {
    if (overlay.isDestroyed()) continue;
    overlay.show();
    overlay.setAlwaysOnTop(false);
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.moveTop();
    if (index === 0) {
      overlay.focus();
      overlay.moveTop();
    }
  }
  broadcastFocus();
}

function destroyOverlays() {
  for (const overlay of overlays) {
    if (!overlay.isDestroyed()) overlay.destroy();
  }
  overlays = [];
}

function createOverlays() {
  destroyOverlays();
  overlays = screen.getAllDisplays().map((display, index) => {
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: true,
      kiosk: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      title: `Desk Lock · 专注锁定${index ? ` ${index + 1}` : ""}`,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.loadFile(srcPath("lock.html"));
    overlay.webContents.on("did-finish-load", () => overlay.webContents.send("focus:update", publicSession()));
    overlay.on("close", (event) => {
      if (focusSession && !allowQuit) event.preventDefault();
    });
    return overlay;
  });
  showOverlays();
}

function normalizePath(value) {
  return String(value || "").replaceAll("/", "\\").toLowerCase();
}

function isAllowedForeground(info) {
  if (!focusSession || !info) return true;
  const title = String(info.title || "");
  if (title.startsWith("Desk Lock · 专注锁定")) return false;
  if (title === "Desk Lock") return true;
  const candidatePath = normalizePath(info.path);
  const candidateName = String(info.name || "").toLowerCase();
  return focusSession.whitelist.some((item) => {
    const allowedPath = normalizePath(item.path);
    return (candidatePath && candidatePath === allowedPath) || candidateName === path.basename(allowedPath).toLowerCase();
  });
}

function minimizeBlockedWindow(info) {
  const handle = Number(info?.handle);
  const candidatePath = normalizePath(info?.path);
  if (!Number.isSafeInteger(handle) || handle <= 0 || !candidatePath) return;
  const windowsDirectory = normalizePath(process.env.WINDIR || "C:\\Windows");
  if (candidatePath === windowsDirectory || candidatePath.startsWith(`${windowsDirectory}\\`)) return;
  const lastAttempt = recentlyMinimized.get(handle) || 0;
  if (Date.now() - lastAttempt < 2500) return;
  recentlyMinimized.set(handle, Date.now());
  if (recentlyMinimized.size > 100) {
    const cutoff = Date.now() - 60000;
    for (const [key, timestamp] of recentlyMinimized) if (timestamp < cutoff) recentlyMinimized.delete(key);
  }
  const script = executableScriptPath("minimize-window.ps1");
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Handle", String(handle)],
    { windowsHide: true, stdio: "ignore" }
  );
  child.unref();
}

function handleForeground(info) {
  if (!focusSession) return;
  lastForegroundInfo = info;
  if (String(info.title || "").startsWith("Desk Lock · 专注锁定")) return;
  if (Date.now() < allowedLaunchGraceUntil) {
    if (isAllowedForeground(info)) {
      allowedLaunchGraceUntil = 0;
      focusSession.blockedApp = null;
      hideOverlays();
      broadcastFocus();
    } else {
      hideOverlays();
    }
    return;
  }
  if (isAllowedForeground(info)) {
    focusSession.blockedApp = null;
    hideOverlays();
    broadcastFocus();
  } else {
    const label = info.title || info.name || "未允许的应用";
    minimizeBlockedWindow(info);
    showOverlays(label);
  }
}

function startForegroundMonitor() {
  if (foregroundMonitor) return;
  const script = executableScriptPath("foreground-monitor.ps1");
  foregroundMonitor = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
  );
  let buffer = "";
  foregroundMonitor.stdout.setEncoding("utf8");
  foregroundMonitor.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleForeground(JSON.parse(line));
      } catch {
        // Ignore a malformed monitor sample; the next foreground event will recover.
      }
    }
  });
  foregroundMonitor.on("exit", () => {
    foregroundMonitor = null;
    if (!allowQuit) setTimeout(startForegroundMonitor, 1500);
  });
}

function readAppCatalog(kind) {
  return new Promise((resolve) => {
    const script = executableScriptPath("app-catalog.ps1");
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Kind", kind],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      try {
        const items = JSON.parse(output || "[]");
        resolve((Array.isArray(items) ? items : [items]).filter((item) => item?.path && item?.name));
      } catch {
        resolve([]);
      }
    });
  });
}

function activateOrLaunchApp(targetPath) {
  return new Promise((resolve) => {
    const script = executableScriptPath("open-allowed-app.ps1");
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-TargetPath", targetPath],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => resolve({ error: error.message }));
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(output || "{}"));
      } catch {
        resolve(code === 0 ? { opened: true } : { error: "应用未能打开。" });
      }
    });
  });
}

function startFocus(config, source = "manual") {
  if (focusSession) return publicSession({ error: "已有专注正在进行。" });
  const safe = sanitizeFocusConfig(config);
  const displaySettings = loadState().settings;
  focusSession = {
    id: createId("focus"),
    ...safe,
    source,
    startedAt: Date.now(),
    endAt: Date.now() + safe.durationMinutes * 60000,
    clockStyle: displaySettings.clockStyle,
    clockColor: displaySettings.clockColor,
    cooldownStartedAt: null,
    blockedApp: null
  };
  createOverlays();
  clearInterval(focusTicker);
  focusTicker = setInterval(() => {
    if (!focusSession) return;
    if (Date.now() >= focusSession.endAt) finishFocus(true, "completed");
    else broadcastFocus();
  }, 1000);
  broadcastFocus();
  return publicSession();
}

function finishFocus(completed, reason) {
  if (!focusSession) return null;
  const finished = focusSession;
  clearInterval(focusTicker);
  focusTicker = null;
  focusSession = null;
  const state = loadState();
  state.sessions.push({
    id: finished.id,
    title: finished.title,
    mode: finished.mode,
    source: finished.source,
    startedAt: finished.startedAt,
    endedAt: Date.now(),
    elapsedMs: Math.max(0, Math.min(Date.now(), finished.endAt) - finished.startedAt),
    plannedMinutes: finished.durationMinutes,
    completed: Boolean(completed),
    reason
  });
  const saved = saveState(state);
  destroyOverlays();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("focus:update", null);
    mainWindow.webContents.send("state:changed", saved);
  }
  return { completed: Boolean(completed) };
}

function checkSchedules() {
  if (focusSession) return;
  const state = loadState();
  const now = new Date();
  const due = state.schedules.find((schedule) => {
    if (!isScheduleDue(schedule, now)) return false;
    return schedule.lastTriggeredKey !== scheduleTriggerKey(schedule, now);
  });
  if (!due) return;
  due.lastTriggeredKey = scheduleTriggerKey(due, now);
  saveState(state);
  startFocus(
    {
      title: due.title || "定时专注",
      durationMinutes: due.durationMinutes,
      mode: due.mode === "strict" ? "strict" : "scholar",
      whitelist: state.whitelist
    },
    "schedule"
  );
}

function registerIpc() {
  ipcMain.handle("state:load", () => loadState());
  ipcMain.handle("state:save", (_event, state) => {
    const saved = saveState(state);
    if (focusSession) {
      focusSession.whitelist = saved.whitelist;
      broadcastFocus();
    }
    return saved;
  });
  ipcMain.handle("dialog:pick-executable", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择允许使用的应用",
      properties: ["openFile"],
      filters: [{ name: "Windows 应用", extensions: ["exe"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selectedPath = result.filePaths[0];
    return { id: createId("app"), name: path.basename(selectedPath, path.extname(selectedPath)), path: selectedPath };
  });
  ipcMain.handle("apps:list", (_event, kind) => readAppCatalog(kind === "installed" ? "installed" : "running"));
  ipcMain.handle("focus:start", (_event, config) => startFocus(config));
  ipcMain.handle("focus:status", () => publicSession());
  ipcMain.handle("focus:begin-emergency", () => {
    if (!focusSession) return { error: "当前没有专注。" };
    if (focusSession.mode !== "strict") return { ready: true, waitSeconds: 0 };
    if (!focusSession.cooldownStartedAt) focusSession.cooldownStartedAt = Date.now();
    const waitSeconds = Math.max(0, Math.ceil((60000 - (Date.now() - focusSession.cooldownStartedAt)) / 1000));
    broadcastFocus();
    return { ready: waitSeconds === 0, waitSeconds };
  });
  ipcMain.handle("focus:stop", (_event, payload = {}) => {
    if (!focusSession) return { error: "当前没有专注。" };
    if (focusSession.mode === "strict") {
      if (!focusSession.cooldownStartedAt) return { error: "请先启动应急解锁冷静期。" };
      const waitSeconds = Math.max(0, Math.ceil((60000 - (Date.now() - focusSession.cooldownStartedAt)) / 1000));
      if (waitSeconds > 0) return { error: `还需等待 ${waitSeconds} 秒。`, waitSeconds };
      if (String(payload.phrase || "").trim() !== EMERGENCY_PHRASE) {
        return { error: `请输入“${EMERGENCY_PHRASE}”。` };
      }
    }
    return finishFocus(false, "manual-stop");
  });
  ipcMain.handle("focus:launch-allowed", async (_event, allowedApp) => {
    if (!focusSession) return { error: "当前没有专注。" };
    const match = focusSession.whitelist.find((item) => normalizePath(item.path) === normalizePath(allowedApp?.path));
    if (!match) return { error: "这个应用不在本次白名单中。" };
    const sessionId = focusSession.id;
    allowedLaunchGraceUntil = Date.now() + 4500;
    hideOverlays();
    const result = await activateOrLaunchApp(match.path);
    if (result?.error) {
      allowedLaunchGraceUntil = 0;
      showOverlays("允许的应用未能打开");
      return { error: result.error };
    }
    setTimeout(() => {
      if (!focusSession || focusSession.id !== sessionId) return;
      allowedLaunchGraceUntil = 0;
      if (!isAllowedForeground(lastForegroundInfo)) {
        showOverlays(lastForegroundInfo?.title || lastForegroundInfo?.name || "未允许的应用");
      }
    }, 4700);
    return { opened: true, activated: Boolean(result?.activated) };
  });
  ipcMain.handle("focus:set-clock-style", (_event, value) => {
    if (!focusSession) return { error: "当前没有专注。" };
    const clockStyle = value === "flip" ? "flip" : "ring";
    focusSession.clockStyle = clockStyle;
    const state = loadState();
    state.settings.clockStyle = clockStyle;
    saveState(state);
    broadcastFocus();
    return publicSession();
  });
  ipcMain.handle("window:show-dashboard", () => {
    hideOverlays();
    mainWindow?.show();
    mainWindow?.focus();
    return true;
  });
  ipcMain.handle("window:show-lock", () => {
    if (!focusSession) return { error: "当前没有专注。" };
    mainWindow?.hide();
    showOverlays();
    return { shown: true };
  });
  ipcMain.handle("app:set-login", (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings().openAtLogin;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  startForegroundMonitor();
  scheduleTicker = setInterval(checkSchedules, 15000);
  checkSchedules();
  if (process.argv.includes("--smoke-test")) {
    setTimeout(() => {
      allowQuit = true;
      clearInterval(scheduleTicker);
      foregroundMonitor?.kill();
      app.quit();
    }, 3000);
  }
  screen.on("display-added", () => {
    if (focusSession) createOverlays();
  });
  screen.on("display-removed", () => {
    if (focusSession) createOverlays();
  });
});

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
  else mainWindow.show();
});

app.on("before-quit", (event) => {
  if (focusSession && !allowQuit) {
    event.preventDefault();
    showOverlays("专注仍在进行");
  }
});

app.on("window-all-closed", () => {
  if (!focusSession) {
    allowQuit = true;
    clearInterval(scheduleTicker);
    foregroundMonitor?.kill();
    app.quit();
  }
});
