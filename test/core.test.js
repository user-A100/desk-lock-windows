"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EMERGENCY_PHRASE,
  DEFAULT_CLOCK_COLOR,
  createDefaultState,
  normalizeState,
  sanitizeFocusConfig,
  formatClock,
  isScheduleDue,
  scheduleTriggerKey,
  getTodayFocusMinutes
} = require("../src/core");

test("default state is safe and starts in scholar mode", () => {
  const state = createDefaultState();
  assert.equal(state.settings.defaultMode, "scholar");
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.whitelist, []);
  assert.equal(EMERGENCY_PHRASE, "结束本次专注");
  assert.equal(state.settings.clockStyle, "ring");
  assert.equal(state.settings.clockColor, DEFAULT_CLOCK_COLOR);
});

test("state normalization clamps focus duration and preserves arrays", () => {
  const state = normalizeState({
    tasks: [{ id: "one" }],
    settings: { defaultDuration: 9999, defaultMode: "unknown", startWithWindows: 1 }
  });
  assert.equal(state.settings.defaultDuration, 480);
  assert.equal(state.settings.defaultMode, "scholar");
  assert.equal(state.settings.startWithWindows, true);
  assert.equal(state.settings.clockStyle, "ring");
  assert.equal(state.settings.clockColor, DEFAULT_CLOCK_COLOR);
  assert.equal(state.tasks.length, 1);
});

test("clock display settings preserve flip mode and safe hex colors", () => {
  const state = normalizeState({ settings: { clockStyle: "flip", clockColor: "#42A5F5" } });
  assert.equal(state.settings.clockStyle, "flip");
  assert.equal(state.settings.clockColor, "#42a5f5");
  assert.equal(normalizeState({ settings: { clockColor: "red; color: white" } }).settings.clockColor, DEFAULT_CLOCK_COLOR);
});

test("focus config sanitizes mode, duration, title, and whitelist", () => {
  const config = sanitizeFocusConfig({
    title: "  写完报告  ",
    durationMinutes: 0,
    mode: "strict",
    whitelist: [{ id: "vscode", name: "VS Code", path: "C:\\Code.exe" }, null]
  });
  assert.equal(config.title, "写完报告");
  assert.equal(config.durationMinutes, 1);
  assert.equal(config.mode, "strict");
  assert.equal(config.whitelist.length, 1);
});

test("clock formatting uses tabular minute and second pairs", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(1500), "25:00");
  assert.equal(formatClock(65), "01:05");
});

test("schedule matches only its configured local minute and weekday", () => {
  const date = new Date(2026, 7, 10, 20, 0, 15);
  const schedule = { id: "night", enabled: true, days: [1], time: "20:00" };
  assert.equal(isScheduleDue(schedule, date), true);
  assert.match(scheduleTriggerKey(schedule, date), /^night:2026-08-10:20:00$/);
  date.setMinutes(1);
  assert.equal(isScheduleDue(schedule, date), false);
});

test("today focus minutes ignores records from another day", () => {
  const now = new Date(2026, 7, 9, 12, 0);
  const sessions = [
    { startedAt: new Date(2026, 7, 9, 9, 0).getTime(), elapsedMs: 25 * 60000 },
    { startedAt: new Date(2026, 7, 8, 9, 0).getTime(), elapsedMs: 50 * 60000 }
  ];
  assert.equal(getTodayFocusMinutes(sessions, now), 25);
});
