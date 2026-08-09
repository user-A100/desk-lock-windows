"use strict";

const Core = window.TomatoCore;
let state = Core.createDefaultState();
let activeFocus = null;
let selectedDuration = 25;
let currentView = "today";
let previewTicker = null;
let catalogKind = "running";
let catalogItems = [];
let visibleCatalogItems = [];
const previewListeners = [];

const fallbackApi = {
  async loadState() {
    try { return Core.normalizeState(JSON.parse(localStorage.getItem("tomato-preview-state"))); }
    catch { return Core.createDefaultState(); }
  },
  async saveState(next) {
    const normalized = Core.normalizeState(next);
    localStorage.setItem("tomato-preview-state", JSON.stringify(normalized));
    return normalized;
  },
  async pickExecutable() { return null; },
  async listApps() { return []; },
  async startFocus(config) {
    const safe = Core.sanitizeFocusConfig(config);
    activeFocus = { id: Core.createId("preview"), ...safe, startedAt: Date.now(), endAt: Date.now() + safe.durationMinutes * 60000, remainingMs: safe.durationMinutes * 60000 };
    clearInterval(previewTicker);
    previewTicker = setInterval(() => {
      if (!activeFocus) return;
      activeFocus.remainingMs = Math.max(0, activeFocus.endAt - Date.now());
      previewListeners.forEach((listener) => listener({ ...activeFocus }));
      if (!activeFocus.remainingMs) fallbackApi.stopFocus({ phrase: Core.EMERGENCY_PHRASE });
    }, 1000);
    return activeFocus;
  },
  async getFocusStatus() { return activeFocus; },
  async beginEmergencyUnlock() { return { ready: true, waitSeconds: 0 }; },
  async stopFocus() {
    activeFocus = null;
    clearInterval(previewTicker);
    previewListeners.forEach((listener) => listener(null));
    return { completed: false };
  },
  async launchAllowedApp() { return { error: "浏览器预览不能打开桌面应用。" }; },
  async showDashboard() { return true; },
  async showLock() { return { shown: true }; },
  async setStartWithWindows(enabled) { return Boolean(enabled); },
  onFocusUpdate(listener) { previewListeners.push(listener); return () => {}; },
  onStateChanged() { return () => {}; }
};

const api = window.tomato || fallbackApi;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const viewMeta = {
  today: ["今天，先做一件事", "等待开始"],
  tasks: ["把任务写到足够小", "任务清单"],
  schedules: ["让专注按时发生", "定时锁定"],
  whitelist: ["只留下必要的窗口", "应用白名单"],
  stats: ["时间会留下证据", "专注记录"],
  settings: ["规则要清楚，恢复也要清楚", "本机设置"]
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function setView(name) {
  if (!viewMeta[name]) return;
  currentView = name;
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.dataset.view === name));
  $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.viewTarget === name));
  $("#view-title").textContent = viewMeta[name][0];
  if (!activeFocus) $("#top-status").textContent = viewMeta[name][1];
  $("#workspace").scrollTop = 0;
}

async function persist() {
  state = await api.saveState(state);
  renderAll();
}

function showToast(message, action) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.run();
      toast.remove();
    });
    toast.append(button);
  }
  $("#toast-stack").append(toast);
  const timeout = setTimeout(() => toast.remove(), action ? 8000 : 5000);
  toast.addEventListener("mouseenter", () => clearTimeout(timeout), { once: true });
}

function setButtonState(button, status, label) {
  button.dataset.state = status;
  button.disabled = status === "loading";
  const text = $("span", button);
  if (text && label) text.textContent = label;
}

