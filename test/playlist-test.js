/**
 * playlist-test.js — editing a generated playlist by hand (js/playlist-edit.js): swaps, moves, undo,
 * blocks, locks and regenerating.
 * Run with:   npm test
 */

const { generatePlaylist, checkRules } = await import("../js/generator.js");
const edit = await import("../js/playlist-edit.js");
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
const songs = buildSampleLibrary().map((s, i) => ({ ...s, id: `t${i}`.padEnd(22, "x") }));
const fresh = () => edit.prepareGenerated(generatePlaylist(songs, settings), settings);
const ids = (r) => edit.activeItems(r).map((x) => x.song.id);
/** Start times follow the songs' lengths, and numbering has no gaps. */
const timesConsistent = (r) => {
  let t = 0;
  return edit.activeItems(r).every((x, i) => {
    const ok = x.index === i && x.startSec === t;
    t += x.song.lengthSec;
    return ok;
  }) && r.totalSec === t;
};
/** An unused library song of the given dance (after associations). */
const unusedOf = (r, dance) => {
  const used = new Set(r.playlist.map((x) => x.song.id));
  return songs.find((s) => !used.has(s.id) && edit.asPlaylistSong(s, settings).dances.includes(dance));
};

console.log("=== Swap and reset");
{
  const r = fresh();
  const before = ids(r);
  const it = r.playlist.find((x) => x.kind === "regular");
  const first = it.song;
  const a = unusedOf(r, it.dance);
  edit.swapSong(r, it, a, null, settings);
  check(it.song.id === a.id && it.swapped && it.original.song.id === first.id, "swap puts the song in and remembers the generator's song");
  check(timesConsistent(r), "times recalculated after a swap");
  check(r.editViolations.length === 0, `a same-dance swap breaks no rule: ${JSON.stringify(r.editViolations)}`);
  const b = unusedOf(r, it.dance);
  edit.swapSong(r, it, b, null, settings);
  check(it.song.id === b.id && it.original.song.id === first.id, "a second swap still remembers the generator's song");
  edit.resetSwap(r, it, settings);
  check(it.song.id === first.id && !it.swapped && !it.original, "Reset puts back the generator's song");
  check(JSON.stringify(ids(r)) === JSON.stringify(before), "after Reset the playlist is as generated");
}

console.log("=== Insert, remove, restore");
{
  const r = fresh();
  const n = ids(r).length;
  const song = unusedOf(r, "Waltz");
  edit.insertSong(r, 5, song, "Waltz", settings);
  const added = r.playlist[5];
  check(ids(r).length === n + 1 && added.inserted && added.kind === "inserted" && added.song.id === song.id, "insert adds a row there");
  check(added.dance === "Waltz" && added.category === "Smooth / Standard", `inserted row knows its dance and category: ${added.dance} / ${added.category}`);
  check(timesConsistent(r), "times recalculated after an insert");
  edit.removeItem(r, added, settings);
  check(ids(r).length === n && !r.playlist.includes(added), "Remove deletes a row added by hand");

  const target = r.playlist[10];
  edit.removeItem(r, target, settings);
  check(target.removed && target.index === -1 && r.playlist.includes(target), "Remove keeps a generator row, marked removed");
  check(ids(r).length === n - 1 && timesConsistent(r), "removed rows are skipped in numbering and times");
  edit.restoreItem(r, target, settings);
  check(!target.removed && ids(r).length === n && timesConsistent(r), "Restore puts it back");
}

console.log("=== Problems caused by edits are reported");
{
  const r = fresh();
  const line = r.playlist.find((x) => x.kind === "event" && x.source === "Line dance break");
  edit.removeItem(r, line, settings);
  // A shorter special block is allowed (NOTES.md v0.4, rule 5); only the later songs moving earlier may be reported.
  check(r.editViolations.every((v) => v.rule === "blockTime"), `removing a line-dance song: only timing is reported: ${JSON.stringify(r.editViolations)}`);
  edit.restoreItem(r, line, settings);
  check(r.editViolations.length === 0, "restoring it clears the report");
  const already = r.playlist[3].song;
  edit.insertSong(r, 20, already, null, settings);
  check(r.editViolations.some((v) => v.rule === "duplicate"), "inserting a song already in the playlist is reported");
  // The same recording under another ID, and another version of a song, are reported too.
  const copy = { ...r.playlist[4].song, id: "dupcopy".padEnd(22, "x"), isrc: "SAMEISRC1" };
  const r2 = fresh();
  r2.playlist[4].song.isrc = "SAMEISRC1";
  edit.insertSong(r2, 30, copy, null, settings);
  check(r2.editViolations.some((v) => v.rule === "duplicateRecording"), "inserting a duplicate is reported");
  const r3 = fresh();
  const cover = { ...r3.playlist[6].song, id: "cover".padEnd(22, "x"), isrc: "OTHER1", title: `${r3.playlist[6].song.title} (Live)` };
  edit.insertSong(r3, 30, cover, null, settings);
  check(r3.editViolations.some((v) => v.rule === "sameWork"), "inserting another version of a song is reported");
}

