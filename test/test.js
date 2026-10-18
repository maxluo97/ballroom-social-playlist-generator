// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * test.js — runs the generator over many seeds for each scenario and reports problems.
 *
 * Run from the project folder with:   npm test        (or: node test/test.js)
 * Optional: node test/test.js 2000    to change the number of seeds per scenario.
 *
 * What counts as a BUG:
 *   - generatePlaylist throws
 *   - checkRules reports a violation but the generator gave no warning (it broke a rule silently)
 *   - the same seed gives a different playlist (not reproducible)
 *   - a song is used twice without a "song reuse" warning
 *   - overtime exceeds the longest song length, or the night ends more than one song early
 * Everything else (rules relaxed WITH a warning) is reported as information.
 */

import { generatePlaylist, checkRules, validateSettings, listDances, formatTime, withinLengthLimits, themeMinGapFor, themeMinGapApplies } from "../site/js/generator/generator.js";
import { buildSongs, SCENARIOS } from "./sample-data.js";
import { buildSampleLibrary } from "../tools/sample-library.js";
import { APP_DEFAULTS } from "./defaults.js";
import { parseSettingsFile, settingsFileText } from "../site/js/shared/settings.js";

const SEEDS = Number(process.argv[2]) || 500;
const SHOW_EXAMPLES = 3;
let totalBugs = 0;

/* ---- association checks ---- */
{
  console.log("=== Associations");
  const lib = buildSampleLibrary();
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const raw = listDances(lib, {});
  const merged = listDances(lib, APP_DEFAULTS);
  console.log(`  dances in library: ${raw.length} raw, ${merged.length} after the default associations`);
  expect(raw.length === 26, `expected 26 raw dances, got ${raw.length}`);
  expect(merged.includes("Waltz") && !merged.includes("Smooth Waltz"), "Smooth Waltz should merge into Waltz");
  expect(merged.includes("Rhythm Rumba"), "unassociated Rhythm Rumba should keep its name");

  const errorsFor = (associations, categories = [{ name: "A", dances: ["Waltz"] }]) =>
    validateSettings(lib, { associations, categories }).errors;
  expect(errorsFor([{ name: "Waltz", dances: ["Smooth Waltz", "Standard Waltz"] }]).length === 0, "valid association rejected");
  expect(
    errorsFor([
      { name: "Waltz", dances: ["Smooth Waltz"] },
      { name: "Waltz 2", dances: ["Smooth Waltz"] },
    ]).length > 0,
    "dance in two associations not reported"
  );
  expect(
    errorsFor([{ name: "Waltz", dances: ["Smooth Waltz", "Standard Waltz"] }], [
      { name: "Smooth", dances: ["Smooth Waltz"] },
      { name: "Standard", dances: ["Standard Waltz"] },
    ]).some((e) => e.includes("after associations")),
    "merged dance landing in two categories not reported"
  );

  // A merged dance must be playable from either source tag.
  const res = generatePlaylist(lib, { ...APP_DEFAULTS, seed: 7 });
  const waltzSources = new Set(res.playlist.filter((row) => row.dance === "Waltz").flatMap((row) => row.song.sourceDances));
  console.log(`  "Waltz" slots drew songs tagged: ${[...waltzSources].join(", ")}`);
  expect(waltzSources.has("Smooth Waltz") || waltzSources.has("Standard Waltz"), "Waltz slots drew no Smooth/Standard Waltz songs");
}

/* ---- settings files ---- */
{
  console.log("=== Settings files");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const back = parseSettingsFile(settingsFileText(APP_DEFAULTS, "Test night"));
  expect(back.name === "Test night", "file name kept");
  expect(JSON.stringify(back.settings) === JSON.stringify({ ...APP_DEFAULTS, seed: null }), "settings survive save + load unchanged");
  let refused = 0;
  const bare = JSON.stringify(APP_DEFAULTS); // settings without the file wrapper are not a settings file
  for (const bad of ["not json", "{}", '{"kind": "settings", "settings": {"maxInARow": 3}}', bare]) {
    try {
      parseSettingsFile(bad);
    } catch {
      refused++;
    }
  }
  expect(refused === 4, "anything but the settings file format is refused");
  const violation = validateSettings(buildSampleLibrary(), APP_DEFAULTS);
  console.log(`  default settings with the sample library: ${violation.errors.length} errors, ${violation.warnings.length} warnings`);
  violation.warnings.forEach((warning) => console.log(`    warning: ${warning}`));
  expect(violation.errors.length === 0, `default settings have errors: ${violation.errors.join("; ")}`);
}

