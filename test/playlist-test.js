// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * playlist-test.js — editing a generated playlist by hand (site/js/generator/playlist-edit.js): swaps, moves, undo,
 * blocks, locks and regenerating.
 * Run with:   npm test
 */

const { generatePlaylist, checkRules } = await import("../site/js/generator/generator.js");
const edit = await import("../site/js/generator/playlist-edit.js");
const { buildSampleLibrary } = await import("../tools/sample-library.js");
const { APP_DEFAULTS } = await import("./defaults.js");

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const settings = { ...APP_DEFAULTS, seed: 11 };
// The sample library with 22-character IDs, so they count as real Spotify track IDs.
const songs = buildSampleLibrary().map((song, iRow) => ({ ...song, id: `t${iRow}`.padEnd(22, "x") }));
const fresh = () => edit.prepareGenerated(generatePlaylist(songs, settings), settings);
const ids = (result) => edit.activeItems(result).map((row) => row.song.id);
/** Start times follow the songs' lengths, and numbering has no gaps. */
const timesConsistent = (result) => {
  let elapsedSec = 0;
  return edit.activeItems(result).every((row, iRow) => {
    const ok = row.index === iRow && row.startSec === elapsedSec;
    elapsedSec += row.song.lengthSec;
    return ok;
  }) && result.totalSec === elapsedSec;
};
/** An unused library song of the given dance (after associations). */
const unusedOf = (result, dance) => {
  const used = new Set(result.playlist.map((row) => row.song.id));
  return songs.find((song) => !used.has(song.id) && edit.asPlaylistSong(song, settings).dances.includes(dance));
};

console.log("=== Swap and reset");
{
  const result = fresh();
  const before = ids(result);
  const item = result.playlist.find((row) => row.kind === "regular");
  const first = item.song;
  const a = unusedOf(result, item.dance);
  edit.swapSong(result, item, a, null, settings);
  check(item.song.id === a.id && item.swapped && item.original.song.id === first.id, "swap puts the song in and remembers the generator's song");
  check(timesConsistent(result), "times recalculated after a swap");
  check(result.editViolations.length === 0, `a same-dance swap breaks no rule: ${JSON.stringify(result.editViolations)}`);
  const b = unusedOf(result, item.dance);
  edit.swapSong(result, item, b, null, settings);
  check(item.song.id === b.id && item.original.song.id === first.id, "a second swap still remembers the generator's song");
  edit.resetSwap(result, item, settings);
  check(item.song.id === first.id && !item.swapped && !item.original, "Reset puts back the generator's song");
  check(JSON.stringify(ids(result)) === JSON.stringify(before), "after Reset the playlist is as generated");
}

console.log("=== Insert, remove, restore");
{
  const result = fresh();
  const songCount = ids(result).length;
  const song = unusedOf(result, "Waltz");
  edit.insertSong(result, 5, song, "Waltz", settings);
  const added = result.playlist[5];
  check(ids(result).length === songCount + 1 && added.inserted && added.kind === "inserted" && added.song.id === song.id, "insert adds a row there");
  check(added.dance === "Waltz" && added.category === "Smooth / Standard", `inserted row knows its dance and category: ${added.dance} / ${added.category}`);
  check(timesConsistent(result), "times recalculated after an insert");
  edit.removeItem(result, added, settings);
  check(ids(result).length === songCount && !result.playlist.includes(added), "Remove deletes a row added by hand");

  const target = result.playlist[10];
  edit.removeItem(result, target, settings);
  check(target.removed && target.index === -1 && result.playlist.includes(target), "Remove keeps a generator row, marked removed");
  check(ids(result).length === songCount - 1 && timesConsistent(result), "removed rows are skipped in numbering and times");
  edit.restoreItem(result, target, settings);
  check(!target.removed && ids(result).length === songCount && timesConsistent(result), "Restore puts it back");
}

console.log("=== Problems caused by edits are reported");
{
  const result = fresh();
  const line = result.playlist.find((row) => row.kind === "event" && row.source === "Line dance break");
  edit.removeItem(result, line, settings);
  // A shorter special block is allowed (docs/history.md, v0.4, rule 5); only the later songs moving earlier may be reported.
  check(result.editViolations.every((violation) => violation.rule === "blockTime"), `removing a line-dance song: only timing is reported: ${JSON.stringify(result.editViolations)}`);
  edit.restoreItem(result, line, settings);
  check(result.editViolations.length === 0, "restoring it clears the report");
  const already = result.playlist[3].song;
  edit.insertSong(result, 20, already, null, settings);
  check(result.editViolations.some((violation) => violation.rule === "duplicate"), "inserting a song already in the playlist is reported");
  // The same recording under another ID, and another version of a song, are reported too.
  const copy = { ...result.playlist[4].song, id: "dupcopy".padEnd(22, "x"), isrc: "SAMEISRC1" };
  const result2 = fresh();
  result2.playlist[4].song.isrc = "SAMEISRC1";
  edit.insertSong(result2, 30, copy, null, settings);
  check(result2.editViolations.some((violation) => violation.rule === "duplicateRecording"), "inserting a duplicate is reported");
  const result3 = fresh();
  const cover = { ...result3.playlist[6].song, id: "cover".padEnd(22, "x"), isrc: "OTHER1", title: `${result3.playlist[6].song.title} (Live)` };
  edit.insertSong(result3, 30, cover, null, settings);
  check(result3.editViolations.some((violation) => violation.rule === "sameWork"), "inserting another version of a song is reported");
}

