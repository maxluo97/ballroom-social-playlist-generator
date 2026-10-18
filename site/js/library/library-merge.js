// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-merge.js — combine songs imported from Spotify playlists with the existing library, and keep
 * track of removed songs.
 *
 * Rules:
 *   - A song is identified by its Spotify track ID.
 *   - Imports only ADD: a playlist's dances and tags are added to its songs; nothing already in the
 *     library is removed or overwritten (your own edits are safe). Blank fields (artist, album, isrc,
 *     released, length) are filled in.
 *   - A song (same track ID) found in several dance playlists gets all of their dances, e.g. a song in
 *     both a Rumba and a Cha-cha playlist gets both.
 *   - Dance names are put in their standard form ("American Rumba" -> "Rhythm Rumba").
 *   - Tags from keyword rules are added too, but recorded in `guessed`, so the review table can
 *     highlight them for checking.
 */

import { libraryRow } from "../shared/data.js";
import { canonicalDance } from "../shared/dance-names.js";

const lowerCase = (text) => String(text ?? "").toLowerCase();

/* ---------------------------------------------------- removed songs (blacklist) */
/*
 * Songs removed from the library are kept on a list (removed-songs.csv): their library row plus the
 * date removed. Review rows can carry: removedNow (taken out in this session; restorable), blocked (a
 * new import of a previously removed song; left out unless re-imported), reimported (blocked, then
 * re-imported).
 */

/** Flag imported songs that were removed from the library before: they stay out unless re-imported. */
export function markPreviouslyRemoved(rows, blacklist) {
  for (const row of rows) {
    if (row.status === "new" && blacklist.has(row.song.id)) {
      row.blocked = true;
      row.removedEntry = blacklist.get(row.song.id);
    }
  }
  return rows;
}

/** The songs to save: everything except removed rows and blocked imports. */
export const keptSongs = (rows) => rows.filter((row) => !row.removedNow && !row.blocked).map((row) => row.song);

/** The removed-songs list to save: the old one, plus songs removed now, minus songs re-imported or restored. */
export function updatedBlacklist(blacklist, rows, today) {
  const updated = new Map(blacklist);
  for (const row of rows) {
    if (row.removedNow) {
      // The library row is kept (no Spotify details), so it can be restored with its dances and tags.
      updated.set(row.song.id, { ...libraryRow(row.song), removed: today });
    }
    if (row.reimported) updated.delete(row.song.id);
  }
  return [...updated.values()];
}

/**
 * Review rows for removed songs that are not otherwise in the review (not in the library, not in this
 * import): left out, but each can be restored ("re-imported"), which takes it off the list.
 */
export function blacklistRows(rows, blacklist) {
  const inReview = new Set(rows.map((row) => row.song.id));
  const extraRows = [];
  for (const entry of blacklist.values()) {
    if (inReview.has(entry.id)) continue;
    extraRows.push({
      song: libraryRow(entry), // Spotify's details are added for display (site/js/shared/song-details.js)
      status: "blacklisted",
      added: { dances: [], tags: [] },
      guessed: { dances: [], tags: [] },
      sources: [],
      blocked: true,
      fromBlacklist: true,
      removedEntry: entry,
    });
  }
  return extraRows;
}

/**
 * @param existing  the current library's songs ({ id, title, artist, lengthSec, dances, tags, album?, isrc? })
 * @param imports   [{ playlistName, dances: [...], tags: [...], songs: [songs from Spotify] }]
 * @param options   { tagRules: [{ keyword, tag }] }
 * @returns rows: [{ song, status: "new"|"updated"|"unchanged", added: { dances, tags },
 *                   guessed: { dances, tags }, sources: [playlist names] }]
 *          Existing songs come first (in their order), then new songs in import order.
 */
export function mergeImport(existing, imports, { tagRules = [] } = {}) {
  // Every imported song once, with all the dances and tags of the playlists it came from.
  const incoming = new Map();
  for (const playlistImport of imports) {
    for (const song of playlistImport.songs) {
      let entry = incoming.get(song.id);
      if (!entry) {
        entry = { base: song, dances: new Set(), tags: new Set(), guessedTags: new Set(), sources: [] };
        incoming.set(song.id, entry);
      }
      if (!entry.sources.includes(playlistImport.playlistName)) entry.sources.push(playlistImport.playlistName);
      (playlistImport.dances || []).forEach((dance) => entry.dances.add(canonicalDance(dance)));
      (playlistImport.tags || []).forEach((tag) => entry.tags.add(tag));
    }
  }

  // Tag rules, applied once per song to its title and album.
  for (const entry of incoming.values()) {
    const titleAndAlbum = `${lowerCase(entry.base.title)} ${lowerCase(entry.base.album)}`;
    for (const rule of tagRules) {
      if (rule.keyword && rule.tag && titleAndAlbum.includes(lowerCase(rule.keyword)) && !entry.tags.has(rule.tag)) entry.guessedTags.add(rule.tag);
    }
  }

  const rows = [];
  const inLibrary = new Set();
  /** Add the values missing from a list; returns the ones added. */
  const addMissing = (list, values) => {
    const added = [];
    for (const value of values) if (!list.includes(value)) (list.push(value), added.push(value));
    return added;
  };

  for (const librarySong of existing) {
    inLibrary.add(librarySong.id);
    const entry = incoming.get(librarySong.id);
    const song = { ...librarySong, dances: [...(librarySong.dances || [])], tags: [...(librarySong.tags || [])] };
    if (!entry) {
      rows.push({ song, status: "unchanged", added: { dances: [], tags: [] }, guessed: { dances: [], tags: [] }, sources: [] });
      continue;
    }
    for (const field of ["artist", "album", "isrc", "released"]) if (!song[field] && entry.base[field]) song[field] = entry.base[field];
    if (!(song.lengthSec > 0)) song.lengthSec = entry.base.lengthSec;
    const added = {
      dances: addMissing(song.dances, entry.dances),
      tags: addMissing(song.tags, [...entry.tags, ...entry.guessedTags]),
    };
    rows.push({
      song,
      status: added.dances.length || added.tags.length ? "updated" : "unchanged",
      added,
      guessed: { dances: [], tags: added.tags.filter((tag) => entry.guessedTags.has(tag)) },
      sources: entry.sources,
    });
  }

  for (const [id, entry] of incoming) {
    if (inLibrary.has(id)) continue;
    const base = entry.base;
    const dances = [...entry.dances];
    const tags = [...entry.tags, ...entry.guessedTags];
    const song = { id, title: base.title, artist: base.artist || "", lengthSec: base.lengthSec, dances, tags };
    if (base.album) song.album = base.album;
    if (base.isrc) song.isrc = base.isrc;
    if (base.released) song.released = base.released;
    rows.push({
      song,
      status: "new",
      added: { dances: [...dances], tags: [...tags] },
      guessed: { dances: [], tags: [...entry.guessedTags] },
      sources: entry.sources,
    });
  }
  return rows;
}