function renderTasks() {
  const pending = state.tasks.filter((task) => !task.completed);
  const taskMarkup = (task, compact = false) => `
    <article class="task-row ${task.completed ? "is-complete" : ""}" data-task-id="${escapeHtml(task.id)}">
      <button class="task-check ${task.completed ? "is-checked" : ""}" data-action="toggle-task" aria-label="${task.completed ? "恢复任务" : "完成任务"}">
        ${icon("check")}
      </button>
      <div class="task-copy"><strong>${escapeHtml(task.title)}</strong><small>${Number(task.minutes) || 25} 分钟</small></div>
      <div class="task-actions">
        ${task.completed || compact ? "" : `<button class="icon-btn" data-action="focus-task" aria-label="专注这个任务">${icon("play")}</button>`}
        ${compact ? "" : `<button class="icon-btn" data-action="delete-task" aria-label="移除任务">${icon("trash")}</button>`}
      </div>
    </article>`;

  $("#today-task-list").innerHTML = pending.length
    ? pending.slice(0, 4).map((task) => taskMarkup(task, true)).join("")
    : `<div class="empty-state"><strong>还没有待开始的任务。</strong><span>写下一步，而不是写整个项目。</span><button class="btn btn-secondary" data-view-target="tasks">添加任务</button></div>`;
  $("#all-task-list").innerHTML = state.tasks.length
    ? state.tasks.map((task) => taskMarkup(task)).join("")
    : `<div class="empty-state"><strong>任务清单是空的。</strong><span>先添加一件今天确实要做的事。</span></div>`;
}

function renderWhitelist() {
  $("#allow-count").textContent = String(state.whitelist.length);
  $("#whitelist-list").innerHTML = state.whitelist.length
    ? state.whitelist.map((item) => `
      <article class="whitelist-row" data-app-id="${escapeHtml(item.id)}">
        <div class="whitelist-copy"><strong>${escapeHtml(item.name)}</strong><p class="whitelist-path">${escapeHtml(item.path)}</p></div>
        <button class="icon-btn" data-action="remove-app" aria-label="从白名单移除">${icon("trash")}</button>
      </article>`).join("")
    : `<div class="empty-state"><strong>白名单还是空的。</strong><span>锁定后将只显示 Desk Lock；按需加入编辑器、文档或播放器。</span></div>`;
}

function pathKey(value) {
  return String(value || "").replaceAll("/", "\\").toLowerCase();
}

async function addAllowedApp(item) {
  if (!item?.path) return false;
  if (state.whitelist.some((allowed) => pathKey(allowed.path) === pathKey(item.path))) {
    showToast("这个应用已经在白名单中。");
    return false;
  }
  state.whitelist.push({ id: Core.createId("app"), name: item.name || item.path.split(/[\\/]/).pop(), path: item.path });
  await persist();
  renderAppCatalog();
  showToast(`已允许 ${item.name || "这个应用"}。`);
  return true;
}

function renderAppCatalog() {
  const query = $("#app-search").value.trim().toLowerCase();
  visibleCatalogItems = catalogItems.filter((item) => !query || `${item.name} ${item.path}`.toLowerCase().includes(query));
  $("#catalog-summary").textContent = query
    ? `找到 ${visibleCatalogItems.length} 个匹配项`
    : `${catalogKind === "running" ? "当前可见" : "已安装"}应用 ${catalogItems.length} 个`;
  $("#app-catalog").innerHTML = visibleCatalogItems.length
    ? visibleCatalogItems.map((item, index) => {
      const added = state.whitelist.some((allowed) => pathKey(allowed.path) === pathKey(item.path));
      return `<article class="catalog-row">
        <div class="app-monogram" aria-hidden="true">${escapeHtml((item.name || "应").trim().slice(0, 1).toUpperCase())}</div>
        <div class="catalog-copy"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.path)}</p>${item.running ? `<small>正在运行${item.pid ? ` · PID ${Number(item.pid)}` : ""}</small>` : ""}</div>
        <button class="btn ${added ? "btn-added" : "btn-secondary"}" data-action="add-catalog-app" data-catalog-index="${index}" ${added ? "disabled" : ""}>${added ? "已添加" : "允许"}</button>
      </article>`;
    }).join("")
    : `<div class="catalog-empty"><strong>${query ? "没有匹配的应用" : "没有读取到可选应用"}</strong><span>${catalogKind === "running" ? "请先打开需要使用的应用，然后点刷新。" : "也可以从文件中手动选择程序。"}</span></div>`;
}

