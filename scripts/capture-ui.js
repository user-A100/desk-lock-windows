"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const outputDir = path.join(projectRoot, ".qa");
const openWindows = [];
app.setPath("userData", path.join(outputDir, "profile"));

async function waitForPaint(window) {
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function capture(fileName, width, height, outputName, setupScript = "") {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  openWindows.push(window);
  await window.loadFile(path.join(projectRoot, "src", fileName));
  await waitForPaint(window);
  if (setupScript) {
    await window.webContents.executeJavaScript(setupScript);
    await waitForPaint(window);
  }
  const metrics = await window.webContents.executeJavaScript(`({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    wrappedAffordances: [...document.querySelectorAll('button, .nav-item, .btn, .lock-btn')]
      .filter((element) => element.getClientRects().length && element.scrollHeight > element.clientHeight + 2)
      .map((element) => element.textContent.trim()).filter(Boolean)
  })`);
  if (outputName) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, outputName), image.toPNG());
  }
  return { fileName, width, height, ...metrics };
}

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  results.push(await capture("index.html", 1240, 820, "dashboard.png"));
  results.push(await capture("index.html", 1240, 820, "focus-dashboard.png", `
    document.querySelector('#focus-guard').hidden = false;
    document.querySelector('#guard-detail').textContent = '学霸模式 · 剩余 24:18 · 离开面板会继续拦截';
  `));
  results.push(await capture("index.html", 1240, 820, "app-picker.png", `
    document.querySelector('[data-view-target="whitelist"]').click();
    document.querySelector('#add-whitelist').click();
  `));
  results.push(await capture("index.html", 1240, 820, "clock-settings.png", `
    document.querySelector('[data-view-target="settings"]').click();
  `));
  results.push(await capture("lock.html", 1440, 900, "lock.png"));
  results.push(await capture("lock.html", 1440, 900, "lock-ring.png", `
    document.body.dataset.clockStyle = 'ring';
  `));
  for (const width of [320, 375, 414, 768]) {
    results.push(await capture("index.html", width, 820));
    results.push(await capture("lock.html", width, 820));
  }
  fs.writeFileSync(path.join(outputDir, "metrics.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  openWindows.forEach((window) => window.destroy());
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
