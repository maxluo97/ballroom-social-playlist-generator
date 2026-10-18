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

import { generatePlaylist, checkRules, validateSettings, listDances, formatTime, withinLengthLimits, themeMinGapFor, themeMinGapApplies } from "../js/generator.js";
import { buildSongs, SCENARIOS } from "./sample-data.js";
import { buildSampleLibrary } from "../tools/sample-library.js";
import { APP_DEFAULTS } from "./defaults.js";
import { parseSettingsFile, settingsFileText } from "../js/settings.js";

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
  const waltzSources = new Set(res.playlist.filter((it) => it.dance === "Waltz").flatMap((it) => it.song.sourceDances));
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
  const v = validateSettings(buildSampleLibrary(), APP_DEFAULTS);
  console.log(`  default settings with the sample library: ${v.errors.length} errors, ${v.warnings.length} warnings`);
  v.warnings.forEach((w) => console.log(`    warning: ${w}`));
  expect(v.errors.length === 0, `default settings have errors: ${v.errors.join("; ")}`);
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
    const r = generatePlaylist(lib, settings);
    return { r, settings, first: r.playlist.slice(0, openers).map((it) => it.dance) };
  };
  let tagExcursionOpeners = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const one = night(["Foxtrot"], 3, seed);
    expect(one.first.join() === "Foxtrot,Foxtrot,Foxtrot", `one theme dance opens every opener: ${one.first}`);
    expect(checkRules(one.r, one.settings).length === 0, `openers do not count as broken rules: ${JSON.stringify(checkRules(one.r, one.settings)[0])}`);
    expect(one.r.playlist[3].dance !== "Foxtrot", "after the openers, spacing applies again");

    const two = night(["Foxtrot", "Quickstep"], 4, seed);
    expect(["Foxtrot,Quickstep,Foxtrot,Quickstep", "Quickstep,Foxtrot,Quickstep,Foxtrot"].includes(two.first.join()),
      `two theme dances, 4 openers: ABAB or BABA: ${two.first}`);
    expect(two.first.includes("Quickstep"), "a theme dance on the opening blacklist may still open");

    const three = night(["Foxtrot", "Quickstep", "Waltz"], 2, seed);
    expect(new Set(three.first).size === 2, `more theme dances than openers: two different ones open: ${three.first}`);
    expect(checkRules(three.r, three.settings).length === 0, `3 dances, 2 openers: no broken rules: ${JSON.stringify(checkRules(three.r, three.settings)[0])}`);
    const five = night(["Foxtrot", "Quickstep", "Waltz"], 7, seed).first;
    const counts = Object.values(five.reduce((m, d) => ({ ...m, [d]: (m[d] || 0) + 1 }), {}));
    expect(five.every((d, i) => i === 0 || d !== five[i - 1]), `no theme dance opens twice in a row: ${five}`);
    expect(Math.max(...counts) - Math.min(...counts) <= 1 && counts.length === 3, `theme dances open equally often: ${five}`);

    // Bachata is only an excursion: a theme dance there gets a warning, and it does not open.
    const exc = night(["Mambo / Salsa", "Bachata"], 4, seed);
    expect(exc.first.join() === "Mambo / Salsa,Mambo / Salsa,Mambo / Salsa,Mambo / Salsa", `an excursion theme dance does not open: ${exc.first}`);
    if (seed === 1) {
      expect(validateSettings(lib, exc.settings).warnings.some((w) => w.includes('"Bachata" is still an excursion')),
        "a theme dance left as an excursion is warned about");
    }

    // A tag-only theme: excursion songs with the tag may open, without using up their excursion counts.
    const tagSettings = { ...APP_DEFAULTS, seed, specialBlocks: [], opening: { ...APP_DEFAULTS.opening, earlyCount: 3 }, theme: { name: "Hollywood", tags: ["Hollywood"] } };
    const tag = generatePlaylist(lib, tagSettings);
    const openers = tag.playlist.slice(0, 3);
    expect(openers.every((it) => it.isTheme), `tag-theme openers are theme songs: ${openers.map((it) => it.dance)}`);
    tagExcursionOpeners += openers.filter((it) => it.kind === "excursion").length;
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
  const base = SCENARIOS.find((sc) => sc.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const noHustle = { intervalMinutes: 25, jitterMinutes: 0, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } };
  const opening = base.opening.earlyCount;
  /** Gaps between songs of a dance, leaving out the openers (which ignore the gaps). */
  const gaps = (pl, dance) => {
    const at = pl.filter((it) => it.dance === dance && it.kind !== "final" && it.index >= opening).map((it) => it.index);
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
  expect(capped.some((w) => w.includes("remove \"Rumba\" from its category") && w.includes("33%")),
    `a capped theme share suggests taking the theme dance out of its category: ${capped.join(" | ")}`);

  let lowered = 0;
  let hiddenSongs = 0;
  let tagSongs = 0;
  let waltzThemeSongs = 0;
  const firstExcursion = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    // A single standalone dance: the hidden theme category, with the theme minimum gap (2).
    const hn = withTheme({ dances: ["Hustle"] }, { excursions: noHustle, seed });
    const r1 = generatePlaylist(songs, hn);
    const hustles = r1.playlist.filter((it) => it.dance === "Hustle");
    hiddenSongs += hustles.filter((it) => it.kind === "theme").length;
    expect(hustles.every((it) => it.kind === "theme" && it.isTheme), "standalone dance songs are hidden-category theme songs");
    const g1 = gaps(r1.playlist, "Hustle");
    expect(g1.every((g) => g >= 2), `a single standalone dance keeps the theme minimum gap: ${g1}`);
    lowered += g1.filter((g) => g < 4).length;
    expect(checkRules(r1, hn).length === 0, `Hustle night: no broken rules: ${JSON.stringify(checkRules(r1, hn)[0])}`);

    // Several standalone dances + one in a category: the hidden category's shuffle-bag and gap n = 2.
    const cn = withTheme({ dances: ["Foxtrot", "Hustle", "Night Club Two Step"], fractionMin: 0.25, fractionMax: 0.4 },
      { excursions: { ...noHustle, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } }, seed });
    const r2 = generatePlaylist(songs, cn);
    expect(checkRules(r2, cn).length === 0, `club night: no broken rules: ${JSON.stringify(checkRules(r2, cn)[0])}`);
    const openers = r2.playlist.slice(0, opening);
    expect(openers.every((it) => ["Foxtrot", "Hustle", "Night Club Two Step"].includes(it.dance)), "standalone dances open too");
    // Hidden songs do not take category turns: removing them leaves runs within Max in a row.
    const regular = r2.playlist.filter((it) => it.kind === "regular");
    let run = 0;
    let prev = null;
    let longest = 0;
    for (const it of regular.filter((x) => x.index >= opening)) {
      run = it.category === prev ? run + 1 : 1;
      prev = it.category;
      longest = Math.max(longest, run);
    }
    expect(longest <= cn.maxInARow, `hidden theme songs leave the category turns alone: run of ${longest}`);

    // A mixed theme: tags and dances counted independently.
    const mx = withTheme({ dances: ["Waltz"], tags: ["Hollywood"], fractionMin: 0.3, fractionMax: 0.45 }, { seed });
    const r3 = generatePlaylist(songs, mx);
    tagSongs += r3.playlist.filter((it) => it.isTheme && it.dance !== "Waltz").length;
    waltzThemeSongs += r3.playlist.filter((it) => it.isTheme && it.dance === "Waltz" && !(it.song.tags || []).includes("Hollywood")).length;

    // Excursions: the first one also gets the random variation.
    const ex = { ...base, seed, excursions: { ...base.excursions, jitterMinutes: 3 } };
    const first = generatePlaylist(songs, ex).playlist.find((it) => it.kind === "excursion");
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
  const turnsWarning = (s) => validateSettings(sample, s).warnings.some((w) => /categories take turns equally/.test(w));
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
  const base = SCENARIOS.find((sc) => sc.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  // The tested blocks come first (block IDs 0, 1, …), then the base's line dance and Paso Doble.
  const night = (blocks, extra = {}) => ({ ...base, ...extra, specialBlocks: [...blocks, ...base.specialBlocks] });
  const blockSongs = (r, id = 0) => r.playlist.filter((it) => it.blockId === id);
  const together = (items) => items.every((it, i) => i === 0 || it.index === items[i - 1].index + 1);
  const ruleBreaks = (r, settings) => checkRules(r, settings);

  let interruptedContinue = 0;
  let endedEarly = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // A turn-taking block: 4 tagged songs in a row, in the normal category turns, from 40%.
    const s1 = night([{ tag: "Hollywood", count: 4, placement: { mode: "at", at: 0.4 } }], { seed });
    const r1 = generatePlaylist(songs, s1);
    const b1 = blockSongs(r1);
    expect(b1.length === 4 && together(b1), `a turn-taking block plays its 4 songs together: ${b1.map((x) => x.index)}`);
    expect(b1.every((it) => it.kind === "regular" && it.song.tags.includes("Hollywood")), "its songs are regular songs with the tag");
    expect(b1[0].startSec >= 0.4 * r1.targetSec, "it starts at or after its point");
    expect(ruleBreaks(r1, s1).length === 0, `turn-taking block: no broken rules: ${JSON.stringify(ruleBreaks(r1, s1)[0])}`);

    // A kept-apart block at the same point as the line dance (50%): never back to back with it.
    const s2 = night([{ tag: "Hollywood", count: 3, inTurns: false, keepApart: true, placement: { mode: "at", at: 0.5 } }], { seed });
    const r2 = generatePlaylist(songs, s2);
    const b2 = blockSongs(r2);
    expect(b2.length === 3 && together(b2) && b2.every((it) => it.kind === "block"), "a kept-apart block plays together, outside the turns");
    const before = r2.playlist[b2[0].index - 1];
    const after = r2.playlist[b2.at(-1).index + 1];
    expect(before.kind !== "event" && (!after || after.kind !== "event"), "a kept-apart block is never back to back with the line dance or Paso Doble");
    expect(ruleBreaks(r2, s2).length === 0, `kept-apart block: no broken rules: ${JSON.stringify(ruleBreaks(r2, s2)[0])}`);

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
    const r5 = generatePlaylist(songs, s5);
    const b5 = blockSongs(r5);
    expect(b5.length === 5, `"continue": the block still plays all its songs: ${b5.length}`);
    if (!together(b5)) {
      interruptedContinue++;
      const gaps = r5.playlist.slice(b5[0].index, b5.at(-1).index + 1).filter((it) => it.blockId !== 0);
      expect(gaps.every((it) => it.kind === "excursion"), `only an allowed interruption comes between block songs: ${gaps.map((x) => x.kind)}`);
    }
    const s6 = night([{ tag: "Hollywood", count: 5, placement: { mode: "at", at: 0.3 }, interruptBy: { excursions: true }, afterInterruption: "end" }], { ...often, seed });
    const r6 = generatePlaylist(songs, s6);
    const b6 = blockSongs(r6);
    if (b6.length < 5) endedEarly++;
    expect(together(b6) && !r6.warnings.some((w) => /shrank/.test(w.message)), '"end": the block just stops at an interruption, without a warning');

    // Several blocks; a block that comes due during another one waits for it.
    const s7 = night([
      { tag: "Hollywood", count: 3, placement: { mode: "at", at: 0.3 } },
      { tag: "Hollywood", count: 3, inTurns: false, keepApart: true, placement: { mode: "at", at: 0.3 } },
    ], { seed });
    const r7 = generatePlaylist(songs, s7);
    const [x, y] = [blockSongs(r7, 0), blockSongs(r7, 1)];
    expect(x.length === 3 && y.length === 3, "several blocks each play");
    expect(x.at(-1).index < y[0].index || y.at(-1).index < x[0].index, "blocks do not overlap");
    expect(ruleBreaks(r7, s7).length === 0, `two blocks: no broken rules: ${JSON.stringify(ruleBreaks(r7, s7)[0])}`);

    // Theme share: block songs count only if they match the theme.
    const s8 = night([{ tag: "Hollywood", count: 4, placement: { mode: "at", at: 0.4 } }],
      { seed, theme: { name: "Waltz night", dances: ["Waltz"], fractionMin: 0.15, fractionMax: 0.2 } });
    const b8 = blockSongs(generatePlaylist(songs, s8));
    expect(b8.every((it) => it.isTheme === (it.dance === "Waltz")), "block songs are theme songs only if they match the theme");
  }
  console.log(`  "continue": ${interruptedContinue} of 100 blocks were interrupted and continued; "end": ${endedEarly} of 100 ended early`);
  expect(interruptedContinue > 0 && endedEarly > 0, "with excursions every 4 minutes, some blocks should be interrupted");

  // Not enough tagged songs: a warning before generating, and the block shrinks with a warning.
  const pickDance = (d) => songs.find((sg) => sg.dances.length === 1 && sg.dances[0] === d);
  const few = [...songs.map((sg) => ({ ...sg, tags: [] })), ...["Foxtrot", "Cha-cha"].map((d, i) => ({ ...pickDance(d), id: `rare${i}`, tags: ["Rare"] }))];
  const s9 = night([{ tag: "Rare", count: 4, placement: { mode: "at", at: 0.4 } }], { seed: 1 });
  expect(validateSettings(few, s9).warnings.some((w) => w.includes('"Rare block" needs 4 songs')), "too few tagged songs is warned about");
  const r9 = generatePlaylist(few, s9);
  expect(blockSongs(r9).length < 4 && r9.warnings.some((w) => /shrank to d of 4|could not play/.test(w.message)),
    `the block shrinks, with a warning: ${blockSongs(r9).length} songs; ${r9.warnings.map((w) => w.message)}`);
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
  const base = SCENARIOS.find((sc) => sc.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  // 3 of the Waltz songs are the same work,
  // and 2 of them (different IDs) the same recording.
  const lib = buildSongs(10).map((sg) => ({ ...sg, isrc: `ISRC${sg.id}` }));
  const waltz = lib.filter((sg) => sg.dances.length === 1 && sg.dances[0] === "Waltz").slice(0, 3);
  waltz[0].title = "Moon River";
  waltz[1].title = "Moon River - 2011 Remaster";
  waltz[2].title = "Moon River (Live)";
  waltz[2].isrc = waltz[1].isrc; // the same recording as waltz[1], under another ID
  const ids = waltz.map((sg) => sg.id);
  const count = (r, list) => r.playlist.filter((it) => list.includes(it.song.id)).length;

  let bothWorksWhenOff = 0;
  let separated = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const on = { ...base, seed };
    const r1 = generatePlaylist(lib, on);
    expect(count(r1, ids) <= 1, `no two versions of one work in a night: ${count(r1, ids)}`);
    expect(!checkRules(r1, on).some((v) => v.rule === "sameWork" || v.rule === "duplicateRecording"), "no works/duplicates rule breaks");

    const off = { ...base, seed, noRepeatWorks: false };
    const r2 = generatePlaylist(lib, off);
    expect(count(r2, [ids[1], ids[2]]) <= 1, "duplicates never play together, even with the works rule off");
    if (count(r2, ids) === 2) bothWorksWhenOff++;

    // Overrides: a different work name, and "Not a duplicate", separate the songs again.
    const split = lib.map((sg) => (sg.id === ids[2] ? { ...sg, work: "Another song", recording: `id:${sg.id}` } : sg.id === ids[1] ? { ...sg, work: "Third song" } : sg));
    if (count(generatePlaylist(split, on), ids) >= 2) separated++;
  }
  console.log(`  works rule off: two versions in ${bothWorksWhenOff} of 150 nights; overrides separated them in ${separated} of 150`);
  expect(bothWorksWhenOff > 0, "with the works rule off, two versions of one work can play");
  expect(separated > 0, "work and recording overrides separate songs");

  // "Same recording as…": a recording override joins two songs that have no ISRC in common.
  const joined = lib.map((sg) => (sg.id === ids[0] ? { ...sg, title: "Something else", recording: `isrc:${waltz[1].isrc.toUpperCase()}` } : sg));
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
  const r3 = generatePlaylist(onlyVersions, { ...base, seed: 1, specialBlocks: [ev] });
  expect(r3.playlist.filter((it) => it.source === ev.name).length <= 1, "the block plays at most one version");
  expect(r3.warnings.some((w) => /shrank|could not play/.test(w.message)), `with a warning: ${r3.warnings.map((w) => w.message)}`);
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
  const base = SCENARIOS.find((sc) => sc.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const lib = buildSongs(10).map((sg) => ({ ...sg, isrc: `I${sg.id}` }));
  const one = (d, k = 0) => lib.filter((sg) => sg.dances.length === 1 && sg.dances[0] === d)[k];
  // Two Waltzes in a row, a Cha-cha, a Polka (an excursion dance), and a very long Tango.
  const longTango = { ...one("Tango"), id: "longtango", lengthSec: 400, isrc: "LONG" };
  const lib2 = [...lib, longTango];
  const chosen = [one("Waltz", 0), one("Waltz", 1), one("Cha-cha"), one("Polka"), longTango].map((sg) => sg.id);
  // A duplicate (same recording, another ID) of the first chosen song, and another version of the second.
  const dup = { ...one("Waltz", 0), id: "dupwaltz", title: "Dup" };
  const version = { ...one("Waltz", 1), id: "verwaltz", isrc: "VER", title: `${one("Waltz", 1).title} (Live)` };
  const lib3 = [...lib2, dup, version];
  const blockOf = (r) => r.playlist.filter((it) => it.blockId === 0);

  let versionPlayed = 0;
  let relaxed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const settings = { ...base, seed, maxSongSec: 300,
      specialBlocks: [{ source: "songs", songs: chosen, placement: { mode: "at", at: 0.4 } }, ...base.specialBlocks] };
    const r = generatePlaylist(lib3, settings);
    const b = blockOf(r);
    expect(b.map((it) => it.song.id).join() === chosen.join(), `plays exactly the chosen songs, in order: ${b.map((x) => x.song.id)}`);
    expect(b.every((it, i) => i === 0 || it.index === b[i - 1].index + 1), "together (nothing may interrupt by default)");
    expect(b.every((it) => it.kind === "block" && it.chosen), "outside the category turns");
    expect(b.at(-1).song.lengthSec === 400, "a chosen song may break the length limits");
    const ids = r.playlist.map((it) => it.song.id);
    expect(ids.filter((id) => chosen.includes(id)).length === chosen.length, "chosen songs never play elsewhere");
    expect(!ids.includes("dupwaltz"), "a duplicate of a chosen song never plays");
    if (ids.includes("verwaltz")) versionPlayed++;
    // The first chosen song keeps the normal gap, unless the block waited as long as it may.
    const first = b[0];
    const before = r.playlist.slice(Math.max(0, first.index - base.minToRepeat), first.index);
    const waited = r.playlist.filter((it) => it.index < first.index && it.startSec >= 0.4 * r.targetSec).length;
    expect(!before.some((it) => it.dance === first.dance) || waited > base.minToRepeat, "the block waits for its first song's gap");
    expect(checkRules(r, settings).length === 0 || r.warnings.length > 0, `no silently broken rules: ${JSON.stringify(checkRules(r, settings)[0])}`);
    if (r.warnings.some((w) => /Rule relaxed/.test(w.message))) relaxed++;

    // Interruptions keep the order; a kept-apart chosen block is never directly after the line dance or Paso Doble.
    const often = { ...base, seed, excursions: { ...base.excursions, intervalMinutes: 4 },
      specialBlocks: [{ source: "songs", songs: chosen, keepApart: true, placement: { mode: "at", at: 0.5 }, interruptBy: { excursions: true } }, ...base.specialBlocks] };
    const r2 = generatePlaylist(lib2, often);
    const b2 = blockOf(r2);
    expect(b2.map((it) => it.song.id).join() === chosen.join(), "interrupted, the block keeps its order");
    const prev = r2.playlist[b2[0].index - 1];
    expect(prev.kind !== "event", "a kept-apart chosen block is never directly after the line dance or Paso Doble");
    expect(checkRules(r2, often).length === 0 || r2.warnings.length > 0, `interrupted chosen block: no silently broken rules: ${JSON.stringify(checkRules(r2, often)[0])}`);
    if (r2.warnings.some((w) => /Rule relaxed/.test(w.message))) relaxed++;
  }
  console.log(`  another version of a chosen song played elsewhere in ${versionPlayed} of 100 nights (allowed); a rule relaxed in ${relaxed} of 200 nights`);
  expect(relaxed <= 10, `chosen-songs blocks should rarely need a rule relaxed: ${relaxed} of 200`);

  // A chosen song that is not in the library is left out, with a warning.
  const s4 = { ...base, seed: 1, specialBlocks: [{ source: "songs", songs: [chosen[0], "notinthelibrary"], placement: { mode: "at", at: 0.4 } }] };
  const r4 = generatePlaylist(lib, s4);
  expect(blockOf(r4).length === 1 && r4.warnings.some((w) => /not in the library/.test(w.message)), "a missing chosen song is left out, with a warning");
  expect(validateSettings(lib, s4).warnings.some((w) => /not in the library/.test(w)), "and warned about before generating");
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
  const base = SCENARIOS.find((sc) => sc.name.includes("N=2 (Ballroom/Latin), 3 h, no theme")).settings;
  const lib = buildSongs(10).map((sg) => ({ ...sg, isrc: `I${sg.id}` }));
  const one = (d, k = 0) => lib.filter((sg) => sg.dances.length === 1 && sg.dances[0] === d)[k];
  // A Waltz and a Rumba (categories), a Bachata (excursion), a very long Foxtrot, and a Paso Doble
  // (only a special block's dance, so it can never be a must-play).
  const longFox = { ...one("Foxtrot"), id: "longfox", lengthSec: 420, isrc: "LONGFOX" };
  const dup = { ...one("Waltz"), id: "dupwaltz" }; // the same recording as the must-play Waltz
  const lib2 = [...lib, longFox, dup];
  const must = [one("Waltz"), one("Rumba"), one("Bachata"), longFox].map((sg) => sg.id);
  let relaxed = 0;
  let early = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const settings = { ...base, seed, maxSongSec: 300, mustPlay: must };
    const r = generatePlaylist(lib2, settings);
    const rows = r.playlist.filter((it) => it.mustPlay);
    expect(rows.length === must.length && new Set(rows.map((x) => x.song.id)).size === must.length, `every must-play song plays once: ${rows.length}`);
    expect(r.playlist.filter((it) => must.includes(it.song.id)).length === must.length, "and nowhere else");
    expect(!r.playlist.some((it) => it.song.id === "dupwaltz"), "a duplicate of a must-play song never plays");
    expect(rows.every((it) => it.index >= base.opening.earlyCount), "never in the opening");
    expect(r.playlist.some((it) => it.song.id === "longfox"), "a must-play song may break the length limits");
    const bachata = rows.find((it) => it.song.dances.includes("Bachata"));
    expect(bachata && bachata.kind === "excursion", "an excursion dance plays outside the turns");
    // Spread evenly: in random order, but the i-th must-play song (in time) is not before (i+1)/(k+1).
    rows.forEach((it, i) => { if (it.startSec < ((i + 1) / (must.length + 1)) * r.targetSec - 1) early++; });
    if (r.warnings.some((w) => /Rule relaxed to play must-play/.test(w.message))) relaxed++;
    expect(checkRules(r, settings).length === 0 || r.warnings.length > 0, `no silently broken rules: ${JSON.stringify(checkRules(r, settings)[0])}`);
  }
  console.log(`  a must-play song needed a rule relaxed in ${relaxed} of 100 nights`);
  expect(early === 0, `must-play songs are spread evenly (none before its point): ${early} early`);
  expect(relaxed <= 15, `must-play songs should rarely need a rule relaxed: ${relaxed} of 100`);

  // A dance the settings never let play: warned about, never played.
  const paso = one("Paso Doble").id;
  const s2 = { ...base, seed: 1, specialBlocks: [], mustPlay: [paso] };
  expect(validateSettings(lib, s2).warnings.some((w) => /will never play/.test(w)), "a must-play song with an unused dance is warned about");
  expect(!generatePlaylist(lib, s2).playlist.some((it) => it.song.id === paso), "and never plays");
  // In a chosen-songs block too: plays once, in the block.
  const s3 = { ...base, seed: 2, mustPlay: [must[0]], specialBlocks: [{ source: "songs", songs: [must[0]], placement: { mode: "at", at: 0.5 } }, ...base.specialBlocks] };
  const r3 = generatePlaylist(lib, s3);
  const plays = r3.playlist.filter((it) => it.song.id === must[0]);
  expect(plays.length === 1 && plays[0].chosen, "a must-play song in a chosen-songs block plays once, in the block");
}