/* ---- theme openers for a theme with dances ---- */
{
  console.log("=== Theme openers (theme dances)");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const lib = buildSampleLibrary();
  // The openers are the opening songs (Opening length).
  const night = (dances, openers, seed) => {
    const settings = {
      ...APP_DEFAULTS, seed, specialBlocks: [],
      opening: { earlyCount: openers, blacklist: ["Quickstep"] },
      theme: { name: "t", dances, fractionMin: 0.2, fractionMax: 0.25 },
    };
    const result = generatePlaylist(lib, settings);
    return { result, settings, first: result.playlist.slice(0, openers).map((row) => row.dance) };
  };
  let tagExcursionOpeners = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const one = night(["Foxtrot"], 3, seed);
    expect(one.first.join() === "Foxtrot,Foxtrot,Foxtrot", `one theme dance opens every opener: ${one.first}`);
    expect(checkRules(one.result, one.settings).length === 0, `openers do not count as broken rules: ${JSON.stringify(checkRules(one.result, one.settings)[0])}`);
    expect(one.result.playlist[3].dance !== "Foxtrot", "after the openers, spacing applies again");

    const two = night(["Foxtrot", "Quickstep"], 4, seed);
    expect(["Foxtrot,Quickstep,Foxtrot,Quickstep", "Quickstep,Foxtrot,Quickstep,Foxtrot"].includes(two.first.join()),
      `two theme dances, 4 openers: ABAB or BABA: ${two.first}`);
    expect(two.first.includes("Quickstep"), "a theme dance on the opening blacklist may still open");

    const three = night(["Foxtrot", "Quickstep", "Waltz"], 2, seed);
    expect(new Set(three.first).size === 2, `more theme dances than openers: two different ones open: ${three.first}`);
    expect(checkRules(three.result, three.settings).length === 0, `3 dances, 2 openers: no broken rules: ${JSON.stringify(checkRules(three.result, three.settings)[0])}`);
    const five = night(["Foxtrot", "Quickstep", "Waltz"], 7, seed).first;
    const counts = Object.values(five.reduce((m, d) => ({ ...m, [d]: (m[d] || 0) + 1 }), {}));
    expect(five.every((d, i) => i === 0 || d !== five[i - 1]), `no theme dance opens twice in a row: ${five}`);
    expect(Math.max(...counts) - Math.min(...counts) <= 1 && counts.length === 3, `theme dances open equally often: ${five}`);

    // Bachata is only an excursion: a theme dance there gets a warning, and it does not open.
    const exc = night(["Mambo / Salsa", "Bachata"], 4, seed);
    expect(exc.first.join() === "Mambo / Salsa,Mambo / Salsa,Mambo / Salsa,Mambo / Salsa", `an excursion theme dance does not open: ${exc.first}`);
    if (seed === 1) {
      expect(validateSettings(lib, exc.settings).warnings.some((warning) => warning.includes('"Bachata" is still an excursion')),
        "a theme dance left as an excursion is warned about");
    }

    // A tag-only theme: excursion songs with the tag may open, without using up their excursion counts.
    const tagSettings = { ...APP_DEFAULTS, seed, specialBlocks: [], opening: { ...APP_DEFAULTS.opening, earlyCount: 3 }, theme: { name: "Hollywood", tags: ["Hollywood"] } };
    const tag = generatePlaylist(lib, tagSettings);
    const openers = tag.playlist.slice(0, 3);
    expect(openers.every((row) => row.isTheme), `tag-theme openers are theme songs: ${openers.map((row) => row.dance)}`);
    tagExcursionOpeners += openers.filter((row) => row.kind === "excursion").length;
    expect(checkRules(tag, tagSettings).length === 0, `tag-theme openers: no broken rules: ${JSON.stringify(checkRules(tag, tagSettings)[0])}`);
  }
  console.log(`  tag theme: ${tagExcursionOpeners} of 150 openers were excursion songs`);
  expect(tagExcursionOpeners > 0, "excursion songs with a theme tag never opened");
}

