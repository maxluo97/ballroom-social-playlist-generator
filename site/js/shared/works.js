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

/** Lowercase, no accents, no punctuation, single spaces. */
export function plainText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
  const t = String(title ?? "");
  const stripped = t
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // anything in brackets
    .replace(/\s[-–—]\s.*$/, " ") // " - Live", " - From the film …", " - 2011 Remaster"
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, " ") // "feat. Someone" without brackets
    .replace(/\s+/g, " ")
    .trim();
  return plainText(stripped) ? stripped : t.trim();
}

/** Songs of one work, oldest release first (songs without a year last). */
export function oldestFirst(songs) {
  const year = (s) => (/^\d{4}/.test(s.released || "") ? Number(s.released.slice(0, 4)) : Infinity);
  return [...songs].sort((a, b) => year(a) - year(b) || String(a.title).localeCompare(String(b.title)));
}

/**
 * The name of a work (its songs given): a name it was given by hand (a `work` override that is not
 * just the title of one of its songs), else "<title> — <artist>" of its oldest version.
 */
export function workName(songs) {
  const titles = new Set(songs.map((s) => workFromTitle(s.title)));
  const custom = songs.find((s) => s.work && !titles.has(plainText(s.work)));
  if (custom) return custom.work;
  const oldest = oldestFirst(songs)[0];
  return oldest.artist ? `${cleanTitle(oldest.title)} — ${oldest.artist}` : cleanTitle(oldest.title);
}

/**
 * The text to store in a song's `work` to join an existing work: its hand-given name if it has one,
 * else the title (without endings) of one of its songs, so the keys match.
 */
export function joinValue(songs) {
  const titles = new Set(songs.map((s) => workFromTitle(s.title)));
  const custom = songs.find((s) => s.work && !titles.has(plainText(s.work)));
  return custom ? custom.work : cleanTitle(oldestFirst(songs)[0].title);
}

/** The work a song belongs to (its override, else from its title). */
export const workKey = (song) => (song.work ? plainText(song.work) : workFromTitle(song.title));

/** The recording key: two songs with the same key are duplicates. */
export const recordingKey = (song) => song.recording || (song.isrc ? `isrc:${String(song.isrc).trim().toUpperCase()}` : `id:${song.id}`);

/** "Not a duplicate": a key no other song has. */
export const ownRecordingKey = (song) => `id:${song.id}`;

/**
 * Groups of songs that share a key (only groups of 2 or more), as a Map song id -> other songs.
 * `keyOf` is workKey or recordingKey.
 */
export function sameKeyGroups(songs, keyOf) {
  const byKey = new Map();
  for (const s of songs) {
    const k = keyOf(s);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  const out = new Map();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const s of group) out.set(s.id, group.filter((x) => x !== s));
  }
  return out;
}