for (const sc of SCENARIOS) {
  const songs = sc.songs ?? buildSongs(sc.perDance);
  // Timing bounds use only the songs that may play (inside any song length limits).
  const playable = songs.filter((s) => withinLengthLimits(s, sc.settings));
  const longest = Math.max(...playable.map((s) => s.lengthSec));
  const shortest = Math.min(...playable.map((s) => s.lengthSec));
  console.log(`\n=== ${sc.name}  (${songs.length} songs, ${SEEDS} seeds)`);

  const { errors, warnings } = validateSettings(songs, sc.settings);
  for (const e of errors) console.log(`  VALIDATION ERROR: ${e}`);
  for (const w of warnings) console.log(`  validation warning: ${w}`);
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
    const settings = { ...sc.settings, seed };
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
      for (const v of violations) bugs.push(`seed ${seed}: silent violation [${v.rule}] at #${v.index}: ${v.message}`);
    } else if (violations.length) {
      for (const v of violations) relaxedViolations[v.rule] = (relaxedViolations[v.rule] || 0) + 1;
    }
    if (!res.warnings.length && !violations.length) clean++;

    for (const w of res.warnings) {
      const key = w.message.replace(/to place a .* song\./, "").replace(/"[^"]*"/g, '"…"');
      warningCounts[key] = (warningCounts[key] || 0) + 1;
    }

    const ids = res.playlist.map((it) => it.song.id);
    const reuseWarned = res.warnings.some((w) => /reuse/.test(w.message));
    if (new Set(ids).size !== ids.length && !reuseWarned) bugs.push(`seed ${seed}: a song was used twice with no warning`);

    // README rule 8: end no later than (longest - shortest) past the target; and since songs are
    // added while the shortest would still fit, no earlier than one shortest song before it.
    if (res.overtimeSec > longest - shortest) bugs.push(`seed ${seed}: overtime ${formatTime(res.overtimeSec)} exceeds longest - shortest song`);
    const endedEarly = res.warnings.some((w) => /ended early/.test(w.message));
    if (!endedEarly && res.overtimeSec <= -shortest) bugs.push(`seed ${seed}: night ended ${formatTime(-res.overtimeSec)} short of target`);

    maxOver = Math.max(maxOver, res.overtimeSec);
    minOver = Math.min(minOver, res.overtimeSec);
    songCounts.push(res.stats.songCount);
    if (sc.settings.theme) themeFracs.push(res.stats.themeFraction);
  }

  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  console.log(`  clean runs (no warnings, no violations): ${clean}/${SEEDS}`);
  console.log(`  songs per night: ${Math.min(...songCounts)}-${Math.max(...songCounts)} (avg ${avg(songCounts).toFixed(1)})`);
  console.log(`  end vs target: ${formatTime(minOver)} to ${formatTime(maxOver)}`);
  if (themeFracs.length) {
    const { fractionMin, fractionMax } = sc.settings.theme;
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