/* ---- theme rules (the agreed theme spec, NOTES.md v0.2.4) ---- */
{
  console.log("=== Theme rules");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const songs = buildSongs(20);
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const noHustle = { intervalMinutes: 25, jitterMinutes: 0, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } };
  const opening = base.opening.earlyCount;
  /** Gaps between songs of a dance, leaving out the openers (which ignore the gaps). */
  const gaps = (pl, dance) => {
    const at = pl.filter((row) => row.dance === dance && row.kind !== "final" && row.index >= opening).map((row) => row.index);
    return at.slice(1).map((x, i) => x - at[i] - 1);
  };

  // Which themes show the theme minimum gap setting, and its default.
  const withTheme = (theme, extra = {}) => ({ ...base, ...extra, theme: { fractionMin: 0.15, fractionMax: 0.25, ...theme } });
  expect(themeMinGapApplies(withTheme({ tags: ["Hollywood"] })), "a tag theme shows the theme minimum gap");
  expect(themeMinGapApplies(withTheme({ dances: ["Hustle"] }, { excursions: noHustle })), "a single standalone dance shows it");
  expect(!themeMinGapApplies(withTheme({ dances: ["Foxtrot"] })), "a theme dance in a category does not");
  expect(!themeMinGapApplies(withTheme({ dances: ["Hustle", "Foxtrot"] }, { excursions: noHustle })), "standalone + category dances do not");
  expect(themeMinGapFor(base) === 2 && themeMinGapFor({ ...base, minToRepeat: 6 }) === 4, "default: the normal gap minus 2");
  expect(themeMinGapFor(withTheme({ tags: ["Hollywood"], minGap: 3 })) === 3, "the setting is used when given");
  const capped = validateSettings(songs, withTheme({ dances: ["Rumba"], fractionMin: 0.2, fractionMax: 0.25 })).warnings;
  expect(capped.some((warning) => warning.includes("remove \"Rumba\" from its category") && warning.includes("33%")),
    `a capped theme share suggests taking the theme dance out of its category: ${capped.join(" | ")}`);

  let lowered = 0;
  let hiddenSongs = 0;
  let tagSongs = 0;
  let waltzThemeSongs = 0;
  const firstExcursion = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    // A single standalone dance: the hidden theme category, with the theme minimum gap (2).
    const hn = withTheme({ dances: ["Hustle"] }, { excursions: noHustle, seed });
    const result1 = generatePlaylist(songs, hn);
    const hustles = result1.playlist.filter((row) => row.dance === "Hustle");
    hiddenSongs += hustles.filter((row) => row.kind === "theme").length;
    expect(hustles.every((row) => row.kind === "theme" && row.isTheme), "standalone dance songs are hidden-category theme songs");
    const g1 = gaps(result1.playlist, "Hustle");
    expect(g1.every((g) => g >= 2), `a single standalone dance keeps the theme minimum gap: ${g1}`);
    lowered += g1.filter((g) => g < 4).length;
    expect(checkRules(result1, hn).length === 0, `Hustle night: no broken rules: ${JSON.stringify(checkRules(result1, hn)[0])}`);

    // Several standalone dances + one in a category: the hidden category's shuffle-bag and gap n = 2.
    const cn = withTheme({ dances: ["Foxtrot", "Hustle", "Night Club Two Step"], fractionMin: 0.25, fractionMax: 0.4 },
      { excursions: { ...noHustle, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } }, seed });
    const result2 = generatePlaylist(songs, cn);
    expect(checkRules(result2, cn).length === 0, `club night: no broken rules: ${JSON.stringify(checkRules(result2, cn)[0])}`);
    const openers = result2.playlist.slice(0, opening);
    expect(openers.every((row) => ["Foxtrot", "Hustle", "Night Club Two Step"].includes(row.dance)), "standalone dances open too");
    // Hidden songs do not take category turns: removing them leaves runs within Max in a row.
    const regular = result2.playlist.filter((row) => row.kind === "regular");
    let run = 0;
    let prev = null;
    let longest = 0;
    for (const row of regular.filter((x) => x.index >= opening)) {
      run = row.category === prev ? run + 1 : 1;
      prev = row.category;
      longest = Math.max(longest, run);
    }
    expect(longest <= cn.maxInARow, `hidden theme songs leave the category turns alone: run of ${longest}`);

    // A mixed theme: tags and dances counted independently.
    const mx = withTheme({ dances: ["Waltz"], tags: ["Hollywood"], fractionMin: 0.3, fractionMax: 0.45 }, { seed });
    const result3 = generatePlaylist(songs, mx);
    tagSongs += result3.playlist.filter((row) => row.isTheme && row.dance !== "Waltz").length;
    waltzThemeSongs += result3.playlist.filter((row) => row.isTheme && row.dance === "Waltz" && !(row.song.tags || []).includes("Hollywood")).length;

    // Excursions: the first one also gets the random variation.
    const ex = { ...base, seed, excursions: { ...base.excursions, jitterMinutes: 3 } };
    const first = generatePlaylist(songs, ex).playlist.find((row) => row.kind === "excursion");
    if (first) firstExcursion.add(first.startSec);
  }
  console.log(`  Hustle night: ${hiddenSongs} hidden-category songs; ${lowered} repeats closer than the normal gap of 4`);
  console.log(`  mixed theme: ${tagSongs} tagged theme songs of other dances, ${waltzThemeSongs} untagged Waltz theme songs`);
  expect(lowered > 0, "a single standalone dance never used its shorter gap");
  expect(tagSongs > 0 && waltzThemeSongs > 0, "a mixed theme should play both tag and dance theme songs");
  expect(firstExcursion.size > 3, `the first excursion's time varies: ${firstExcursion.size} different start times`);

  // Categories take turns equally: theme dances in one of two categories cannot reach much more than
  // half of the songs, and the settings check says so (the Latin night preset splits its category instead).
  const sample = buildSampleLibrary();
  const latin = APP_DEFAULTS.categories.find((c) => /Latin/.test(c.name)).dances;
  const latinNight = (fractionMin, categories = APP_DEFAULTS.categories) => ({
    ...APP_DEFAULTS, categories, theme: { name: "Latin night", dances: latin, fractionMin, fractionMax: Math.max(fractionMin, 0.65) },
  });
  const turnsWarning = (s) => validateSettings(sample, s).warnings.some((warning) => /categories take turns equally/.test(warning));
  expect(turnsWarning(latinNight(0.6)), "a theme share out of reach because of the category turns is warned about");
  const reached = Array.from({ length: 20 }, (_, i) => generatePlaylist(sample, { ...latinNight(0.6), seed: i + 1 }).stats.themeFraction);
  expect(Math.max(...reached) < 0.5, `and it is indeed out of reach: up to ${Math.round(Math.max(...reached) * 100)}%`);
  expect(!turnsWarning(latinNight(0.3)), "a share within reach is not warned about");
  const split = [APP_DEFAULTS.categories[0], { name: "Latin I", dances: latin.slice(0, 3) }, { name: "Latin II", dances: latin.slice(3) }];
  expect(!turnsWarning(latinNight(0.5, split)), "with the Latin dances split into two categories, 50% is within reach");
}