console.log("=== Reset all");
{
  const result = fresh();
  const before = ids(result);
  const reg = result.playlist.filter((row) => row.kind === "regular");
  edit.swapSong(result, reg[0], unusedOf(result, reg[0].dance), null, settings);
  edit.insertSong(result, 2, unusedOf(result, "Tango"), "Tango", settings);
  edit.removeItem(result, reg[5], settings);
  check(edit.hasEdits(result), "edits are noticed");
  edit.resetAll(result, settings);
  check(JSON.stringify(ids(result)) === JSON.stringify(before) && !edit.hasEdits(result), "Reset all gives back exactly the generated playlist");
  check(result.editViolations.length === 0 && timesConsistent(result), "no reported problems, consistent times");
}

console.log("=== Undo (every edit, back to the generated playlist)");
{
  const result = fresh();
  const before = ids(result);
  const reg = result.playlist.filter((row) => row.kind === "regular");
  edit.swapSong(result, reg[0], unusedOf(result, reg[0].dance), null, settings);
  edit.removeItem(result, result.playlist[8], settings);
  edit.moveItem(result, result.playlist[20], 3, settings);
  edit.toggleLock(result, result.playlist[5], settings);
  check(result.history.length === 4, `each edit is remembered: ${result.history.length}`);
  edit.undo(result, settings);
  check(!result.playlist[5].locked, "Undo takes back the lock");
  edit.undo(result, settings);
  edit.undo(result, settings);
  edit.undo(result, settings);
  check(JSON.stringify(ids(result)) === JSON.stringify(before) && !edit.hasEdits(result), "undoing every edit gives the generated playlist");
  check(timesConsistent(result), "times consistent after undo");
  edit.moveItem(result, result.playlist[20], 3, settings);
  edit.toggleLock(result, result.playlist[3], settings);
  edit.resetAll(result, settings);
  check(JSON.stringify(ids(result)) === JSON.stringify(before) && !result.playlist.some((row) => row.locked), "Reset all = undo everything, locks included");
}

console.log("=== Moving songs and blocks");
{
  const result = fresh();
  const songCount = ids(result).length;
  const song = result.playlist[20];
  edit.moveItem(result, song, 2, settings);
  check(edit.activeItems(result)[2] === song && ids(result).length === songCount && timesConsistent(result), "a moved song lands in its new place; times follow");
  edit.moveBy(result, song, 1, settings);
  check(edit.activeItems(result)[3] === song, "Move down");
  edit.moveBy(result, song, -1, settings);
  check(edit.activeItems(result)[2] === song, "Move up");

  // The line-dance break (3 songs) is a group.
  const line = () => edit.activeItems(result).filter((row) => row.source === "Line dance break");
  const gid = line()[0].group;
  const st = () => edit.groupStates(result)[gid];
  check(gid && st().intact && !st().modified, "a special block from dances with several songs is a block");
  const at = line()[0].index;
  edit.moveGroupBy(result, gid, -1, settings);
  check(line()[0].index === at - 1 && st().intact && !st().modified, "moving the whole block keeps it unmodified");
  const [a, b] = line();
  edit.moveItem(result, b, a.index, settings); // reorder inside: still together
  check(st().intact && st().modified && /\(modified\)$/.test(edit.typeLabel(line()[0], result, settings)), "reordering inside a block: still a block, (modified)");
  // A song lands inside it: disbanded, and its songs are locked.
  const other = edit.activeItems(result).find((row) => row.kind === "regular" && row.index > line()[2].index + 2);
  edit.moveItem(result, other, line()[1].index, settings);
  const was = result.playlist.filter((row) => row.source === "Line dance break");
  check(!edit.groupStates(result)[gid] && was.every((row) => row.disbanded && row.locked), "broken up: disbanded and locked");
  check(edit.typeLabel(was[0], result, settings) === "Line dance", `a disbanded song is labelled by its dance: ${edit.typeLabel(was[0], result, settings)}`);
  edit.undo(result, settings);
  check(edit.groupStates(result)[gid] && edit.groupStates(result)[gid].intact && !line().some((row) => row.locked), "Undo puts the block back");
}