async function loadAppCatalog(kind = catalogKind) {
  catalogKind = kind === "installed" ? "installed" : "running";
  $$(".picker-tab").forEach((tab) => {
    const active = tab.dataset.appKind === catalogKind;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $("#app-catalog").innerHTML = `<div class="catalog-loading"><span></span><strong>正在读取${catalogKind === "running" ? "运行中" : "已安装"}的应用…</strong></div>`;
  $("#catalog-summary").textContent = "只读取应用信息，不操作进程";
  const items = await api.listApps(catalogKind);
  catalogItems = (Array.isArray(items) ? items : []).filter((item) => item?.path && item?.name && !/Desk\s*Lock/i.test(item.name));
  renderAppCatalog();
}

function openAppPicker(kind = "running") {
  const dialog = $("#app-picker");
  if (!dialog.open) dialog.showModal();
  $("#app-search").value = "";
  loadAppCatalog(kind);
}

function renderSchedules() {
  const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  $("#schedule-list").innerHTML = state.schedules.length
    ? state.schedules.map((schedule) => `
      <article class="schedule-row" data-schedule-id="${escapeHtml(schedule.id)}">
        <div>
          <div class="schedule-time">${escapeHtml(schedule.time)}</div>
          <strong>${escapeHtml(schedule.title)}</strong>
          <p class="schedule-meta">${schedule.days.map((day) => dayNames[day]).join(" · ")} · ${schedule.durationMinutes} 分钟 · ${schedule.mode === "strict" ? "严格模式" : "学霸模式"}</p>
        </div>
        <div class="task-actions">
          <input class="switch" type="checkbox" data-action="toggle-schedule" ${schedule.enabled ? "checked" : ""} aria-label="启用计划" />
          <button class="icon-btn" data-action="delete-schedule" aria-label="移除计划">${icon("trash")}</button>
        </div>
      </article>`).join("")
    : `<div class="empty-state"><strong>还没有自动锁定计划。</strong><span>添加计划后，到点默认进入学霸模式。</span></div>`;
}

function getSessionMinutes(session) {
  return Math.max(0, Math.round((Number(session.elapsedMs) || 0) / 60000));
}

function renderStats() {
  const now = new Date();
  const todayKey = Core.localDateKey(now);
  const lastSeven = [...Array(7)].map((_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return { date, key: Core.localDateKey(date), minutes: 0 };
  });
  for (const session of state.sessions) {
    const day = lastSeven.find((item) => item.key === Core.localDateKey(new Date(session.startedAt)));
    if (day) day.minutes += getSessionMinutes(session);
  }
  const todayMinutes = lastSeven.find((item) => item.key === todayKey)?.minutes || 0;
  const completedToday = state.sessions.filter((session) => session.completed && Core.localDateKey(new Date(session.startedAt)) === todayKey).length;
  const maxMinutes = Math.max(1, ...lastSeven.map((day) => day.minutes));
  const weekMinutes = lastSeven.reduce((sum, day) => sum + day.minutes, 0);
  const completed = state.sessions.filter((session) => session.completed).length;

  $("#today-minutes").textContent = `${todayMinutes} 分钟`;
  $("#today-sessions").textContent = String(completedToday);
  $("#stat-today").textContent = String(todayMinutes);
  $("#stat-week").textContent = String(weekMinutes);
  $("#stat-completed").textContent = String(completed);
  $("#week-chart").innerHTML = lastSeven.map((day) => {
    const ratio = Math.max(0.03, day.minutes / maxMinutes);
    return `<div class="chart-day"><div class="chart-bar" title="${day.minutes} 分钟"><span style="--ratio:${ratio}"></span></div><small>${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(day.date)}</small></div>`;
  }).join("");
  $("#session-history").innerHTML = state.sessions.length
    ? [...state.sessions].reverse().slice(0, 20).map((session) => `
      <article class="history-row">
        <div><strong>${escapeHtml(session.title)}</strong><p class="schedule-meta">${session.mode === "strict" ? "严格模式" : "学霸模式"} · ${getSessionMinutes(session)} 分钟</p></div>
        <time>${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(session.startedAt))}</time>
      </article>`).join("")
    : `<div class="empty-state"><strong>还没有专注记录。</strong><span>完成第一轮后，这里会出现真实用时。</span></div>`;
}

function renderSettings() {
  $("#startup-toggle").checked = state.settings.startWithWindows;
  $("#default-duration").value = state.settings.defaultDuration;
  $("#default-mode").value = state.settings.defaultMode;
  $$('input[name="clock-style"]').forEach((input) => { input.checked = input.value === state.settings.clockStyle; });
  $("#clock-color").value = state.settings.clockColor;
  $("#clock-color-value").textContent = state.settings.clockColor.toUpperCase();
  $$('[data-clock-color]').forEach((button) => button.classList.toggle("is-selected", button.dataset.clockColor.toLowerCase() === state.settings.clockColor));
}

function renderAll() {
  renderTasks();
  renderWhitelist();
  renderSchedules();
  renderStats();
  renderSettings();
  $("#footer-status").textContent = state.sessions.length ? `已保存 ${state.sessions.length} 条专注记录` : "数据保存在本机";
}

function renderFocusStatus(session) {
  activeFocus = session;
  const running = Boolean(session);
  $(".topbar-status").classList.toggle("is-running", running);
  $("#start-focus").disabled = running;
  $("#focus-guard").hidden = !running;
  if (!running) {
    $("#top-status").textContent = viewMeta[currentView][1];
    $("#timer-preview").textContent = Core.formatClock(selectedDuration * 60);
    setButtonState($("#start-focus"), "default", "开始专注");
    return;
  }
  const seconds = Math.ceil(session.remainingMs / 1000);
  $("#top-status").textContent = `${session.mode === "strict" ? "严格" : "学霸"}模式 · ${Core.formatClock(seconds)}`;
  $("#timer-preview").textContent = Core.formatClock(seconds);
  $("#guard-detail").textContent = `${session.mode === "strict" ? "严格" : "学霸"}模式 · 剩余 ${Core.formatClock(seconds)} · 离开面板会继续拦截`;
  setButtonState($("#start-focus"), "loading", "专注进行中");
}

function updateDuration(minutes) {
  selectedDuration = Math.max(1, Math.min(480, Number(minutes) || 25));
  $("#custom-duration").value = String(selectedDuration);
  $("#timer-preview").textContent = Core.formatClock(selectedDuration * 60);
  $$(".duration-chip").forEach((chip) => chip.classList.toggle("is-selected", Number(chip.dataset.minutes) === selectedDuration));
}

function removeWithUndo(collectionName, id, message) {
  const collection = state[collectionName];
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = collection.splice(index, 1);
  persist();
  showToast(message, { label: "撤销", run: () => { state[collectionName].splice(index, 0, removed); persist(); } });
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const viewTrigger = event.target.closest("[data-view-target]");
    if (viewTrigger) setView(viewTrigger.dataset.viewTarget);

    const duration = event.target.closest(".duration-chip");
    if (duration) updateDuration(duration.dataset.minutes);

    const taskRow = event.target.closest("[data-task-id]");
    const taskAction = event.target.closest("[data-action]");
    if (taskRow && taskAction) {
      const task = state.tasks.find((item) => item.id === taskRow.dataset.taskId);
      if (!task) return;
      if (taskAction.dataset.action === "toggle-task") { task.completed = !task.completed; task.completedAt = task.completed ? Date.now() : null; await persist(); }
      if (taskAction.dataset.action === "delete-task") removeWithUndo("tasks", task.id, "已移除任务。");
      if (taskAction.dataset.action === "focus-task") { $("#focus-title").value = task.title; updateDuration(task.minutes); setView("today"); }
    }

    const appRow = event.target.closest("[data-app-id]");
    if (appRow && taskAction?.dataset.action === "remove-app") removeWithUndo("whitelist", appRow.dataset.appId, "已从白名单移除；应用仍会继续运行。");

    const catalogButton = event.target.closest('[data-action="add-catalog-app"]');
    if (catalogButton) {
      const item = visibleCatalogItems[Number(catalogButton.dataset.catalogIndex)];
      if (item) await addAllowedApp(item);
    }

    const scheduleRow = event.target.closest("[data-schedule-id]");
    if (scheduleRow && taskAction?.dataset.action === "delete-schedule") removeWithUndo("schedules", scheduleRow.dataset.scheduleId, "已移除定时计划。");
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches('[data-action="toggle-schedule"]')) {
      const row = event.target.closest("[data-schedule-id]");
      const schedule = state.schedules.find((item) => item.id === row.dataset.scheduleId);
      if (schedule) { schedule.enabled = event.target.checked; await persist(); }
    }
  });

  $("#custom-duration").addEventListener("change", (event) => updateDuration(event.target.value));

  $("#task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#task-input").value.trim();
    if (!title) return;
    state.tasks.unshift({ id: Core.createId("task"), title, minutes: Math.max(1, Math.min(480, Number($("#task-minutes").value) || 25)), completed: false, createdAt: Date.now() });
    event.currentTarget.reset();
    $("#task-minutes").value = "25";
    await persist();
    $("#task-input").focus();
  });

  $("#schedule-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const days = $$('#weekday-options input:checked').map((input) => Number(input.value));
    if (!days.length) { showToast("请至少选择一个重复日期。"); return; }
    state.schedules.push({
      id: Core.createId("schedule"),
      title: $("#schedule-title").value.trim() || "定时专注",
      time: $("#schedule-time").value,
      durationMinutes: Math.max(1, Math.min(480, Number($("#schedule-duration").value) || 60)),
      mode: $("#schedule-mode").value === "strict" ? "strict" : "scholar",
      days,
      enabled: true,
      lastTriggeredKey: null
    });
    await persist();
  });

  $("#add-whitelist").addEventListener("click", () => openAppPicker("running"));
  $("#view-running-apps").addEventListener("click", () => openAppPicker("running"));
  $("#close-app-picker").addEventListener("click", () => $("#app-picker").close());
  $("#refresh-apps").addEventListener("click", () => loadAppCatalog());
  $("#app-search").addEventListener("input", renderAppCatalog);
  $$(".picker-tab").forEach((tab) => tab.addEventListener("click", () => loadAppCatalog(tab.dataset.appKind)));
  $("#manual-pick").addEventListener("click", async () => {
    const item = await api.pickExecutable();
    if (!item) {
      if (!window.tomato) showToast("应用选择只在桌面版中可用。");
      return;
    }
    await addAllowedApp(item);
  });
  $("#return-to-lock").addEventListener("click", async () => {
    const result = await api.showLock();
    if (result?.error) showToast(result.error);
  });

  $("#start-focus").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonState(button, "loading", "正在锁定");
    const mode = $('input[name="mode"]:checked').value;
    const result = await api.startFocus({ title: $("#focus-title").value, durationMinutes: selectedDuration, mode, whitelist: state.whitelist });
    if (result?.error) {
      setButtonState(button, "error", "未能开始");
      showToast(result.error);
      setTimeout(() => setButtonState(button, "default", "开始专注"), 1600);
      return;
    }
    renderFocusStatus(result);
  });

  $("#startup-toggle").addEventListener("change", async (event) => {
    const enabled = await api.setStartWithWindows(event.target.checked);
    state.settings.startWithWindows = enabled;
    await persist();
  });
  $("#default-duration").addEventListener("change", async (event) => { state.settings.defaultDuration = Math.max(1, Math.min(480, Number(event.target.value) || 25)); await persist(); });
  $("#default-mode").addEventListener("change", async (event) => { state.settings.defaultMode = event.target.value === "strict" ? "strict" : "scholar"; await persist(); });
  $$('input[name="clock-style"]').forEach((input) => input.addEventListener("change", async (event) => {
    if (!event.target.checked) return;
    state.settings.clockStyle = event.target.value === "flip" ? "flip" : "ring";
    await persist();
  }));
  $("#clock-color").addEventListener("input", (event) => { $("#clock-color-value").textContent = event.target.value.toUpperCase(); });
  $("#clock-color").addEventListener("change", async (event) => { state.settings.clockColor = event.target.value; await persist(); });
  $$('[data-clock-color]').forEach((button) => button.addEventListener("click", async () => {
    state.settings.clockColor = Core.normalizeClockColor(button.dataset.clockColor);
    await persist();
  }));
}

function buildWeekdayOptions() {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  $("#weekday-options").innerHTML = labels.map((label, day) => `
    <label class="weekday-option"><input type="checkbox" value="${day}" ${day > 0 && day < 6 ? "checked" : ""} /><span>周${label}</span></label>`).join("");
}

async function init() {
  buildWeekdayOptions();
  state = await api.loadState();
  selectedDuration = state.settings.defaultDuration;
  updateDuration(selectedDuration);
  $("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  bindEvents();
  renderAll();
  renderFocusStatus(await api.getFocusStatus());
  api.onFocusUpdate(renderFocusStatus);
  api.onStateChanged((nextState) => { state = Core.normalizeState(nextState); renderAll(); });
}

init();