/* ---- special blocks from a tag (the agreed spec, NOTES.md v0.2.4, v0.4) ---- */
{
  console.log("=== Themed blocks");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const songs = buildSongs(10);
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  // The tested blocks come first (block IDs 0, 1, …), then the base's line dance and Paso Doble.
  const night = (blocks, extra = {}) => ({ ...base, ...extra, specialBlocks: [...blocks, ...base.specialBlocks] });
  const blockSongs = (result, id = 0) => result.playlist.filter((row) => row.blockId === id);
  const together = (items) => items.every((row, i) => i === 0 || row.index === items[i - 1].index + 1);
  const ruleBreaks = (result, settings) => checkRules(result, settings);

  let interruptedContinue = 0;
  let endedEarly = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // A turn-taking block: 4 tagged songs in a row, in the normal category turns, from 40%.
    const s1 = night([{ tag: "Hollywood", count: 4, placement: { mode: "at", at: 0.4 } }], { seed });
    const result1 = generatePlaylist(songs, s1);
    const b1 = blockSongs(result1);
    expect(b1.length === 4 && together(b1), `a turn-taking block plays its 4 songs together: ${b1.map((x) => x.index)}`);
    expect(b1.every((row) => row.kind === "regular" && row.song.tags.includes("Hollywood")), "its songs are regular songs with the tag");
    expect(b1[0].startSec >= 0.4 * result1.targetSec, "it starts at or after its point");
    expect(ruleBreaks(result1, s1).length === 0, `turn-taking block: no broken rules: ${JSON.stringify(ruleBreaks(result1, s1)[0])}`);

    // A kept-apart block at the same point as the line dance (50%): never back to back with it.
    const s2 = night([{ tag: "Hollywood", count: 3, inTurns: false, keepApart: true, placement: { mode: "at", at: 0.5 } }], { seed });
    const result2 = generatePlaylist(songs, s2);
    const b2 = blockSongs(result2);
    expect(b2.length === 3 && together(b2) && b2.every((row) => row.kind === "block"), "a kept-apart block plays together, outside the turns");
    const before = result2.playlist[b2[0].index - 1];
    const after = result2.playlist[b2.at(-1).index + 1];
    expect(before.kind !== "event" && (!after || after.kind !== "event"), "a kept-apart block is never back to back with the line dance or Paso Doble");
    expect(ruleBreaks(result2, s2).length === 0, `kept-apart block: no broken rules: ${JSON.stringify(ruleBreaks(result2, s2)[0])}`);

    // A block placed in the opening waits until the opening is over.
    const s3 = night([{ tag: "Hollywood", count: 2, placement: { mode: "at", at: 0 } }], { seed });
    const b3 = blockSongs(generatePlaylist(songs, s3));
    expect(b3[0].index === base.opening.earlyCount, `a block in the opening moves to just after it: starts at #${b3[0].index + 1}`);

    // Interruptions: by default an excursion waits; if allowed, the block continues (or ends, if chosen).
    const often = { excursions: { ...base.excursions, intervalMinutes: 4 } };
    const s4 = night([{ tag: "Hollywood", count: 5, placement: { mode: "at", at: 0.3 } }], { ...often, seed });
    const b4 = blockSongs(generatePlaylist(songs, s4));
    expect(b4.length === 5 && together(b4), "by default nothing interrupts a block");
    const s5 = night([{ tag: "Hollywood", count: 5, placement: { mode: "at", at: 0.3 }, interruptBy: { excursions: true } }], { ...often, seed });
    const result5 = generatePlaylist(songs, s5);
    const b5 = blockSongs(result5);
    expect(b5.length === 5, `"continue": the block still plays all its songs: ${b5.length}`);
    if (!together(b5)) {
      interruptedContinue++;
      const gaps = result5.playlist.slice(b5[0].index, b5.at(-1).index + 1).filter((row) => row.blockId !== 0);
      expect(gaps.every((row) => row.kind === "excursion"), `only an allowed interruption comes between block songs: ${gaps.map((x) => x.kind)}`);
    }
    const s6 = night([{ tag: "Hollywood", count: 5, placement: { mode: "at", at: 0.3 }, interruptBy: { excursions: true }, afterInterruption: "end" }], { ...often, seed });
    const result6 = generatePlaylist(songs, s6);
    const b6 = blockSongs(result6);
    if (b6.length < 5) endedEarly++;
    expect(together(b6) && !result6.warnings.some((warning) => /shrank/.test(warning.message)), '"end": the block just stops at an interruption, without a warning');

    // Several blocks; a block that comes due during another one waits for it.
    const s7 = night([
      { tag: "Hollywood", count: 3, placement: { mode: "at", at: 0.3 } },
      { tag: "Hollywood", count: 3, inTurns: false, keepApart: true, placement: { mode: "at", at: 0.3 } },
    ], { seed });
    const result7 = generatePlaylist(songs, s7);
    const [x, y] = [blockSongs(result7, 0), blockSongs(result7, 1)];
    expect(x.length === 3 && y.length === 3, "several blocks each play");
    expect(x.at(-1).index < y[0].index || y.at(-1).index < x[0].index, "blocks do not overlap");
    expect(ruleBreaks(result7, s7).length === 0, `two blocks: no broken rules: ${JSON.stringify(ruleBreaks(result7, s7)[0])}`);

    // Theme share: block songs count only if they match the theme.
    const s8 = night([{ tag: "Hollywood", count: 4, placement: { mode: "at", at: 0.4 } }],
      { seed, theme: { name: "Waltz night", dances: ["Waltz"], fractionMin: 0.15, fractionMax: 0.2 } });
    const b8 = blockSongs(generatePlaylist(songs, s8));
    expect(b8.every((row) => row.isTheme === (row.dance === "Waltz")), "block songs are theme songs only if they match the theme");
  }
  console.log(`  "continue": ${interruptedContinue} of 100 blocks were interrupted and continued; "end": ${endedEarly} of 100 ended early`);
  expect(interruptedContinue > 0 && endedEarly > 0, "with excursions every 4 minutes, some blocks should be interrupted");

  // Not enough tagged songs: a warning before generating, and the block shrinks with a warning.
  const pickDance = (d) => songs.find((song) => song.dances.length === 1 && song.dances[0] === d);
  const few = [...songs.map((song) => ({ ...song, tags: [] })), ...["Foxtrot", "Cha-cha"].map((d, i) => ({ ...pickDance(d), id: `rare${i}`, tags: ["Rare"] }))];
  const s9 = night([{ tag: "Rare", count: 4, placement: { mode: "at", at: 0.4 } }], { seed: 1 });
  expect(validateSettings(few, s9).warnings.some((warning) => warning.includes('"Rare block" needs 4 songs')), "too few tagged songs is warned about");
  const r9 = generatePlaylist(few, s9);
  expect(blockSongs(r9).length < 4 && r9.warnings.some((warning) => /shrank to d of 4|could not play/.test(warning.message)),
    `the block shrinks, with a warning: ${blockSongs(r9).length} songs; ${r9.warnings.map((warning) => warning.message)}`);
  expect(validateSettings(songs, night([{ tag: "", count: 4 }])).errors.length > 0, "a block without a tag is an error");
}

