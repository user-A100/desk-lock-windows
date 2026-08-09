"use strict";

const EMERGENCY_PHRASE = "结束本次专注";
const MAX_FOCUS_MINUTES = 480;
const DEFAULT_CLOCK_COLOR = "#ff6b4a";

function createDefaultState() {
  return {
    version: 1,
    tasks: [],
    whitelist: [],
    schedules: [],
    sessions: [],
    settings: {
      defaultDuration: 25,
      defaultMode: "scholar",
      startWithWindows: false,
      clockStyle: "ring",
      clockColor: DEFAULT_CLOCK_COLOR
    }
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeClockColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_CLOCK_COLOR;
}

function normalizeState(input) {
  const fallback = createDefaultState();
  const state = input && typeof input === "object" ? input : {};
  return {
    version: 1,
    tasks: Array.isArray(state.tasks) ? state.tasks.slice(0, 500) : [],
    whitelist: Array.isArray(state.whitelist) ? state.whitelist.slice(0, 100) : [],
    schedules: Array.isArray(state.schedules) ? state.schedules.slice(0, 50) : [],
    sessions: Array.isArray(state.sessions) ? state.sessions.slice(-1000) : [],
    settings: {
      defaultDuration: clampNumber(
        state.settings?.defaultDuration,
        1,
        MAX_FOCUS_MINUTES,
        fallback.settings.defaultDuration
      ),
      defaultMode: state.settings?.defaultMode === "strict" ? "strict" : "scholar",
      startWithWindows: Boolean(state.settings?.startWithWindows),
      clockStyle: state.settings?.clockStyle === "flip" ? "flip" : "ring",
      clockColor: normalizeClockColor(state.settings?.clockColor)
    }
  };
}

function createId(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFocusConfig(config = {}) {
  const title = String(config.title || "专注时间").trim().slice(0, 80) || "专注时间";
  const durationMinutes = clampNumber(config.durationMinutes, 1, MAX_FOCUS_MINUTES, 25);
  const mode = config.mode === "strict" ? "strict" : "scholar";
  const whitelist = Array.isArray(config.whitelist)
    ? config.whitelist
        .filter((item) => item && typeof item.path === "string")
        .slice(0, 100)
        .map((item) => ({
          id: String(item.id || createId("app")),
          name: String(item.name || "已允许应用").slice(0, 80),
          path: item.path
        }))
    : [];
  return { title, durationMinutes, mode, whitelist };
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleTriggerKey(schedule, date = new Date()) {
  return `${schedule.id}:${localDateKey(date)}:${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function isScheduleDue(schedule, date = new Date()) {
  if (!schedule?.enabled || !Array.isArray(schedule.days)) return false;
  if (!schedule.days.includes(date.getDay())) return false;
  const [hour, minute] = String(schedule.time || "").split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return hour === date.getHours() && minute === date.getMinutes();
}

function getTodayFocusMinutes(sessions, date = new Date()) {
  const key = localDateKey(date);
  return Math.round(
    (Array.isArray(sessions) ? sessions : [])
      .filter((session) => localDateKey(new Date(session.startedAt)) === key)
      .reduce((sum, session) => sum + Math.max(0, Number(session.elapsedMs) || 0), 0) /
      60000
  );
}

const exported = {
  EMERGENCY_PHRASE,
  MAX_FOCUS_MINUTES,
  DEFAULT_CLOCK_COLOR,
  createDefaultState,
  normalizeState,
  createId,
  sanitizeFocusConfig,
  formatClock,
  normalizeClockColor,
  localDateKey,
  scheduleTriggerKey,
  isScheduleDue,
  getTodayFocusMinutes
};

if (typeof module !== "undefined" && module.exports) module.exports = exported;
if (typeof window !== "undefined") window.TomatoCore = exported;
