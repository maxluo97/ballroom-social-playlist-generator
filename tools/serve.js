// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * serve.js — a small local web server for the website folder (site/), with no dependencies.
 * Run with:   npm start      then open http://127.0.0.1:8000/   (another port: set PORT, e.g. for the snapshots)
 *
 * A server is needed because browsers block ES-module imports and data loading from
 * file:// pages. 127.0.0.1 (not "localhost") matches what Spotify requires for redirect URIs.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../site", import.meta.url))); // the website folder
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const file = normalize(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
  // Never serve anything outside the website folder (e.g. a request for "/../package.json").
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    // "no-store": the browser always reads the files again, so a change shows on the next reload.
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Serving on http://127.0.0.1:${PORT}/  (Ctrl+C to stop)`));