/* ---- works and duplicates (the agreed spec, NOTES.md v0.2.4) ---- */
{
  console.log("=== Works and duplicates");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  // 3 of the Waltz songs are the same work,
  // and 2 of them (different IDs) the same recording.
  const lib = buildSongs(10).map((song) => ({ ...song, isrc: `ISRC${song.id}` }));
  const waltz = lib.filter((song) => song.dances.length === 1 && song.dances[0] === "Waltz").slice(0, 3);
  waltz[0].title = "Moon River";
  waltz[1].title = "Moon River - 2011 Remaster";
  waltz[2].title = "Moon River (Live)";
  waltz[2].isrc = waltz[1].isrc; // the same recording as waltz[1], under another ID
  const ids = waltz.map((song) => song.id);
  const count = (result, list) => result.playlist.filter((row) => list.includes(row.song.id)).length;

  let bothWorksWhenOff = 0;
  let separated = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const on = { ...base, seed };
    const result1 = generatePlaylist(lib, on);
    expect(count(result1, ids) <= 1, `no two versions of one work in a night: ${count(result1, ids)}`);
    expect(!checkRules(result1, on).some((violation) => violation.rule === "sameWork" || violation.rule === "duplicateRecording"), "no works/duplicates rule breaks");

    const off = { ...base, seed, noRepeatWorks: false };
    const result2 = generatePlaylist(lib, off);
    expect(count(result2, [ids[1], ids[2]]) <= 1, "duplicates never play together, even with the works rule off");
    if (count(result2, ids) === 2) bothWorksWhenOff++;

    // Overrides: a different work name, and "Not a duplicate", separate the songs again.
    const split = lib.map((song) => (song.id === ids[2] ? { ...song, work: "Another song", recording: `id:${song.id}` } : song.id === ids[1] ? { ...song, work: "Third song" } : song));
    if (count(generatePlaylist(split, on), ids) >= 2) separated++;
  }
  console.log(`  works rule off: two versions in ${bothWorksWhenOff} of 150 nights; overrides separated them in ${separated} of 150`);
  expect(bothWorksWhenOff > 0, "with the works rule off, two versions of one work can play");
  expect(separated > 0, "work and recording overrides separate songs");

  // "Same recording as…": a recording override joins two songs that have no ISRC in common.
  const joined = lib.map((song) => (song.id === ids[0] ? { ...song, title: "Something else", recording: `isrc:${waltz[1].isrc.toUpperCase()}` } : song));
  for (let seed = 1; seed <= 50; seed++) {
    expect(count(generatePlaylist(joined, { ...base, seed, noRepeatWorks: false }), [ids[0], ids[1], ids[2]]) <= 1,
      "songs joined as the same recording never play together");
  }

  // A special block from dances whose only songs are versions of one work (also a Waltz in this library)
  // plays at most one of them; it is shorter, with a warning (NOTES.md v0.4, Q7: no song reuse).
  const ev = { name: "Moon River x2", source: "dances", dances: ["Moon River dance"], count: 2, keepApart: true, placement: { mode: "at", at: 0.5 } };
  const onlyVersions = [...lib, ...["Moon River", "Moon River (Remastered)"].map((title, i) => ({
    id: `mr${i}`, title, lengthSec: 200, dances: ["Moon River dance"], tags: [], isrc: `MR${i}`,
  }))];
  const result3 = generatePlaylist(onlyVersions, { ...base, seed: 1, specialBlocks: [ev] });
  expect(result3.playlist.filter((row) => row.source === ev.name).length <= 1, "the block plays at most one version");
  expect(result3.warnings.some((warning) => /shrank|could not play/.test(warning.message)), `with a warning: ${result3.warnings.map((warning) => warning.message)}`);
}

