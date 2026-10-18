// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * works.js — recognizing "the same song" (the agreed spec, NOTES.md v0.2.4 "Works and duplicates").
 *
 *   Duplicates  the same recording under different Spotify IDs (single vs album, re-releases).
 *               A song's recording key is its `recording` override, else its ISRC, else its own ID
 *               (so a song without an ISRC has no duplicates unless one is set by hand).
 *   Works       different recordings of the same song (covers, live versions, remasters), whoever
 *               the artist. A song's work is its `work` override, else worked out from its title.
 */

/** Lower case, no accents, no punctuation, single spaces ("Café & Bar!" -> "cafe and bar"). */
export function plainText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // the accents, split off by NFD
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The work a title belongs to: the title without endings such as "(Remastered 2011)", "- Live",
 * "(feat. …)", "- From the film …", "(Radio Edit)" or "[Instrumental]", in plain text.
 * "Fly Me To The Moon (2008 Remaster)" and "Fly me to the moon" give the same work.
 */
export function workFromTitle(title) {
  return plainText(cleanTitle(title));
}

/** A title without its endings, as written (capitals and accents kept): "Moon River - Live" -> "Moon River". */
export function cleanTitle(title) {
  const fullTitle = String(title ?? "");
  const stripped = fullTitle
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // anything in brackets
    .replace(/\s[-–—]\s.*$/, " ") // " - Live", " - From the film …", " - 2011 Remaster"
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, " ") // "feat. Someone" without brackets
    .replace(/\s+/g, " ")
    .trim();
  // A title that is only an ending (e.g. "(Intro)") keeps its whole text.
  return plainText(stripped) ? stripped : fullTitle.trim();
}

/** Songs of one work, oldest release first (songs without a year last). */
export function oldestFirst(songs) {
  const releaseYear = (song) => (/^\d{4}/.test(song.released || "") ? Number(song.released.slice(0, 4)) : Infinity);
  return [...songs].sort((first, second) => releaseYear(first) - releaseYear(second) || String(first.title).localeCompare(String(second.title)));
}

/** A name given to a work by hand: a `work` override that is not just the title of one of its songs (or undefined). */
function nameGivenByHand(songs) {
  const titles = new Set(songs.map((song) => workFromTitle(song.title)));
  const named = songs.find((song) => song.work && !titles.has(plainText(song.work)));
  return named ? named.work : undefined;
}

/**
 * The name of a work (its songs given): a name given by hand, else "<title> — <artist>" of its oldest
 * version.
 */
export function workName(songs) {
  const givenName = nameGivenByHand(songs);
  if (givenName) return givenName;
  const oldest = oldestFirst(songs)[0];
  return oldest.artist ? `${cleanTitle(oldest.title)} — ${oldest.artist}` : cleanTitle(oldest.title);
}

/**
 * The text to store in a song's `work` to join an existing work: its name given by hand if it has one,
 * else the title (without endings) of its oldest song, so the keys match.
 */
export function joinValue(songs) {
  return nameGivenByHand(songs) ?? cleanTitle(oldestFirst(songs)[0].title);
}

/** The work a song belongs to (its override, else from its title). */
export const workKey = (song) => (song.work ? plainText(song.work) : workFromTitle(song.title));

/** The recording key: two songs with the same key are duplicates. */
export const recordingKey = (song) => song.recording || (song.isrc ? `isrc:${String(song.isrc).trim().toUpperCase()}` : `id:${song.id}`);

/** "Not a duplicate": a key no other song has. */
export const ownRecordingKey = (song) => `id:${song.id}`;

/**
 * Groups of songs that share a key (only groups of 2 or more), as a Map song id -> the other songs of
 * its group. `keyOf` is workKey or recordingKey.
 */
export function sameKeyGroups(songs, keyOf) {
  const songsOfKey = new Map();
  for (const song of songs) {
    const key = keyOf(song);
    if (!key) continue;
    if (!songsOfKey.has(key)) songsOfKey.set(key, []);
    songsOfKey.get(key).push(song);
  }
  const othersOfSong = new Map();
  for (const group of songsOfKey.values()) {
    if (group.length < 2) continue;
    for (const song of group) othersOfSong.set(song.id, group.filter((other) => other !== song));
  }
  return othersOfSong;
}
