// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * presets-index.js — writes presets/index.json, the list of shared presets the site offers.
 *
 * GitHub Pages cannot list a folder, so the site reads this list instead. Run it after adding,
 * changing or removing a settings file in presets/, then commit presets/:
 *     npm run presets
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSettingsFile } from "../site/js/shared/settings.js";

/** The shared presets in a folder: [{ file, name }], sorted by name; files that are not settings files are reported. */
export function presetsIndex(folder) {
  const dir = folder instanceof URL ? fileURLToPath(folder) : folder;
  const presets = [];
  const skipped = [];
  for (const file of readdirSync(dir)) {
    if (!/\.json$/i.test(file) || file === "index.json") continue;
    try {
      const { name } = parseSettingsFile(readFileSync(join(dir, file), "utf8"));
      presets.push({ file, name: name || file.replace(/\.json$/i, "") });
    } catch (err) {
      skipped.push(`${file}: ${err.message}`);
    }
  }
  presets.sort((a, b) => a.name.localeCompare(b.name));
  return { presets, skipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = fileURLToPath(new URL("../site/presets/", import.meta.url));
  const { presets, skipped } = presetsIndex(dir);
  writeFileSync(join(dir, "index.json"), JSON.stringify({ presets }, null, 2) + "\n");
  console.log(`presets/index.json: ${presets.length} shared preset(s)${presets.length ? `: ${presets.map((p) => p.name).join(", ")}` : ""}.`);
  for (const s of skipped) console.log(`  skipped (not a settings file): ${s}`);
}