/* ---- special blocks with chosen songs (the agreed spec, NOTES.md v0.2.4, v0.4) ---- */
{
  console.log("=== Special blocks with chosen songs");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const lib = buildSongs(10).map((song) => ({ ...song, isrc: `I${song.id}` }));
  const one = (d, k = 0) => lib.filter((song) => song.dances.length === 1 && song.dances[0] === d)[k];
  // Two Waltzes in a row, a Cha-cha, a Polka (an excursion dance), and a very long Tango.
  const longTango = { ...one("Tango"), id: "longtango", lengthSec: 400, isrc: "LONG" };
  const lib2 = [...lib, longTango];
  const chosen = [one("Waltz", 0), one("Waltz", 1), one("Cha-cha"), one("Polka"), longTango].map((song) => song.id);
  // A duplicate (same recording, another ID) of the first chosen song, and another version of the second.
  const dup = { ...one("Waltz", 0), id: "dupwaltz", title: "Dup" };
  const version = { ...one("Waltz", 1), id: "verwaltz", isrc: "VER", title: `${one("Waltz", 1).title} (Live)` };
  const lib3 = [...lib2, dup, version];
  const blockOf = (result) => result.playlist.filter((row) => row.blockId === 0);

  let versionPlayed = 0;
  let relaxed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const settings = { ...base, seed, maxSongSec: 300,
      specialBlocks: [{ source: "songs", songs: chosen, placement: { mode: "at", at: 0.4 } }, ...base.specialBlocks] };
    const result = generatePlaylist(lib3, settings);
    const b = blockOf(result);
    expect(b.map((row) => row.song.id).join() === chosen.join(), `plays exactly the chosen songs, in order: ${b.map((x) => x.song.id)}`);
    expect(b.every((row, i) => i === 0 || row.index === b[i - 1].index + 1), "together (nothing may interrupt by default)");
    expect(b.every((row) => row.kind === "block" && row.chosen), "outside the category turns");
    expect(b.at(-1).song.lengthSec === 400, "a chosen song may break the length limits");
    const ids = result.playlist.map((row) => row.song.id);
    expect(ids.filter((id) => chosen.includes(id)).length === chosen.length, "chosen songs never play elsewhere");
    expect(!ids.includes("dupwaltz"), "a duplicate of a chosen song never plays");
    if (ids.includes("verwaltz")) versionPlayed++;
    // The first chosen song keeps the normal gap, unless the block waited as long as it may.
    const first = b[0];
    const before = result.playlist.slice(Math.max(0, first.index - base.minToRepeat), first.index);
    const waited = result.playlist.filter((row) => row.index < first.index && row.startSec >= 0.4 * result.targetSec).length;
    expect(!before.some((row) => row.dance === first.dance) || waited > base.minToRepeat, "the block waits for its first song's gap");
    expect(checkRules(result, settings).length === 0 || result.warnings.length > 0, `no silently broken rules: ${JSON.stringify(checkRules(result, settings)[0])}`);
    if (result.warnings.some((warning) => /Rule relaxed/.test(warning.message))) relaxed++;

    // Interruptions keep the order; a kept-apart chosen block is never directly after the line dance or Paso Doble.
    const often = { ...base, seed, excursions: { ...base.excursions, intervalMinutes: 4 },
      specialBlocks: [{ source: "songs", songs: chosen, keepApart: true, placement: { mode: "at", at: 0.5 }, interruptBy: { excursions: true } }, ...base.specialBlocks] };
    const result2 = generatePlaylist(lib2, often);
    const b2 = blockOf(result2);
    expect(b2.map((row) => row.song.id).join() === chosen.join(), "interrupted, the block keeps its order");
    const prev = result2.playlist[b2[0].index - 1];
    expect(prev.kind !== "event", "a kept-apart chosen block is never directly after the line dance or Paso Doble");
    expect(checkRules(result2, often).length === 0 || result2.warnings.length > 0, `interrupted chosen block: no silently broken rules: ${JSON.stringify(checkRules(result2, often)[0])}`);
    if (result2.warnings.some((warning) => /Rule relaxed/.test(warning.message))) relaxed++;
  }
  console.log(`  another version of a chosen song played elsewhere in ${versionPlayed} of 100 nights (allowed); a rule relaxed in ${relaxed} of 200 nights`);
  expect(relaxed <= 10, `chosen-songs blocks should rarely need a rule relaxed: ${relaxed} of 200`);

  // A chosen song that is not in the library is left out, with a warning.
  const s4 = { ...base, seed: 1, specialBlocks: [{ source: "songs", songs: [chosen[0], "notinthelibrary"], placement: { mode: "at", at: 0.4 } }] };
  const result4 = generatePlaylist(lib, s4);
  expect(blockOf(result4).length === 1 && result4.warnings.some((warning) => /not in the library/.test(warning.message)), "a missing chosen song is left out, with a warning");
  expect(validateSettings(lib, s4).warnings.some((warning) => /not in the library/.test(warning)), "and warned about before generating");
  expect(validateSettings(lib, { ...base, specialBlocks: [{ source: "songs", songs: [] }] }).errors.length > 0, "a chosen-songs block with no songs is an error");
}