console.log("=== Reset all");
{
  const r = fresh();
  const before = ids(r);
  const reg = r.playlist.filter((x) => x.kind === "regular");
  edit.swapSong(r, reg[0], unusedOf(r, reg[0].dance), null, settings);
  edit.insertSong(r, 2, unusedOf(r, "Tango"), "Tango", settings);
  edit.removeItem(r, reg[5], settings);
  check(edit.hasEdits(r), "edits are noticed");
  edit.resetAll(r, settings);
  check(JSON.stringify(ids(r)) === JSON.stringify(before) && !edit.hasEdits(r), "Reset all gives back exactly the generated playlist");
  check(r.editViolations.length === 0 && timesConsistent(r), "no reported problems, consistent times");
}

console.log("=== Undo (every edit, back to the generated playlist)");
{
  const r = fresh();
  const before = ids(r);
  const reg = r.playlist.filter((x) => x.kind === "regular");
  edit.swapSong(r, reg[0], unusedOf(r, reg[0].dance), null, settings);
  edit.removeItem(r, r.playlist[8], settings);
  edit.moveItem(r, r.playlist[20], 3, settings);
  edit.toggleLock(r, r.playlist[5], settings);
  check(r.history.length === 4, `each edit is remembered: ${r.history.length}`);
  edit.undo(r, settings);
  check(!r.playlist[5].locked, "Undo takes back the lock");
  edit.undo(r, settings);
  edit.undo(r, settings);
  edit.undo(r, settings);
  check(JSON.stringify(ids(r)) === JSON.stringify(before) && !edit.hasEdits(r), "undoing every edit gives the generated playlist");
  check(timesConsistent(r), "times consistent after undo");
  edit.moveItem(r, r.playlist[20], 3, settings);
  edit.toggleLock(r, r.playlist[3], settings);
  edit.resetAll(r, settings);
  check(JSON.stringify(ids(r)) === JSON.stringify(before) && !r.playlist.some((x) => x.locked), "Reset all = undo everything, locks included");
}

console.log("=== Moving songs and blocks");
{
  const r = fresh();
  const n = ids(r).length;
  const song = r.playlist[20];
  edit.moveItem(r, song, 2, settings);
  check(edit.activeItems(r)[2] === song && ids(r).length === n && timesConsistent(r), "a moved song lands in its new place; times follow");
  edit.moveBy(r, song, 1, settings);
  check(edit.activeItems(r)[3] === song, "Move down");
  edit.moveBy(r, song, -1, settings);
  check(edit.activeItems(r)[2] === song, "Move up");

  // The line-dance break (3 songs) is a group.
  const line = () => edit.activeItems(r).filter((x) => x.source === "Line dance break");
  const gid = line()[0].group;
  const st = () => edit.groupStates(r)[gid];
  check(gid && st().intact && !st().modified, "a special block from dances with several songs is a block");
  const at = line()[0].index;
  edit.moveGroupBy(r, gid, -1, settings);
  check(line()[0].index === at - 1 && st().intact && !st().modified, "moving the whole block keeps it unmodified");
  const [a, b] = line();
  edit.moveItem(r, b, a.index, settings); // reorder inside: still together
  check(st().intact && st().modified && /\(modified\)$/.test(edit.typeLabel(line()[0], r, settings)), "reordering inside a block: still a block, (modified)");
  // A song lands inside it: disbanded, and its songs are locked.
  const other = edit.activeItems(r).find((x) => x.kind === "regular" && x.index > line()[2].index + 2);
  edit.moveItem(r, other, line()[1].index, settings);
  const was = r.playlist.filter((x) => x.source === "Line dance break");
  check(!edit.groupStates(r)[gid] && was.every((x) => x.disbanded && x.locked), "broken up: disbanded and locked");
  check(edit.typeLabel(was[0], r, settings) === "Line dance", `a disbanded song is labelled by its dance: ${edit.typeLabel(was[0], r, settings)}`);
  edit.undo(r, settings);
  check(edit.groupStates(r)[gid] && edit.groupStates(r)[gid].intact && !line().some((x) => x.locked), "Undo puts the block back");
}

