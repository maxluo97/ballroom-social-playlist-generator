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
      ...APP_DEFAULTS, seed, fixedEvents: [],
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
    const tagSettings = { ...APP_DEFAULTS, seed, fixedEvents: [], opening: { ...APP_DEFAULTS.opening, earlyCount: 3 }, theme: { name: "Hollywood", tags: ["Hollywood"] } };
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