/* ---- must-play songs (the agreed spec, NOTES.md v0.2.5) ---- */
{
  console.log("=== Must-play songs");
  const expect = (cond, msg) => {
    if (!cond) {
      console.log(`  BUG: ${msg}`);
      totalBugs++;
    }
  };
  const base = SCENARIOS.find((scenario) => scenario.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const lib = buildSongs(10).map((song) => ({ ...song, isrc: `I${song.id}` }));
  const one = (d, k = 0) => lib.filter((song) => song.dances.length === 1 && song.dances[0] === d)[k];
  // A Waltz and a Rumba (categories), a Bachata (excursion), a very long Foxtrot, and a Paso Doble
  // (only a special block's dance, so it can never be a must-play).
  const longFox = { ...one("Foxtrot"), id: "longfox", lengthSec: 420, isrc: "LONGFOX" };
  const dup = { ...one("Waltz"), id: "dupwaltz" }; // the same recording as the must-play Waltz
  const lib2 = [...lib, longFox, dup];
  const must = [one("Waltz"), one("Rumba"), one("Bachata"), longFox].map((song) => song.id);
  let relaxed = 0;
  let early = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const settings = { ...base, seed, maxSongSec: 300, mustPlay: must };
    const result = generatePlaylist(lib2, settings);
    const rows = result.playlist.filter((row) => row.mustPlay);
    expect(rows.length === must.length && new Set(rows.map((x) => x.song.id)).size === must.length, `every must-play song plays once: ${rows.length}`);
    expect(result.playlist.filter((row) => must.includes(row.song.id)).length === must.length, "and nowhere else");
    expect(!result.playlist.some((row) => row.song.id === "dupwaltz"), "a duplicate of a must-play song never plays");
    expect(rows.every((row) => row.index >= base.opening.earlyCount), "never in the opening");
    expect(result.playlist.some((row) => row.song.id === "longfox"), "a must-play song may break the length limits");
    const bachata = rows.find((row) => row.song.dances.includes("Bachata"));
    expect(bachata && bachata.kind === "excursion", "an excursion dance plays outside the turns");
    // Spread evenly: in random order, but the i-th must-play song (in time) is not before (i+1)/(k+1).
    rows.forEach((row, i) => { if (row.startSec < ((i + 1) / (must.length + 1)) * result.targetSec - 1) early++; });
    if (result.warnings.some((warning) => /Rule relaxed to play must-play/.test(warning.message))) relaxed++;
    expect(checkRules(result, settings).length === 0 || result.warnings.length > 0, `no silently broken rules: ${JSON.stringify(checkRules(result, settings)[0])}`);
  }
  console.log(`  a must-play song needed a rule relaxed in ${relaxed} of 100 nights`);
  expect(early === 0, `must-play songs are spread evenly (none before its point): ${early} early`);
  expect(relaxed <= 15, `must-play songs should rarely need a rule relaxed: ${relaxed} of 100`);

  // A dance the settings never let play: warned about, never played.
  const paso = one("Paso Doble").id;
  const s2 = { ...base, seed: 1, specialBlocks: [], mustPlay: [paso] };
  expect(validateSettings(lib, s2).warnings.some((warning) => /will never play/.test(warning)), "a must-play song with an unused dance is warned about");
  expect(!generatePlaylist(lib, s2).playlist.some((row) => row.song.id === paso), "and never plays");
  // In a chosen-songs block too: plays once, in the block.
  const s3 = { ...base, seed: 2, mustPlay: [must[0]], specialBlocks: [{ source: "songs", songs: [must[0]], placement: { mode: "at", at: 0.5 } }, ...base.specialBlocks] };
  const result3 = generatePlaylist(lib, s3);
  const plays = result3.playlist.filter((row) => row.song.id === must[0]);
  expect(plays.length === 1 && plays[0].chosen, "a must-play song in a chosen-songs block plays once, in the block");
}

