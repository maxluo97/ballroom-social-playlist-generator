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

import { generatePlaylist, checkRules, validateSettings, listDances, formatTime, withinLengthLimits } from "../js/generator.js";
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
  const night = (dances, guaranteedOpeners, seed) => {
    const settings = {
      ...APP_DEFAULTS, seed, fixedEvents: [],
      opening: { earlyCount: 6, blacklist: ["Quickstep"] },
      theme: { name: "t", dances, fractionMin: 0.2, fractionMax: 0.25, guaranteedOpeners },
    };
    const r = generatePlaylist(lib, settings);
    return { r, settings, first: r.playlist.slice(0, guaranteedOpeners).map((it) => it.dance) };
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
    expect(!two.r.playlist.slice(4, 6).some((it) => it.dance === "Quickstep"), "the blacklist applies again after the openers");

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
    const tagSettings = { ...APP_DEFAULTS, seed, fixedEvents: [], theme: { name: "Hollywood", tags: ["Hollywood"], guaranteedOpeners: 3 } };
    const tag = generatePlaylist(lib, tagSettings);
    const openers = tag.playlist.slice(0, 3);
    expect(openers.every((it) => it.isTheme), `tag-theme openers are theme songs: ${openers.map((it) => it.dance)}`);
    tagExcursionOpeners += openers.filter((it) => it.kind === "excursion").length;
    expect(checkRules(tag, tagSettings).length === 0, `tag-theme openers: no broken rules: ${JSON.stringify(checkRules(tag, tagSettings)[0])}`);
  }
  console.log(`  tag theme: ${tagExcursionOpeners} of 150 openers were excursion songs`);
  expect(tagExcursionOpeners > 0, "excursion songs with a theme tag never opened");
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
