// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * data.js — the song library files and their format.
 *
 * The library files hold only Spotify IDs and the user's own data: Spotify's Developer Terms do not
 * allow storing Spotify Content (titles, artists, lengths, …) indefinitely. Spotify's details are
 * read from the library playlist and kept in the browser only temporarily (site/js/shared/song-details.js);
 * withDetails() there turns these rows into full songs for the generator.
 *
 * data/songs.csv (first row = headers, case-insensitive, extra columns ignored):
 *   id        Spotify track ID (also accepted: a "spotify:track:" URI or an open.spotify.com link)
 *   dances    one or more dances separated by ";" or "|"   e.g. "Smooth Waltz; Standard Waltz"
 *             (ballroom names are standardized on load: "American Rumba" -> "Rhythm Rumba", see dance-names.js)
 *   tags      optional, same separators                      e.g. "Hollywood; tempo change"
 *   work      optional: which song this is a version of, overriding the one worked out from the title
 *   recording optional: overrides the ISRC for spotting duplicates (see site/js/shared/works.js)
 * data/removed-songs.csv: the same, plus "removed" (the date). data/library.json: the library
 * playlist's ID ({ "playlistId": "…" }).
 */

import { canonicalDance } from "./dance-names.js";

const HEADER_ALIASES = {
  id: ["id", "track id", "trackid", "spotify id", "spotify_id", "spotifyid", "track_id"],
  dances: ["dances", "dance"],
  tags: ["tags", "tag"],
  work: ["work"],
  recording: ["recording"],
};

/** Column order used when writing the song library (see songsToCSV). */
const LIBRARY_COLUMNS = ["id", "dances", "tags", "work", "recording"];

/** Returns { songs, problems }: library rows (no Spotify details). Never cached, so a freshly saved file is always read. */
export async function loadSongsFromUrl(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  return parseSongsText(await res.text(), url);
}

/** Parse songs.csv's text into library rows. Returns { songs, problems }. */
export function parseSongsText(text) {
  const rows = parseCSV(text.replace(/^\uFEFF/, "").trim());
  if (rows.length < 2) return { songs: [], problems: ["The CSV file has no data rows."] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) col[key] = headers.findIndex((h) => aliases.includes(h));
  const missing = ["id", "dances"].filter((k) => col[k] < 0);
  if (missing.length) return { songs: [], problems: [`The CSV file is missing column(s): ${missing.join(", ")}.`] };
  const records = rows.slice(1).map((r) => {
    const get = (k) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
    return { id: get("id"), dances: get("dances"), tags: get("tags"), work: get("work"), recording: get("recording") };
  });
  return fromRecords(records, "row", 2);
}

/** Normalize records; skips unusable ones and reports why. */
function fromRecords(records, noun, firstNumber = 1) {
  const songs = [];
  const problems = [];
  const ids = new Set();
  records.forEach((r, i) => {
    const where = `${noun} ${i + firstNumber}`;
    if (!r || (!r.id && !r.dances)) return; // blank line
    const id = spotifyTrackId(r.id);
    // Standard dance names ("American Rumba" -> "Rhythm Rumba"); duplicates removed.
    const dances = [...new Set(splitList(r.dances).map(canonicalDance))];
    if (!id) return problems.push(`${where}: "${r.id}" is not a Spotify track ID.`);
    if (!dances.length) return problems.push(`${where} (${id}): no dances.`);
    if (ids.has(id)) return problems.push(`${where}: ${id} is listed twice; the second one was left out.`);
    ids.add(id);
    songs.push(libraryRow({ id, dances, tags: splitList(r.tags), work: r.work, recording: r.recording }));
  });
  return { songs, problems };
}

/** A library row: the ID and the user's own data only (what the library files may store). */
export function libraryRow(s) {
  const row = { id: s.id, dances: [...(s.dances || [])], tags: [...(s.tags || [])] };
  if (s.work) row.work = s.work;
  if (s.recording) row.recording = s.recording;
  return row;
}

function splitList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? "")
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "3:25" -> 205, "1:02:03" -> 3723, "205" -> 205. */
export function parseLength(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  if (s.includes(":")) return s.split(":").reduce((t, part) => t * 60 + Number(part), 0);
  return Number(s);
}

/** Minimal CSV parser: handles quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/* ------------------------------------------- removed songs (data/removed-songs.csv) */

/*
 * removed-songs.csv keeps the song's library row (the same columns as songs.csv) plus the date it
 * was removed, so a removed song can be restored with its dances, tags and corrections.
 */
const REMOVED_COLUMNS = ["id", "removed", "dances", "tags", "work", "recording"];

/** Parse data/removed-songs.csv. Returns a Map id -> { id, removed, dances, tags, work?, recording? }. */
export function parseRemovedSongs(text) {
  const rows = parseCSV(String(text).replace(/^﻿/, "").trim());
  const out = new Map();
  if (rows.length < 2) return out;
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(REMOVED_COLUMNS.map((c) => [c, headers.indexOf(c)]));
  for (const r of rows.slice(1)) {
    const get = (c) => (col[c] >= 0 ? (r[col[c]] ?? "").trim() : "");
    const id = spotifyTrackId(get("id")) ?? get("id");
    if (!id) continue;
    out.set(id, {
      ...libraryRow({ id, dances: [...new Set(splitList(get("dances")).map(canonicalDance))], tags: splitList(get("tags")), work: get("work"), recording: get("recording") }),
      removed: get("removed"),
    });
  }
  return out;
}

/** Removed songs -> CSV text for data/removed-songs.csv. */
export function removedSongsToCSV(entries) {
  const cell = (e, c) => {
    if (c === "dances" || c === "tags") return (e[c] || []).join("; ");
    return e[c] ?? "";
  };
  return [REMOVED_COLUMNS.join(","), ...entries.map((e) => REMOVED_COLUMNS.map((c) => esc(cell(e, c))).join(","))].join("\n") + "\n";
}

/**
 * The 22-character Spotify track ID from a bare ID, a "spotify:track:..." URI, or an
 * open.spotify.com track link (with or without "?si=..." or a locale segment). Otherwise null.
 */
export function spotifyTrackId(value) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(?:spotify:track:|https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)?([A-Za-z0-9]{22})(?:[?#].*)?$/);
  return m ? m[1] : null;
}

/** Shareable link for a track ID, or null if the ID is not a real Spotify ID. */
export function spotifyLink(id) {
  const t = spotifyTrackId(id);
  return t ? `https://open.spotify.com/track/${t}` : null;
}

const esc = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Song library -> CSV text in the format parseSongsText reads (lists joined with "; "). Only IDs and the user's own data. */
export function songsToCSV(songs) {
  const lines = [LIBRARY_COLUMNS.join(",")];
  for (const s of songs) {
    const r = libraryRow(s);
    const row = { id: r.id, dances: r.dances.join("; "), tags: r.tags.join("; "), work: r.work ?? "", recording: r.recording ?? "" };
    lines.push(LIBRARY_COLUMNS.map((k) => esc(row[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

/* ---------------------------------------------- the library playlist (data/library.json) */

/** Read data/library.json: { playlistId } (the library playlist's ID, or null). */
export function parseLibraryInfo(text) {
  try {
    const d = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    return { playlistId: d && typeof d.playlistId === "string" && d.playlistId ? d.playlistId : null };
  } catch {
    return { playlistId: null };
  }
}

export const libraryInfoText = (info) => JSON.stringify({ playlistId: info.playlistId || null }, null, 2) + "\n";