console.log("=== Lock and regenerate");
{
  const result = fresh();
  edit.toggleLock(result, result.playlist[4], settings);
  edit.toggleLock(result, result.playlist[17], settings);
  const kept = [result.playlist[4].song.id, result.playlist[17].song.id];
  const plan = edit.lockedForRegeneration(result);
  const result2 = generatePlaylist(songs, { ...settings, seed: 99 }, { locked: plan });
  check(result2.playlist[4].song.id === kept[0] && result2.playlist[17].song.id === kept[1], "locked songs keep their places");
  check(result2.playlist.filter((row) => kept.includes(row.song.id)).length === 2, "and play nowhere else");
  check(result2.playlist[4].locked && result2.playlist[17].locked, "and stay locked");
  const violation = checkRules(result2, settings);
  check(!violation.some((row) => row.rule === "minToRepeat" && (Math.abs(row.index - 4) <= settings.minToRepeat || Math.abs(row.index - 17) <= settings.minToRepeat)) || result2.warnings.length,
    `the repeat gap is kept around locked songs: ${JSON.stringify(violation[0])}`);

  // A block with some songs locked condenses to those, "(modified)", and is not made again.
  const result3 = fresh();
  const line = edit.activeItems(result3).filter((row) => row.source === "Line dance break");
  edit.toggleLock(result3, line[0], settings);
  edit.toggleLock(result3, line[2], settings);
  const result4 = edit.prepareGenerated(generatePlaylist(songs, { ...settings, seed: 7 }, { locked: edit.lockedForRegeneration(result3) }), settings);
  const line4 = edit.activeItems(result4).filter((row) => row.source === "Line dance break");
  check(line4.length === 2 && line4[1].index === line4[0].index + 1, `condensed to the 2 locked songs, together: ${line4.map((row) => row.index)}`);
  check(/\(modified\)$/.test(edit.typeLabel(line4[0], result4, settings)), `labelled (modified): ${edit.typeLabel(line4[0], result4, settings)}`);

  // A disbanded block (its songs locked) is not made again; all unlocked, it is made normally.
  const result5 = fresh();
  const l5 = edit.activeItems(result5).filter((row) => row.source === "Line dance break");
  const far = edit.activeItems(result5).find((row) => row.kind === "regular" && row.index > l5[2].index + 3);
  edit.moveItem(result5, far, l5[1].index, settings);
  const result6 = generatePlaylist(songs, { ...settings, seed: 5 }, { locked: edit.lockedForRegeneration(result5) });
  check(result6.playlist.filter((row) => row.dance === "Line dance").length === 3, "a disbanded block is not created again (still 3 line dances)");
  edit.unlockAll(result5, settings);
  const result7 = generatePlaylist(songs, { ...settings, seed: 5 }, { locked: edit.lockedForRegeneration(result5) });
  check(result7.playlist.filter((row) => row.source === "Line dance break" && !row.disbanded).length === 3, "all unlocked: the block is made again normally");
}

console.log("=== Lock and regenerate, many nights");
{
  // 3 locked songs, and a fifth of all songs locked: locked songs stay in place, nothing breaks silently,
  // and with a few locks no rule has to be relaxed.
  for (const heavy of [false, true]) {
    let warned = 0;
    let silent = 0;
    let moved = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const st = { ...settings, seed };
      const result = edit.prepareGenerated(generatePlaylist(songs, st), st);
      const rows = edit.activeItems(result);
      if (heavy) rows.forEach((row, iRow) => { if ((iRow * 7 + seed) % 5 === 0) row.locked = true; });
      else [7, 19, 33].forEach((k) => (rows[(k + seed) % (rows.length - 1)].locked = true));
      const plan = edit.lockedForRegeneration(result);
      const result2 = generatePlaylist(songs, { ...st, seed: seed + 1000 }, { locked: plan });
      const lateWarned = result2.warnings.some((w) => /kept at the end/.test(w.message));
      for (const k of plan.keep) if (k.row.kind !== "final" && !lateWarned && (result2.playlist[k.position] || {}).song?.id !== k.row.song.id) moved++;
      if (result2.warnings.length) warned++;
      if (checkRules(result2, st).length && !result2.warnings.length) silent++;
    }
    const what = heavy ? "a fifth locked" : "3 locked";
    check(moved === 0, `${what}: locked songs keep their places: ${moved} moved`);
    check(silent === 0, `${what}: no rule broken silently: ${silent} nights`);
    if (!heavy) check(warned <= 5, `${what}: rules rarely need relaxing: ${warned} of 100 nights`);
  }
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: playlist editing checks.");
process.exitCode = failures ? 1 : 0;
