/**
 * library-merge.js — combine songs imported from Spotify playlists with the existing library.
 *
 * Rules:
 *   - A song is identified by its Spotify track ID.
 *   - Imports only ADD: a playlist's dances and tags are added to its songs; nothing already in
 *     the library is removed or overwritten (your manual edits in songs.csv are safe).
 *     Blank fields (artist, album, isrc, length) are filled in.
 *   - A song (same track ID) found in several dance playlists gets all of their dances,
 *     e.g. a song in both a Rumba and a Cha-cha playlist gets both.
 *   - Dance names are put in their standard form ("American Rumba" -> "Rhythm Rumba").
 *   - Tags from keyword rules are added too, but recorded in `guessed` so the review table can
 *     highlight them for checking.
 */

import { canonicalDance } from "./dance-names.js";

const lower = (s) => String(s ?? "").toLowerCase();

/* ---------------------------------------------------- removed songs (blacklist) */
/*
 * Songs removed from the library are listed in data/removed-songs.csv: { id, title, artist, removed }.
 * Review rows can carry: removedNow (taken out in this session; restorable), blocked (a new import
 * of a previously removed song; left out unless re-imported), reimported (blocked, then re-imported).
 */

/** Flag imported songs that were removed from the library before: they stay out unless re-imported. */
export function markPreviouslyRemoved(rows, blacklist) {
  for (const r of rows) {
    if (r.status === "new" && blacklist.has(r.song.id)) {
      r.blocked = true;
      r.removedEntry = blacklist.get(r.song.id);
    }
  }
  return rows;
}

/** The songs to save in songs.csv: everything except removed rows and blocked imports. */
export const keptSongs = (rows) => rows.filter((r) => !r.removedNow && !r.blocked).map((r) => r.song);

/** The blacklist to save: the old one, plus songs removed now, minus songs re-imported. */
export function updatedBlacklist(blacklist, rows, today) {
  const out = new Map(blacklist);
  for (const r of rows) {
    if (r.removedNow) out.set(r.song.id, { id: r.song.id, title: r.song.title, artist: r.song.artist || "", removed: today });
    if (r.reimported) out.delete(r.song.id);
  }
  return [...out.values()];
}

/** Whether the rows change the blacklist at all (so it needs saving). */
export const blacklistChanged = (rows) => rows.some((r) => r.removedNow || r.reimported);

/** Parse tag rules written one per line as "keyword => Tag". Blank lines and # comments ignored. */
export function parseTagRules(text) {
  const rules = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(.+?)\s*=>\s*(.+)$/);
    if (m) rules.push({ keyword: m[1].trim().toLowerCase(), tag: m[2].trim() });
  }
  return rules;
}

/**
 * @param existing  current library songs ({ id, title, artist, lengthSec, dances, tags, album?, isrc? })
 * @param imports   [{ playlistName, dances: [...], tags: [...], songs: [spotify songs] }]
 * @param options   { tagRules: [{keyword, tag}] }
 * @returns rows: [{ song, status: "new"|"updated"|"unchanged", added: {dances, tags},
 *                   guessed: {dances, tags}, sources: [playlist names] }]
 *          Existing songs come first (in their order), then new songs in import order.
 */
export function mergeImport(existing, imports, { tagRules = [] } = {}) {
  const incoming = new Map();
  for (const imp of imports) {
    for (const s of imp.songs) {
      let e = incoming.get(s.id);
      if (!e) {
        e = { base: s, dances: new Set(), tags: new Set(), guessedTags: new Set(), sources: [] };
        incoming.set(s.id, e);
      }
      if (!e.sources.includes(imp.playlistName)) e.sources.push(imp.playlistName);
      (imp.dances || []).forEach((d) => e.dances.add(canonicalDance(d)));
      (imp.tags || []).forEach((t) => e.tags.add(t));
    }
  }

  // Tag rules, applied once per song to its title and album.
  for (const e of incoming.values()) {
    const text = `${lower(e.base.title)} ${lower(e.base.album)}`;
    for (const r of tagRules) if (r.keyword && r.tag && text.includes(lower(r.keyword)) && !e.tags.has(r.tag)) e.guessedTags.add(r.tag);
  }

  const rows = [];
  const seen = new Set();
  const addAll = (list, values) => {
    const added = [];
    for (const v of values) if (!list.includes(v)) (list.push(v), added.push(v));
    return added;
  };

  for (const old of existing) {
    seen.add(old.id);
    const e = incoming.get(old.id);
    const song = { ...old, dances: [...(old.dances || [])], tags: [...(old.tags || [])] };
    if (!e) {
      rows.push({ song, status: "unchanged", added: { dances: [], tags: [] }, guessed: { dances: [], tags: [] }, sources: [] });
      continue;
    }
    for (const k of ["artist", "album", "isrc"]) if (!song[k] && e.base[k]) song[k] = e.base[k];
    if (!(song.lengthSec > 0)) song.lengthSec = e.base.lengthSec;
    const added = {
      dances: addAll(song.dances, e.dances),
      tags: addAll(song.tags, [...e.tags, ...e.guessedTags]),
    };
    rows.push({
      song,
      status: added.dances.length || added.tags.length ? "updated" : "unchanged",
      added,
      guessed: { dances: [], tags: added.tags.filter((t) => e.guessedTags.has(t)) },
      sources: e.sources,
    });
  }

  for (const [id, e] of incoming) {
    if (seen.has(id)) continue;
    const b = e.base;
    const dances = [...e.dances];
    const tags = [...e.tags, ...e.guessedTags];
    const song = { id, title: b.title, artist: b.artist || "", lengthSec: b.lengthSec, dances, tags };
    if (b.album) song.album = b.album;
    if (b.isrc) song.isrc = b.isrc;
    rows.push({
      song,
      status: "new",
      added: { dances: [...dances], tags: [...tags] },
      guessed: { dances: [], tags: [...e.guessedTags] },
      sources: e.sources,
    });
  }
  return rows;
}
