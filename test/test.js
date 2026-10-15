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

import { generatePlaylist, checkRules, validateSettings, formatTime } from "../js/generator.js";
import { buildSongs, SCENARIOS } from "./sample-data.js";

const SEEDS = Number(process.argv[2]) || 500;
const SHOW_EXAMPLES = 3;
let totalBugs = 0;

for (const sc of SCENARIOS) {
  const songs = buildSongs(sc.perDance);
  const longest = Math.max(...songs.map((s) => s.lengthSec));
  const shortest = Math.min(...songs.map((s) => s.lengthSec));
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
