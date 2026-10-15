/**
 * library-merge.js — combine songs imported from Spotify playlists with the existing library.
 *
 * Rules:
 *   - A song is identified by its Spotify track ID.
 *   - Imports only ADD: a playlist's dances and tags are added to its songs; nothing already in
 *     the library is removed or overwritten (your manual edits in songs.csv are safe).
 *     Blank fields (artist, album, isrc, length) are filled in.
 *   - A song found in several dance playlists gets all of their dances.
 *   - Guesses (tag keyword rules, dances named in song titles) are added too, but recorded in
 *     `guessed` so the review table can highlight them for checking.
 */

import { guessDances } from "./dance-names.js";

const lower = (s) => String(s ?? "").toLowerCase();

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
 * @param options   { tagRules: [{keyword, tag}], guessTitleDances: bool, knownDances: [...] }
 * @returns rows: [{ song, status: "new"|"updated"|"unchanged", added: {dances, tags},
 *                   guessed: {dances, tags}, sources: [playlist names] }]
 *          Existing songs come first (in their order), then new songs in import order.
 */
export function mergeImport(existing, imports, { tagRules = [], guessTitleDances = false, knownDances = [] } = {}) {
  const incoming = new Map();
  for (const imp of imports) {
    for (const s of imp.songs) {
      let e = incoming.get(s.id);
      if (!e) {
        e = { base: s, dances: new Set(), tags: new Set(), guessedDances: new Set(), guessedTags: new Set(), sources: [] };
        incoming.set(s.id, e);
      }
      if (!e.sources.includes(imp.playlistName)) e.sources.push(imp.playlistName);
      (imp.dances || []).forEach((d) => e.dances.add(d));
      (imp.tags || []).forEach((t) => e.tags.add(t));
    }
  }

  // Guesses, made once per song from its title / album.
  for (const e of incoming.values()) {
    const text = `${lower(e.base.title)} ${lower(e.base.album)}`;
    for (const r of tagRules) if (text.includes(r.keyword) && !e.tags.has(r.tag)) e.guessedTags.add(r.tag);
    if (guessTitleDances) {
      for (const d of guessDances(e.base.title, knownDances)) if (!e.dances.has(d)) e.guessedDances.add(d);
    }
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
      dances: addAll(song.dances, [...e.dances, ...e.guessedDances]),
      tags: addAll(song.tags, [...e.tags, ...e.guessedTags]),
    };
    rows.push({
      song,
      status: added.dances.length || added.tags.length ? "updated" : "unchanged",
      added,
      guessed: { dances: added.dances.filter((d) => e.guessedDances.has(d)), tags: added.tags.filter((t) => e.guessedTags.has(t)) },
      sources: e.sources,
    });
  }

  for (const [id, e] of incoming) {
    if (seen.has(id)) continue;
    const b = e.base;
    const dances = [...e.dances, ...[...e.guessedDances].filter((d) => !e.dances.has(d))];
    const tags = [...e.tags, ...[...e.guessedTags].filter((t) => !e.tags.has(t))];
    const song = { id, title: b.title, artist: b.artist || "", lengthSec: b.lengthSec, dances, tags };
    if (b.album) song.album = b.album;
    if (b.isrc) song.isrc = b.isrc;
    rows.push({
      song,
      status: "new",
      added: { dances: [...dances], tags: [...tags] },
      guessed: { dances: [...e.guessedDances], tags: [...e.guessedTags] },
      sources: e.sources,
    });
  }
  return rows;
}
