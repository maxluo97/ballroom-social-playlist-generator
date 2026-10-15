/**
 * playlist-edit.js — changing a generated playlist by hand. No page code: the generator page calls
 * these and redraws; the tests call them directly.
 *
 * A generated playlist (`r`, from generatePlaylist) can be edited. Each row of r.playlist may carry:
 *   swapped + original   the song was swapped; `original` = the generator's choice (for Reset)
 *   inserted             the row was added by hand (Remove deletes it)
 *   removed              a generator row taken out (kept, so it can be Restored)
 *   autoReplaced         the Spotify check replaced an unavailable song here (the generator's choice)
 *   genIndex             its position when generated (the generator's warnings refer to these)
 * Times, numbering, stats, the rule check and every output use only the rows that are not removed.
 * Rule breaks are reported only if an edit caused them (`baselineViolations` / `editViolations`).
 */

import { associationMap, checkRules, computeStats } from "./generator.js";

/** Rows actually in the playlist (removed ones left out), in order. */
export const activeItems = (r) => r.playlist.filter((x) => !x.removed);
export const activeResult = (r) => ({ ...r, playlist: activeItems(r) });
export const hasEdits = (r) => !!r && r.playlist.some((x) => x.swapped || x.inserted || x.removed);
/** A rule break tied to its song (not its position), so it survives insertions and removals. */
export const violationKey = (v, items) => `${v.rule}|${v.index >= 0 && items[v.index] ? items[v.index].song.id : "-"}`;

/** Make a freshly generated playlist ready for editing. */
export function prepareGenerated(r, settings) {
  r.playlist.forEach((it) => (it.genIndex = it.index));
  rebaseline(r, settings);
  return r;
}

/** Remember which rules are broken right now, so later edits only report problems they cause. */
export function rebaseline(r, settings) {
  const items = activeItems(r);
  r.baselineViolations = checkRules({ ...r, playlist: items }, settings).map((v) => violationKey(v, items));
  r.editViolations = [];
}

/** A library song in the form the playlist uses (dances after associations). */
export function asPlaylistSong(song, settings) {
  const m = associationMap(settings.associations);
  return { ...song, sourceDances: song.dances, dances: [...new Set(song.dances.map(m))] };
}

/** Whether a song counts toward the theme when played as `dance`. */
export function isThemeSong(song, dance, kind, settings) {
  if (!settings.theme || kind === "fixed") return false;
  const m = associationMap(settings.associations);
  return new Set((settings.theme.dances || []).map(m)).has(dance) ||
    (song.tags || []).some((t) => (settings.theme.tags || []).includes(t));
}

/** The category a dance (after associations) belongs to, or null. */
function categoryNameOf(dance, settings) {
  const m = associationMap(settings.associations);
  const c = settings.categories.find((cat) => cat.dances.some((d) => m(d) === dance));
  return c ? c.name : null;
}

/** After any edit: renumber, retime, restat, and re-check the rules (reporting only new problems). */
export function recompute(r, settings) {
  let t = 0;
  let n = 0;
  for (const x of r.playlist) {
    if (x.removed) {
      x.index = -1;
      continue;
    }
    x.index = n++;
    x.startSec = t;
    t += x.song.lengthSec;
  }
  r.totalSec = t;
  r.overtimeSec = t - r.targetSec;
  const ar = activeResult(r);
  r.stats = computeStats(ar);
  const before = new Set(r.baselineViolations || []);
  r.editViolations = checkRules(ar, settings).filter((v) => !before.has(violationKey(v, ar.playlist)));
  // The generator never repeats a song, so its rule check does not look for that; hand edits can.
  const firstAt = new Map();
  for (const x of ar.playlist) {
    if (firstAt.has(x.song.id)) {
      r.editViolations.push({ rule: "duplicate", index: x.index, message: `“${x.song.title}” is also #${firstAt.get(x.song.id) + 1}.` });
    } else firstAt.set(x.song.id, x.index);
  }
  return r;
}

/** Put `song` (a library song) into a row. A song of another dance changes what the row is. */
export function swapSong(r, item, song, dance, settings) {
  if (!item.original) item.original = { song: item.song, dance: item.dance, isTheme: item.isTheme };
  item.song = asPlaylistSong(song, settings);
  if (!item.song.dances.includes(item.dance)) item.dance = dance || item.song.dances[0] || item.dance;
  item.isTheme = isThemeSong(item.song, item.dance, item.kind, settings);
  item.swapped = !item.inserted; // an inserted row just gets a different song
  if (item.inserted) delete item.original;
  return recompute(r, settings);
}

/** Put back the generator's song in a swapped row. */
export function resetSwap(r, item, settings) {
  Object.assign(item, item.original);
  delete item.original;
  item.swapped = false;
  return recompute(r, settings);
}

/** Insert a library song at `position` in r.playlist, played as `dance` (if it has it). */
export function insertSong(r, position, song, dance, settings) {
  const s = asPlaylistSong(song, settings);
  const d = dance && s.dances.includes(dance) ? dance : s.dances[0] || "";
  r.playlist.splice(position, 0, {
    song: s, dance: d, kind: "inserted", category: d ? categoryNameOf(d, settings) : null, source: null,
    isTheme: isThemeSong(s, d, "inserted", settings), inserted: true,
  });
  return recompute(r, settings);
}

/** Remove a row: a row added by hand is deleted; a generator row is kept (removed) so it can be restored. */
export function removeItem(r, item, settings) {
  if (item.inserted) r.playlist.splice(r.playlist.indexOf(item), 1);
  else item.removed = true;
  return recompute(r, settings);
}

export function restoreItem(r, item, settings) {
  item.removed = false;
  return recompute(r, settings);
}

/** Undo every manual change: exactly the playlist the generator made. */
export function resetAll(r, settings) {
  r.playlist = r.playlist.filter((x) => !x.inserted);
  for (const x of r.playlist) {
    if (x.original) Object.assign(x, x.original);
    delete x.original;
    x.swapped = false;
    x.removed = false;
  }
  return recompute(r, settings);
}
