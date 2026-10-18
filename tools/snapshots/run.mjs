// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * run.mjs — snapshots: proof that a change did not change what the app does.
 *
 *   npm run snapshots:save    before a change: record the engine, the generator page and the library builder
 *   npm run snapshots:check   after it: record them again and compare; any difference is reported
 *
 * The engine snapshot is many generated nights (tools/snapshots/engine.mjs). The page snapshots drive a
 * real browser (Edge or Chrome, without a window) through fixed steps with a fake Spotify
 * (generator-page.mjs, library-page.mjs). Everything uses fixed random numbers, so the same code always
 * gives the same snapshot. A difference means the behavior changed: welcome if the change was meant to
 * do that (then save again), a bug if not.
 *
 * The snapshots are kept in .snapshots/ (not in git: they are large, and only meaningful on this
 * computer). This starts its own local server for the pages, on port 8765.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordEngine } from "./engine.mjs";
import { recordGeneratorPage } from "./generator-page.mjs";
import { recordLibraryPage } from "./library-page.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FOLDER = join(ROOT, ".snapshots");
const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const mode = process.argv[2];
if (mode !== "save" && mode !== "check") {
  console.log("Use: npm run snapshots:save (before a change) or npm run snapshots:check (after it).");
  process.exit(1);
}

/** The first difference between two recordings, as a short text (null if they are the same). */
function firstDifference(before, after) {
  for (let iRecord = 0; iRecord < Math.max(before.length, after.length); iRecord++) {
    const oldText = JSON.stringify(before[iRecord]);
    const newText = JSON.stringify(after[iRecord]);
    if (oldText === newText) continue;
    const name = (before[iRecord] || after[iRecord] || {}).name || "(helpers)";
    const seed = (before[iRecord] || {}).seed;
    let iChar = 0;
    while (oldText && newText && oldText[iChar] === newText[iChar]) iChar++;
    return `record ${iRecord + 1} (${name}${seed ? `, seed ${seed}` : ""}):\n      before: …${(oldText || "(missing)").slice(Math.max(0, iChar - 80), iChar + 120)}…\n      after:  …${(newText || "(missing)").slice(Math.max(0, iChar - 80), iChar + 120)}…`;
  }
  return null;
}

/** Start the local server for the pages, and wait until it answers. */
async function startServer() {
  const server = spawn(process.execPath, [join(ROOT, "tools/serve.js")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  for (let tries = 0; tries < 50; tries++) {
    try {
      if ((await fetch(BASE_URL + "index.html")).ok) return server;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  server.kill();
  throw new Error(`The local server did not start on port ${PORT} (is something else using it?).`);
}

const parts = [
  { file: "engine.json", label: "the generator engine", record: () => recordEngine(ROOT) },
  { file: "generator-page.json", label: "the generator page (and the program and live pages)", record: () => recordGeneratorPage(ROOT, BASE_URL) },
  { file: "library-page.json", label: "the library builder", record: () => recordLibraryPage(ROOT, BASE_URL) },
];

mkdirSync(FOLDER, { recursive: true });
const server = await startServer();
let differences = 0;
try {
  for (const part of parts) {
    process.stdout.write(`${part.label}… `);
    const records = await part.record();
    const pageErrors = records.filter((record) => record.errors && record.errors.length);
    const file = join(FOLDER, part.file);
    if (mode === "save") {
      writeFileSync(file, JSON.stringify(records));
      console.log(`saved (${records.length} records)${pageErrors.length ? `; page errors in: ${pageErrors.map((record) => record.name).join(", ")}` : ""}`);
      continue;
    }
    if (!existsSync(file)) {
      console.log("no saved snapshot: run npm run snapshots:save first (before the change).");
      differences++;
      continue;
    }
    const difference = firstDifference(JSON.parse(readFileSync(file, "utf8")), JSON.parse(JSON.stringify(records)));
    if (difference) differences++;
    console.log(difference ? `DIFFERENT, first at ${difference}` : `the same (${records.length} records)`);
    if (pageErrors.length) console.log(`  page errors in: ${pageErrors.map((record) => `${record.name}: ${record.errors[0].slice(0, 120)}`).join(" | ")}`);
  }
} finally {
  server.kill();
}
if (mode === "check") console.log(differences ? "\nSome snapshots differ: the behavior changed (see above)." : "\nEverything is the same as before.");
process.exit(mode === "check" && differences ? 1 : 0);
