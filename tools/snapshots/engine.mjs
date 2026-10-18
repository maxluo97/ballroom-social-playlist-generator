// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * engine.mjs — the generator engine's snapshot: many nights generated from fixed seeds (every test
 * scenario, the default settings and every shared preset, chosen songs, must-play songs, a song filter,
 * locked regeneration), with their warnings, rule checks and settings checks. The same seed always gives
 * the same night, so any change in what the engine does shows up as a difference.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SEEDS = 40;

export async function recordEngine(root) {
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const generator = await load("site/js/generator/generator.js");
  const editing = await load("site/js/generator/playlist-edit.js");
  const { parseSettingsFile } = await load("site/js/shared/settings.js");
  const { buildSongs, SCENARIOS } = await load("test/sample-data.js");
  const { buildSampleLibrary } = await load("tools/sample-library.js");

  const records = [];
  const recordNights = (name, songs, settings, options = {}) => {
    records.push({ name, validate: generator.validateSettings(songs, settings) });
    for (let seed = 1; seed <= SEEDS; seed++) {
      const result = generator.generatePlaylist(songs, { ...settings, seed }, options);
      records.push({ name, seed, result, rules: generator.checkRules(result, { ...settings, seed }) });
    }
  };

  // 1. The test scenarios.
  for (const scenario of SCENARIOS) recordNights(`scenario: ${scenario.name}`, scenario.songs ?? buildSongs(scenario.perDance), scenario.settings);

  // 2. The default settings and the shared presets, with the sample library.
  const sampleLibrary = buildSampleLibrary();
  const presetFiles = [join(root, "site/data/default-settings.json"),
    ...readdirSync(join(root, "site/presets")).filter((file) => file.endsWith(".json") && file !== "index.json").sort().map((file) => join(root, "site/presets", file))];
  const presets = presetFiles.map((file) => ({ name: file.slice(root.length), settings: parseSettingsFile(readFileSync(file, "utf8")).settings }));
  for (const preset of presets) recordNights(`preset: ${preset.name}`, sampleLibrary, preset.settings);

  // 3. Chosen songs, must-play songs, a song filter, versions and duplicates.
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const library = buildSongs(10).map((song, iSong) => ({ ...song, isrc: iSong % 17 === 0 ? "SAME" : `I${song.id}`, title: iSong % 23 === 0 ? "Moon River" : song.title }));
  const ids = library.map((song) => song.id);
  recordNights("chosen + must-play", library, {
    ...base,
    mustPlay: [ids[5], ids[60], ids[130], ids[200]],
    specialBlocks: [...base.specialBlocks,
      { source: "songs", songs: [ids[3], ids[40], ids[77], ids[120]], keepApart: true, placement: { mode: "window", from: 0.3, to: 0.5 }, interruptBy: { excursions: true } },
      { tag: "Hollywood", count: 3, inTurns: false, placement: { mode: "random" }, afterInterruption: "end", interruptBy: { excursions: true, theme: true } }],
    theme: { name: "Mixed", dances: ["Waltz", "Hustle"], tags: ["Hollywood"], fractionMin: 0.3, fractionMax: 0.45 },
  });
  recordNights("song filter", library, base, {
    songFilter: (song, { index }) => !(index >= 0 && index < 6 && /Quickstep/.test(song.dances.join())) && !song.id.endsWith("3"),
  });
  recordNights("works off", library, { ...base, noRepeatWorks: false, minSongSec: 150, maxSongSec: 260 });

  // 4. Locked regeneration: lock some rows of a night (including a whole block), regenerate the rest.
  for (const preset of [...presets, { name: "base", settings: base }]) {
    const songs = preset.name === "base" ? library : sampleLibrary;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const result = editing.prepareGenerated(generator.generatePlaylist(songs, { ...preset.settings, seed }), preset.settings);
      result.playlist.forEach((row, iRow) => {
        if (iRow % 4 === 1 || row.kind === "final" || (row.blockId === 0 && seed % 2)) row.locked = true;
      });
      const locked = editing.lockedForRegeneration(result);
      const regenerated = generator.generatePlaylist(songs, { ...preset.settings, seed: seed + 1000 }, { locked });
      records.push({ name: `locked: ${preset.name}`, seed, locked, result: regenerated, rules: generator.checkRules(regenerated, preset.settings) });
    }
  }

  // 5. Small helpers the rest of the app uses.
  records.push({
    helpers: {
      formatTime: [0, 59.6, 61, 3599, -75].map(generator.formatTime),
      listDances: generator.listDances(sampleLibrary, presets[0].settings),
      themeMinGapFor: presets.map((preset) => generator.themeMinGapFor(preset.settings)),
      themeMinGapApplies: presets.map((preset) => generator.themeMinGapApplies(preset.settings)),
      withinLengthLimits: [100, 150, 300].map((lengthSec) => generator.withinLengthLimits({ lengthSec }, { minSongSec: 120, maxSongSec: 270 })),
      blockLabel: [{ name: " X " }, { source: "songs" }, { source: "dances", dances: ["A", "B"] }, { source: "dances" }, { tag: "T" }, {}].map(generator.blockLabel),
      mergeSettings: generator.mergeSettings(presets[1] ? presets[1].settings : presets[0].settings),
      associationMap: ["Smooth Waltz", "Latin Jive", "Nothing"].map(generator.associationMap(presets[0].settings.associations)),
      exports: Object.keys(generator).sort(),
    },
  });
  return records;
}
