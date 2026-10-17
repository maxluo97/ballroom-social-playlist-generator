/**
 * playlist-check.js — checking a generated playlist on Spotify and replacing unavailable songs.
 * No page code: the generator page shows the progress and redraws; the tests call it directly.
 *
 * Every song of the playlist is looked up. A song that cannot be played is replaced by another song
 * of the same dance that fits the settings, is not in the playlist, and is itself checked first.
 * Replacements count as the generator's choices; a song with no available replacement stays.
 */

import { activeItems, hasEdits, asPlaylistSong, isThemeSong, recompute, rebaseline } from "./playlist-edit.js";
import { checkSongs, isUnavailable, unavailableReason, isChecked, RECHECK_AFTER_DAYS } from "./availability.js";
import { associationMap, withinLengthLimits } from "./generator.js";
import { spotifyTrackId } from "./data.js";
import { workKey, recordingKey } from "./works.js";

/** Another song of the same dance that fits the settings, is not in the playlist, and plays on Spotify. */
export async function availableReplacement(r, item, songs, settings, random = Math.random) {
  const m = associationMap(settings.associations);
  const inPlaylist = new Set(activeItems(r).map((x) => x.song.id));
  const others = activeItems(r).filter((x) => x !== item).map((x) => x.song);
  const recordings = new Set(others.map(recordingKey));
  const works = settings.noRepeatWorks === false ? new Set() : new Set(others.map(workKey));
  const candidates = songs
    .filter((sg) => spotifyTrackId(sg.id) && !inPlaylist.has(sg.id) && !isUnavailable(sg.id) &&
      withinLengthLimits(sg, settings) && sg.dances.some((d) => m(d) === item.dance) &&
      (!item.blockTag || (sg.tags || []).includes(item.blockTag)) &&
      !recordings.has(recordingKey(sg)) && !works.has(workKey(sg)))
    .map((sg) => ({ sg, known: isChecked(sg.id), order: random() }))
    // Songs already known to play come first; then unchecked ones, in random order.
    .sort((a, b) => (b.known ? 1 : 0) - (a.known ? 1 : 0) || a.order - b.order);
  for (const { sg, known } of candidates.slice(0, 10)) {
    if (known) return sg;
    const { rateLimited } = await checkSongs([sg.id]);
    if (isChecked(sg.id) && !isUnavailable(sg.id)) return sg;
    if (rateLimited) return null; // Spotify wants a break: stop looking
  }
  return null;
}

/**
 * Check the playlist's songs and replace unavailable ones. Songs checked in the last
 * RECHECK_AFTER_DAYS days are not looked up again unless `force`. `stillCurrent()` returning false
 * (e.g. a new playlist was generated meanwhile) stops it; then it returns null. Otherwise sets and
 * returns r.check = { running: false, total, replaced, unresolved, unchecked, rateLimited }, where
 * `unchecked` counts songs Spotify did not answer for (they are NOT known to be playable).
 */
export async function checkAndReplace(r, songs, settings, { onProgress = () => {}, stillCurrent = () => true, force = false } = {}) {
  const items = activeItems(r).filter((it) => spotifyTrackId(it.song.id));
  const first = await checkSongs(items.map((it) => it.song.id), {
    shouldStop: () => !stillCurrent(), onProgress, maxAgeDays: force ? 0 : RECHECK_AFTER_DAYS,
  });
  if (!stillCurrent()) return null;
  let rateLimited = first.rateLimited;

  let replaced = 0;
  let unresolved = 0;
  for (const it of activeItems(r)) {
    if (rateLimited || !isUnavailable(it.song.id)) continue;
    if (it.chosen) {
      unresolved++; // a chosen song stays (with a warning); the user picked it
      continue;
    }
    const old = it.song;
    const sub = await availableReplacement(r, it, songs, settings);
    if (!stillCurrent()) return null;
    if (!sub) {
      unresolved++;
      continue;
    }
    it.song = asPlaylistSong(sub, settings);
    it.isTheme = isThemeSong(it.song, it.dance, it.kind, settings);
    it.autoReplaced = { title: old.title, why: unavailableReason(old.id) };
    replaced++;
  }
  // Songs still unavailable (the replacing stopped early because of the limit) also need attention.
  if (rateLimited) unresolved = activeItems(r).filter((it) => isUnavailable(it.song.id)).length;
  const unchecked = items.filter((it) => !isChecked(it.song.id)).length;
  const edited = hasEdits(r);
  r.check = { running: false, total: items.length, replaced, unresolved, unchecked, rateLimited };
  recompute(r, settings);
  // Replacements in an untouched playlist are the generator's choices, not edits.
  if (!edited) rebaseline(r, settings);
  return r.check;
}
