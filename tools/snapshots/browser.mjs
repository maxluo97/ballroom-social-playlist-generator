// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * browser.mjs — drive a real browser (Edge or Chrome, without a window) for the page snapshots, through
 * the browser's standard remote-control interface (the "Chrome DevTools Protocol"). No outside tools.
 *
 * launchBrowser({ injected }) starts the browser with a fresh, empty profile; `injected` is a script
 * that runs in every page before the page's own scripts (the snapshots use it for a fake Spotify,
 * fixed random numbers and helpers). The returned object can go to a page, run code in it, wait for
 * something, and record the page after a step.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The browsers tried, in order (or the BROWSER environment variable). */
const BROWSER_PATHS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/microsoft-edge",
].filter(Boolean);

let nextDebugPort = 9333;

export async function launchBrowser({ injected, baseUrl }) {
  const browserPath = BROWSER_PATHS.find((path) => existsSync(path));
  if (!browserPath) throw new Error("No Edge or Chrome found. Set the BROWSER environment variable to the browser's program file.");
  const debugPort = nextDebugPort++;
  const profile = mkdtempSync(join(tmpdir(), "dpg-snapshots-"));
  const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let tries = 0; tries < 75 && !target; tries++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((candidate) => candidate.type === "page");
    } catch {
      /* not started yet */
    }
  }
  if (!target) throw new Error(`The browser (${browserPath}) did not start.`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let nextMessageId = 1;
  const waiting = new Map();
  const events = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && waiting.has(data.id)) {
      waiting.get(data.id)(data);
      waiting.delete(data.id);
    } else if (data.method) events.push(data);
  };
  /** Send one command to the browser and wait for its answer. */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextMessageId++;
    waiting.set(id, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  /** Run JavaScript in the page (awaiting it) and return its value. */
  const evaluate = async (expression) => {
    const answer = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) {
      throw new Error(`in the page: ${answer.exceptionDetails.exception ? answer.exceptionDetails.exception.description : answer.exceptionDetails.text}`);
    }
    return answer.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: injected });

  const records = [];
  return {
    records,
    evaluate,
    sleep,
    /** Open a page of the site (and give it a moment to start). */
    async goto(path) {
      await send("Page.navigate", { url: baseUrl + path });
      await sleep(1500);
    },
    /** Wait until `expression` is true in the page. */
    async waitFor(expression, timeoutMs = 15000) {
      for (let waitedMs = 0; waitedMs < timeoutMs; waitedMs += 100) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    /** Do a step (code run in the page), let the page settle, and record it (window.__snap() and any page errors). */
    async step(name, action, settleMs = 400) {
      if (action) await evaluate(`(async () => { ${action} })()`);
      await sleep(settleMs);
      const errors = events.filter((event) => event.method === "Runtime.exceptionThrown")
        .map((event) => event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      events.length = 0;
      records.push({ name, errors, ...(await evaluate("window.__snap()")) });
    },
    async close() {
      socket.close();
      browser.kill();
      await sleep(500);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the browser may still hold it for a moment; the system's temporary folder is cleaned up eventually */
      }
    },
  };
}

/** The code shared by the injected scripts: fixed random numbers, automatic answers to dialogs, step helpers. */
export const PAGE_HELPERS = `
  // Fixed random numbers (mulberry32), so every run makes the same playlists.
  let randomSeed = 12345;
  Math.random = () => { randomSeed = (randomSeed + 0x6d2b79f5) >>> 0; let mixed = randomSeed; mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1); mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61); return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296; };
  // Dialogs answer by themselves (and are recorded).
  window.__alerts = [];
  window.alert = (message) => window.__alerts.push(String(message));
  window.confirm = (message) => { window.__alerts.push("confirm: " + String(message).slice(0, 80)); return true; };
  window.prompt = (message, suggested) => suggested;
  window.open = (url) => { window.__alerts.push("open " + url); return null; };
  window.__buttons = (text, startsWith = false) => [...document.querySelectorAll("button, a, summary")].filter((node) => (startsWith ? node.textContent.trim().startsWith(text) : node.textContent.trim() === text));
  window.__click = (text, nth = 0, startsWith = false) => { const node = window.__buttons(text, startsWith)[nth]; if (!node) throw new Error("no button: " + text + " #" + nth); node.click(); };
  window.__type = (selector, value, nth = 0, eventName = "input") => { const node = document.querySelectorAll(selector)[nth]; if (!node) throw new Error("no " + selector); node.value = value; node.dispatchEvent(new Event(eventName, { bubbles: true })); };
`;
