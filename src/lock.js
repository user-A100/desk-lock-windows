"use strict";

const Core = window.TomatoCore;
const previewSession = {
  id: "preview-lock",
  title: "整理课程项目",
  mode: "scholar",
  startedAt: Date.now(),
  endAt: Date.now() + 19 * 60000,
  remainingMs: 19 * 60000,
  durationMinutes: 25,
  clockStyle: "flip",
  clockColor: "#ff6b4a",
  whitelist: [],
  blockedApp: "娱乐应用"
};
const api = window.tomato || {
  async getFocusStatus() { return previewSession; },
  onFocusUpdate() { return () => {}; },
  async launchAllowedApp() { return { error: "浏览器预览不能打开桌面应用。" }; },
  async setClockStyle(style) { previewSession.clockStyle = style === "flip" ? "flip" : "ring"; return previewSession; },
  async showDashboard() { return true; },
  async beginEmergencyUnlock() { return { ready: true, waitSeconds: 0 }; },
  async stopFocus() { return { completed: false }; }
};
const $ = (selector, root = document) => root.querySelector(selector);
let session = null;
let emergencyTicker = null;
let lastFlipValue = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function updateClock() {
  const now = new Date();
  $("#current-time").textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  $("#lock-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  if (session?.endAt) {
    const end = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(session.endAt));
    $("#end-time").textContent = `预计 ${end} 结束`;
  }
}

function renderFlipClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  const nextValue = `${minutes}:${seconds}`;
  const previousValue = lastFlipValue.padStart(nextValue.length, " ");
  const digitMarkup = (value, offset) => [...value].map((digit, index) => {
    const changed = previousValue[index + offset] !== digit;
    return `<span class="flip-card ${changed ? "is-flipping" : ""}"><span>${digit}</span></span>`;
  }).join("");
  $("#flip-clock").innerHTML = `
    <span class="flip-group">${digitMarkup(minutes, 0)}</span>
    <span class="flip-separator">:</span>
    <span class="flip-group">${digitMarkup(seconds, minutes.length + 1)}</span>`;
  $("#flip-clock").setAttribute("aria-label", `${Number(minutes)} 分 ${Number(seconds)} 秒`);
  lastFlipValue = nextValue;
}

function render(nextSession) {
  session = nextSession;
  if (!session) return;
  const remainingSeconds = Math.ceil(Math.max(0, session.remainingMs) / 1000);
  const totalMs = Math.max(1, session.durationMinutes * 60000);
  const progress = Math.max(0, Math.min(1, session.remainingMs / totalMs));
  const clockStyle = session.clockStyle === "flip" ? "flip" : "ring";
  document.body.dataset.clockStyle = clockStyle;
  $("#clock-style-toggle").textContent = `显示 · ${clockStyle === "flip" ? "翻页" : "圆环"}`;
  $("#clock-style-toggle").title = `切换为${clockStyle === "flip" ? "圆环" : "翻页"}时钟`;
  document.documentElement.style.setProperty("--clock-accent", Core.normalizeClockColor(session.clockColor));
  $("#lock-title").textContent = session.title;
  $("#lock-timer").textContent = Core.formatClock(remainingSeconds);
  renderFlipClock(remainingSeconds);
  $("#timer-ring").style.setProperty("--progress", String(progress));
  $("#mode-badge").textContent = session.mode === "strict" ? "严格模式" : "学霸模式";
  $("#stop-focus").textContent = session.mode === "strict" ? "应急解锁" : "结束本次专注";
  const blocked = session.blockedApp;
  $("#blocked-message").textContent = blocked ? `已拦截：${blocked}` : "其他应用暂时放在门外。";
  $("#blocked-message").classList.toggle("is-blocked", Boolean(blocked));
  $("#allowed-apps").innerHTML = session.whitelist.length
    ? session.whitelist.map((item) => `<button class="allowed-app" data-path="${escapeHtml(item.path)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</button>`).join("")
    : `<span class="allowed-empty">本次没有添加白名单应用</span>`;
  updateClock();
}

async function startEmergencyFlow() {
  const dialog = $("#emergency-dialog");
  dialog.showModal();
  $("#dialog-error").textContent = "";
  clearInterval(emergencyTicker);

  async function tick() {
    const result = await api.beginEmergencyUnlock();
    if (result.error) { $("#dialog-error").textContent = result.error; return; }
    const ready = result.waitSeconds <= 0;
    $("#cooldown-copy").textContent = ready ? "冷静期结束。如果确实需要恢复，请输入下方文字。" : `还有 ${result.waitSeconds} 秒。你可以关闭这里，专注计时仍会继续。`;
    $("#emergency-phrase").disabled = !ready;
    $("#confirm-emergency").disabled = !ready;
    $("#confirm-emergency").textContent = ready ? "确认结束" : `等待 ${result.waitSeconds} 秒`;
    if (ready) { clearInterval(emergencyTicker); $("#emergency-phrase").focus(); }
  }

  await tick();
  emergencyTicker = setInterval(tick, 1000);
}

document.addEventListener("click", async (event) => {
  const allowed = event.target.closest(".allowed-app");
  if (allowed) {
    allowed.disabled = true;
    allowed.classList.add("is-opening");
    const result = await api.launchAllowedApp({ path: allowed.dataset.path, name: allowed.dataset.name });
    if (result?.error) {
      $("#blocked-message").textContent = result.error;
      allowed.disabled = false;
      allowed.classList.remove("is-opening");
    }
  }
});

$("#clock-style-toggle").addEventListener("click", async () => {
  if (!session) return;
  const nextStyle = session.clockStyle === "flip" ? "ring" : "flip";
  const result = await api.setClockStyle(nextStyle);
  if (result?.error) { $("#blocked-message").textContent = result.error; return; }
  render(result);
});
$("#show-dashboard").addEventListener("click", () => api.showDashboard());
$("#stop-focus").addEventListener("click", async () => {
  if (!session) return;
  if (session.mode === "strict") { await startEmergencyFlow(); return; }
  const result = await api.stopFocus({});
  if (result?.error) $("#blocked-message").textContent = result.error;
});
$("#cancel-emergency").addEventListener("click", () => {
  clearInterval(emergencyTicker);
  $("#emergency-dialog").close();
});
$("#emergency-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await api.stopFocus({ phrase: $("#emergency-phrase").value });
  if (result?.error) { $("#dialog-error").textContent = result.error; return; }
  $("#emergency-dialog").close();
});

updateClock();
setInterval(updateClock, 1000);
api.getFocusStatus().then(render);
api.onFocusUpdate(render);
