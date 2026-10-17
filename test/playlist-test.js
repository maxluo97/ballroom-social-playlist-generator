/**
 * playlist-test.js — editing a generated playlist by hand (js/playlist-edit.js) and checking it on
 * Spotify with automatic replacement (js/playlist-check.js, against a fake Spotify).
 * Run with:   npm test
 */

// A fake browser storage with a valid-looking login; a fake Spotify where some songs are gone.
const memory = { "dpg.spotify.tokens.v1": JSON.stringify({ accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 3600e3 }) };
globalThis.localStorage = {
  getItem: (k) => memory[k] ?? null,
  setItem: (k, v) => (memory[k] = String(v)),
  removeItem: (k) => delete memory[k],
};
const gone = new Set(); // track IDs the fake Spotify reports as missing
const limited = new Set(); // track IDs for which the fake Spotify says "too many requests, wait an hour"
globalThis.fetch = async (url) => {
  const id = String(url).match(/tracks\/([^?]+)/)[1];
  if (limited.has(id)) {
    return { ok: false, status: 429, headers: { get: (h) => (h === "Retry-After" ? "3600" : null) },
      json: async () => ({ error: { status: 429, message: "quota exceeded" } }) };
  }
  const missing = gone.has(id);
  return {
    ok: !missing, status: missing ? 404 : 200, headers: { get: () => null },
    json: async () => (missing ? { error: { status: 404, message: "Non existing id" } } : { id, name: "x", is_playable: true }),
  };
};

const { generatePlaylist, checkRules } = await import("../js/generator.js");
const edit = await import("../js/playlist-edit.js");
const { checkAndReplace } = await import("../js/playlist-check.js");
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
  const line = r.playlist.find((x) => x.kind === "fixed" && x.source === "Line dance break");
  edit.removeItem(r, line, settings);
  check(r.editViolations.some((v) => v.rule === "fixedEvent"), "removing a line-dance song: the event is a song short");
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

console.log("=== Spotify check replaces unavailable songs");
{
  const r = fresh();
  const victim = r.playlist.find((x) => x.kind === "regular");
  const victimId = victim.song.id;
  gone.add(victimId);
  const result = await checkAndReplace(r, songs, settings);
  check(result && result.replaced === 1 && result.unresolved === 0, `one song replaced: ${JSON.stringify(result)}`);
  check(victim.song.id !== victimId && victim.song.dances.includes(victim.dance), "replaced by a song of the same dance");
  check(victim.autoReplaced && !victim.swapped && !edit.hasEdits(r), "a replacement is the generator's choice, not an edit");
  check(!ids(r).includes(victimId) && new Set(ids(r)).size === ids(r).length, "the unavailable song is gone; no duplicates");
  check(r.editViolations.length === 0 && timesConsistent(r), "no reported problems after replacing");
  check(checkRules(edit.activeResult(r), settings).every((v) => r.baselineViolations.includes(edit.violationKey(v, edit.activeItems(r)))),
    "the replaced playlist still follows the rules it followed when generated");
}

console.log("=== Spotify limiting requests: songs are reported as unchecked, not as playable");
{
  // A different night, so its songs have not all been checked already.
  const r = edit.prepareGenerated(generatePlaylist(songs, { ...settings, seed: 99 }), settings);
  for (const it of edit.activeItems(r).slice(0, 3)) limited.add(it.song.id);
  const result = await checkAndReplace(r, songs, settings, { force: true });
  check(result.rateLimited && result.rateLimited.retryAfter === 3600, `the limit is reported: ${JSON.stringify(result.rateLimited)}`);
  check(result.unchecked > 0, `songs Spotify did not answer for are counted as unchecked: ${result.unchecked}`);
  check(result.replaced === 0, "nothing is replaced because of a song that merely could not be checked");
  limited.clear();
  const again = await checkAndReplace(r, songs, settings, { force: true });
  check(!again.rateLimited && again.unchecked === 0, `"Check again" after the limit has passed checks everything: ${JSON.stringify(again)}`);
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: playlist editing checks.");
process.exitCode = failures ? 1 : 0;