for (const scenario of SCENARIOS) {
  const songs = scenario.songs ?? buildSongs(scenario.perDance);
  // Timing bounds use only the songs that may play (inside any song length limits).
  const playable = songs.filter((s) => withinLengthLimits(s, scenario.settings));
  const longest = Math.max(...playable.map((s) => s.lengthSec));
  const shortest = Math.min(...playable.map((s) => s.lengthSec));
  console.log(`\n=== ${scenario.name}  (${songs.length} songs, ${SEEDS} seeds)`);

  const { errors, warnings } = validateSettings(songs, scenario.settings);
  for (const e of errors) console.log(`  VALIDATION ERROR: ${e}`);
  for (const warning of warnings) console.log(`  validation warning: ${warning}`);
  if (errors.length) {
    totalBugs++;
    continue;
  }

  const bugs = [];
  const warningCounts = {};
  const relaxedViolations = {};
  let clean = 0;
  const themeFracs = [];
  const songCounts = [];
  let maxOver = -Infinity;
  let minOver = Infinity;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const settings = { ...scenario.settings, seed };
    let res;
    try {
      res = generatePlaylist(songs, settings);
    } catch (err) {
      bugs.push(`seed ${seed}: threw ${err.stack}`);
      continue;
    }

    const again = generatePlaylist(songs, settings);
    if (JSON.stringify(again.playlist) !== JSON.stringify(res.playlist)) bugs.push(`seed ${seed}: not reproducible`);

    const violations = checkRules(res, settings);
    if (violations.length && !res.warnings.length) {
      for (const violation of violations) bugs.push(`seed ${seed}: silent violation [${violation.rule}] at #${violation.index}: ${violation.message}`);
    } else if (violations.length) {
      for (const violation of violations) relaxedViolations[violation.rule] = (relaxedViolations[violation.rule] || 0) + 1;
    }
    if (!res.warnings.length && !violations.length) clean++;

    for (const warning of res.warnings) {
      const key = warning.message.replace(/to place a .* song\./, "").replace(/"[^"]*"/g, '"…"');
      warningCounts[key] = (warningCounts[key] || 0) + 1;
    }

    const ids = res.playlist.map((row) => row.song.id);
    const reuseWarned = res.warnings.some((warning) => /reuse/.test(warning.message));
    if (new Set(ids).size !== ids.length && !reuseWarned) bugs.push(`seed ${seed}: a song was used twice with no warning`);

    // README rule 8: end no later than (longest - shortest) past the target; and since songs are
    // added while the shortest would still fit, no earlier than one shortest song before it.
    if (res.overtimeSec > longest - shortest) bugs.push(`seed ${seed}: overtime ${formatTime(res.overtimeSec)} exceeds longest - shortest song`);
    const endedEarly = res.warnings.some((warning) => /ended early/.test(warning.message));
    if (!endedEarly && res.overtimeSec <= -shortest) bugs.push(`seed ${seed}: night ended ${formatTime(-res.overtimeSec)} short of target`);

    maxOver = Math.max(maxOver, res.overtimeSec);
    minOver = Math.min(minOver, res.overtimeSec);
    songCounts.push(res.stats.songCount);
    if (scenario.settings.theme) themeFracs.push(res.stats.themeFraction);
  }

  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  console.log(`  clean runs (no warnings, no violations): ${clean}/${SEEDS}`);
  console.log(`  songs per night: ${Math.min(...songCounts)}-${Math.max(...songCounts)} (avg ${avg(songCounts).toFixed(1)})`);
  console.log(`  end vs target: ${formatTime(minOver)} to ${formatTime(maxOver)}`);
  if (themeFracs.length) {
    const { fractionMin, fractionMax } = scenario.settings.theme;
    const inRange = themeFracs.filter((f) => f >= fractionMin - 1e-9 && f <= fractionMax + 1e-9).length;
    console.log(
      `  theme share: ${pct(Math.min(...themeFracs))}-${pct(Math.max(...themeFracs))} (avg ${pct(avg(themeFracs))}); ` +
        `in target ${pct(fractionMin)}-${pct(fractionMax)}: ${inRange}/${themeFracs.length}`
    );
  }
  for (const [k, n] of Object.entries(warningCounts)) console.log(`  warning x${n}: ${k}`);
  for (const [k, n] of Object.entries(relaxedViolations)) console.log(`  rule broken after a warning x${n}: ${k}`);

  if (bugs.length) {
    console.log(`  BUGS: ${bugs.length}`);
    for (const b of bugs.slice(0, SHOW_EXAMPLES)) console.log(`    ${b}`);
    totalBugs += bugs.length;
  }
}

console.log(`\n${totalBugs ? `FAILED: ${totalBugs} bug(s) found.` : "PASSED: no bugs found."}`);
process.exitCode = totalBugs ? 1 : 0;