console.log("=== Lock and regenerate");
{
  const r = fresh();
  edit.toggleLock(r, r.playlist[4], settings);
  edit.toggleLock(r, r.playlist[17], settings);
  const kept = [r.playlist[4].song.id, r.playlist[17].song.id];
  const plan = edit.lockedForRegeneration(r);
  const r2 = generatePlaylist(songs, { ...settings, seed: 99 }, { locked: plan });
  check(r2.playlist[4].song.id === kept[0] && r2.playlist[17].song.id === kept[1], "locked songs keep their places");
  check(r2.playlist.filter((x) => kept.includes(x.song.id)).length === 2, "and play nowhere else");
  check(r2.playlist[4].locked && r2.playlist[17].locked, "and stay locked");
  const v = checkRules(r2, settings);
  check(!v.some((x) => x.rule === "minToRepeat" && (Math.abs(x.index - 4) <= settings.minToRepeat || Math.abs(x.index - 17) <= settings.minToRepeat)) || r2.warnings.length,
    `the repeat gap is kept around locked songs: ${JSON.stringify(v[0])}`);

  // A block with some songs locked condenses to those, "(modified)", and is not made again.
  const r3 = fresh();
  const line = edit.activeItems(r3).filter((x) => x.source === "Line dance break");
  edit.toggleLock(r3, line[0], settings);
  edit.toggleLock(r3, line[2], settings);
  const r4 = edit.prepareGenerated(generatePlaylist(songs, { ...settings, seed: 7 }, { locked: edit.lockedForRegeneration(r3) }), settings);
  const line4 = edit.activeItems(r4).filter((x) => x.source === "Line dance break");
  check(line4.length === 2 && line4[1].index === line4[0].index + 1, `condensed to the 2 locked songs, together: ${line4.map((x) => x.index)}`);
  check(/\(modified\)$/.test(edit.typeLabel(line4[0], r4, settings)), `labelled (modified): ${edit.typeLabel(line4[0], r4, settings)}`);

  // A disbanded block (its songs locked) is not made again; all unlocked, it is made normally.
  const r5 = fresh();
  const l5 = edit.activeItems(r5).filter((x) => x.source === "Line dance break");
  const far = edit.activeItems(r5).find((x) => x.kind === "regular" && x.index > l5[2].index + 3);
  edit.moveItem(r5, far, l5[1].index, settings);
  const r6 = generatePlaylist(songs, { ...settings, seed: 5 }, { locked: edit.lockedForRegeneration(r5) });
  check(r6.playlist.filter((x) => x.dance === "Line dance").length === 3, "a disbanded block is not created again (still 3 line dances)");
  edit.unlockAll(r5, settings);
  const r7 = generatePlaylist(songs, { ...settings, seed: 5 }, { locked: edit.lockedForRegeneration(r5) });
  check(r7.playlist.filter((x) => x.source === "Line dance break" && !x.disbanded).length === 3, "all unlocked: the block is made again normally");
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
      const r = edit.prepareGenerated(generatePlaylist(songs, st), st);
      const rows = edit.activeItems(r);
      if (heavy) rows.forEach((x, i) => { if ((i * 7 + seed) % 5 === 0) x.locked = true; });
      else [7, 19, 33].forEach((k) => (rows[(k + seed) % (rows.length - 1)].locked = true));
      const plan = edit.lockedForRegeneration(r);
      const r2 = generatePlaylist(songs, { ...st, seed: seed + 1000 }, { locked: plan });
      const lateWarned = r2.warnings.some((w) => /kept at the end/.test(w.message));
      for (const k of plan.keep) if (k.row.kind !== "final" && !lateWarned && (r2.playlist[k.position] || {}).song?.id !== k.row.song.id) moved++;
      if (r2.warnings.length) warned++;
      if (checkRules(r2, st).length && !r2.warnings.length) silent++;
    }
    const what = heavy ? "a fifth locked" : "3 locked";
    check(moved === 0, `${what}: locked songs keep their places: ${moved} moved`);
    check(silent === 0, `${what}: no rule broken silently: ${silent} nights`);
    if (!heavy) check(warned <= 5, `${what}: rules rarely need relaxing: ${warned} of 100 nights`);
  }
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: playlist editing checks.");
process.exitCode = failures ? 1 : 0;
