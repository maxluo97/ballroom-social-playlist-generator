// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-rules.js — checks a playlist against the settings, independently of how it was made.
 *
 * Returns a list of { rule, index, message } (empty: every rule held). The tests use it on thousands of
 * generated nights; the generator page uses it on a playlist after the user's edits, to report what an
 * edit broke. Rows the user locked are exempt where the user's choice overrides a rule.
 */

import { mergeSettings, resolveSettings, associationMap, blockLabel, withinLengthLimits } from "./event-settings.js";
import { themeInfo, themePlan } from "./theme-plan.js";
import { isKeptApartRow } from "./playlist-stats.js";
import { workKey, recordingKey } from "../shared/works.js";

export function checkRules(result, userSettings) {
  const settings = resolveSettings(userSettings);
  const playlist = result.playlist;
  const problems = [];
  const report = (rule, index, message) => problems.push({ rule, index, message });
  const theme = themeInfo(settings);
  // Openers of a theme with dances are exempt from spacing, turn lengths and the opening blacklist.
  const plan = themePlan(settings, theme);
  const danceOpenerCount = settings.theme && plan.openerDances.length ? settings.opening.earlyCount : 0;
  const isOpener = (row) =>
    row.index >= 0 && row.index < danceOpenerCount && (row.kind === "regular" || row.kind === "theme") && theme.dances.has(row.dance);
  // Repeat gaps: standalone theme dances use their own gap; songs with a theme tag may come down to the
  // theme minimum gap; everything else uses minToRepeat.
  const standaloneDances = new Set(plan.standalone);
  const gapFor = (row) =>
    standaloneDances.has(row.dance) ? plan.standaloneGap
      : theme.tags.size && !theme.dances.has(row.dance) && theme.hasTag(row.song) ? Math.min(plan.minGap, settings.minToRepeat)
        : settings.minToRepeat;
  // A tag-only theme's excursion openers do not use up excursion counts.
  const tagOpenerCount = theme.tags.size && !danceOpenerCount ? settings.opening.earlyCount : 0;

  // 1. Turn length: at most maxInARow songs of one category in a row (over the regular songs).
  if (settings.categories.length > 1) {
    let runLength = 0;
    let previousCategory = null;
    for (const row of playlist) {
      if (row.kind !== "regular" || row.locked) continue; // locked songs stand outside the turns
      if (isOpener(row)) {
        previousCategory = null;
        continue;
      }
      runLength = row.category === previousCategory ? runLength + 1 : 1;
      previousCategory = row.category;
      if (runLength > settings.maxInARow) report("maxInARow", row.index, `${runLength} ${row.category} songs in a row.`);
    }
  }

  // 2. The repeat gap (the last song is exempt; so are the songs of one block from dances or of chosen
  // songs among themselves, and two locked songs).
  for (const row of playlist) {
    if (row.kind === "final" || isOpener(row)) continue;
    for (let iEarlier = Math.max(0, row.index - gapFor(row)); iEarlier < row.index; iEarlier++) {
      const earlier = playlist[iEarlier];
      if ((row.chosen || row.fromDances) && row.blockId !== undefined && earlier.blockId === row.blockId) continue; // within one such block
      if (row.locked && earlier.locked) continue; // two songs the user locked
      if (earlier.dance === row.dance) {
        report("minToRepeat", row.index, `${row.dance} repeated after ${row.index - iEarlier - 1} song(s).`);
        break;
      }
    }
  }

  // 3. The opening: no blacklisted dances; with a theme, only theme songs.
  const openingBlacklist = new Set(settings.opening.blacklist);
  const openingRows = playlist.slice(0, settings.opening.earlyCount);
  for (const row of openingRows) {
    if (["regular", "excursion", "theme"].includes(row.kind) && openingBlacklist.has(row.dance) && !isOpener(row)) {
      report("earlyBlacklist", row.index, `${row.dance} in the opening.`);
    }
  }
  if (theme.active) {
    for (const row of openingRows) {
      if (row.kind === "regular" && !row.isTheme) report("themeOpener", row.index, `${row.dance} is not a theme song.`);
    }
  }

  // 4. The shuffle-bag: within each category, a non-theme dance may not repeat until the bag empties.
  settings.categories.forEach((category) => {
    const lockedDances = new Set(playlist.filter((row) => row.locked && row.kind !== "final").map((row) => row.dance));
    const bagDances = category.dances.filter((dance) => !theme.dances.has(dance) && !lockedDances.has(dance));
    if (!bagDances.length) return;
    let leftInBag = new Set(bagDances);
    for (const row of playlist) {
      if ((row.kind !== "regular" && row.kind !== "block") || row.chosen || row.locked || row.category !== category.name ||
          theme.dances.has(row.dance) || lockedDances.has(row.dance)) continue;
      if (leftInBag.has(row.dance)) leftInBag.delete(row.dance);
      else report("shuffleBag", row.index, `${category.name}: ${row.dance} repeated before the bag emptied.`);
      if (leftInBag.size === 0) leftInBag = new Set(bagDances);
    }
  });

  // 5. The hidden theme category's shuffle-bag: no standalone theme dance repeats until all have played.
  if (plan.standalone.length > 1) {
    let leftInBag = new Set(plan.standalone);
    for (const row of playlist) {
      if (row.kind !== "theme" || isOpener(row) || row.mustPlay) continue;
      if (leftInBag.has(row.dance)) leftInBag.delete(row.dance);
      else report("themeBag", row.index, `${row.dance} repeated before every standalone theme dance had played.`);
      if (leftInBag.size === 0) leftInBag = new Set(plan.standalone);
    }
  }

  // 6. The excursion pool: each draw needs a count left; the pool resets when all counts reach 0.
  const startingPool = settings.excursions.pool;
  let pool = { ...startingPool };
  for (const row of playlist) {
    if (row.kind !== "excursion") continue;
    if (row.index < tagOpenerCount && theme.hasTag(row.song)) continue;
    if (row.mustPlay || row.locked) continue; // must-play and locked songs do not use up an excursion count
    if (!Object.values(pool).some((count) => count > 0)) pool = { ...startingPool };
    if (!(pool[row.dance] > 0)) report("excursionPool", row.index, `${row.dance} drawn with no count left in the pool.`);
    else pool[row.dance]--;
  }

  // 7. Special blocks: the right songs (the tag; one of its dances), never in the opening, no more songs
  // than asked for, not before their point (fixed point / window start), "keep apart" blocks never next
  // to each other, and never directly after what "Never directly after" names.
  const blockSettings = mergeSettings(userSettings).specialBlocks;
  const rowsOfBlock = new Map();
  for (const row of playlist) {
    if (row.blockId === undefined) continue;
    if (!rowsOfBlock.has(row.blockId)) rowsOfBlock.set(row.blockId, []);
    rowsOfBlock.get(row.blockId).push(row);
    if (row.blockTag !== undefined && !(row.song.tags || []).includes(row.blockTag)) {
      report("blockTag", row.index, `"${row.song.title}" in "${row.blockLabel}" does not have the tag "${row.blockTag}".`);
    }
    if (row.index < settings.opening.earlyCount) report("blockInOpening", row.index, `"${row.blockLabel}" song in the opening.`);
  }
  const toGroup = associationMap(settings.associations);
  for (const [blockId, rows] of rowsOfBlock) {
    const block = blockSettings[blockId];
    if (!block || rows.some((row) => row.locked)) continue; // kept (and maybe changed) by the user
    const label = rows[0].blockLabel || blockLabel(block);
    const firstRow = rows[0];
    const expectedCount = block.source === "songs" ? block.songs.length : block.count;
    if (rows.length > expectedCount) report("blockCount", firstRow.index, `"${label}" has ${rows.length} songs, expected at most ${expectedCount}.`);
    if (block.source === "dances") {
      const blockDances = new Set(block.dances.map(toGroup));
      for (const row of rows) {
        if (!blockDances.has(row.dance)) report("blockDance", row.index, `"${label}" played ${row.dance}, which is not one of its dances.`);
      }
    }
    const earliestShare = block.placement.mode === "at" ? block.placement.at : block.placement.mode === "window" ? block.placement.from : 0;
    // A block starts at the first song at or after its point; edits before it (a swap for a shorter song, a
    // removed song) move it a little earlier. Only a start more than one song early counts as broken.
    const rowBefore = firstRow.index > 0 ? playlist[firstRow.index - 1] : null;
    const slackSec = rowBefore && rowBefore.song ? rowBefore.song.lengthSec || 0 : 0;
    if (result.targetSec && firstRow.startSec < earliestShare * result.targetSec - slackSec - 1e-6) {
      report("blockTime", firstRow.index, `"${label}" started more than a song before ${(earliestShare * 100).toFixed(0)}% of the night.`);
    }
    if (rowBefore && block.keepApart && isKeptApartRow(rowBefore) && rowBefore.blockId !== blockId) {
      report("blocksApart", firstRow.index, `"${label}" directly after "${rowBefore.blockLabel}".`);
    }
    const notAfter = (block.notAfter || []).map(toGroup);
    if (rowBefore && rowBefore.blockId !== blockId && notAfter.some((name) => name === rowBefore.dance || name === rowBefore.blockLabel)) {
      report("notAfter", firstRow.index, `"${label}" directly after ${rowBefore.blockLabel ? `"${rowBefore.blockLabel}"` : rowBefore.dance}.`);
    }
  }

  // 8. Duplicates (the same recording) never twice; with noRepeatWorks, no two versions of one work
  // (a chosen or must-play song may have other versions elsewhere).
  const firstIndexOfRecording = new Map();
  const firstIndexOfWork = new Map();
  for (const row of playlist) {
    const recording = recordingKey(row.song);
    const work = workKey(row.song);
    const playedAsChosen = row.chosen || row.mustPlay;
    if (firstIndexOfRecording.has(recording) && playlist[firstIndexOfRecording.get(recording)].song.id !== row.song.id) {
      report("duplicateRecording", row.index, `"${row.song.title}" is the same recording as #${firstIndexOfRecording.get(recording) + 1}.`);
    } else if (settings.noRepeatWorks && !playedAsChosen && firstIndexOfWork.has(work) && playlist[firstIndexOfWork.get(work)].song.id !== row.song.id) {
      const iEarlier = firstIndexOfWork.get(work);
      report("sameWork", row.index, `"${row.song.title}" is another version of #${iEarlier + 1} ("${playlist[iEarlier].song.title}").`);
    }
    if (!firstIndexOfRecording.has(recording)) firstIndexOfRecording.set(recording, row.index);
    if (!firstIndexOfWork.has(work) && !playedAsChosen) firstIndexOfWork.set(work, row.index);
  }

  // 9. Song length limits (chosen and must-play songs may break them).
  for (const row of playlist) {
    if (!row.chosen && !row.mustPlay && !withinLengthLimits(row.song, settings)) {
      report("songLength", row.index, `"${row.song.title}" (${row.song.lengthSec} s) is outside the song length limits.`);
    }
  }

  // 10. The last dance.
  if (settings.closing.finalDance) {
    const lastRow = playlist[playlist.length - 1];
    if (!lastRow || lastRow.dance !== settings.closing.finalDance) report("finalDance", playlist.length - 1, "Last song is not the designated final dance.");
  }

  return problems;
}
