/**
 * data.js — loading the song library (JSON or CSV) into the song format the generator uses:
 *   { id, title, artist, lengthSec, dances: [...], tags: [...] }
 *
 * CSV format (first row = headers, case-insensitive, extra columns ignored):
 *   id       Spotify track ID (also accepted: "track id", "spotify id", "trackId")
 *   title    song title (also: "name", "song")
 *   artist   optional
 *   length   "3:25" or seconds (also: "duration", "lengthSec")
 *   dances   one or more dances separated by ";" or "|"   e.g. "Smooth Waltz; Standard Waltz"
 *            (ballroom names are standardized on load: "American Rumba" -> "Rhythm Rumba", see dance-names.js)
 *   tags     optional, same separators                      e.g. "Hollywood; tempo change"
 *   album    optional (filled in by the library builder)
 *   released optional: the year the album came out (filled in by the library builder; names works)
 *   isrc     optional recording code from Spotify (filled in by the library builder)
 *   work     optional: which song this is a version of, overriding the one worked out from the title
 *   recording optional: overrides the ISRC for spotting duplicates (see js/works.js)
 */

import { canonicalDance } from "./dance-names.js";

const HEADER_ALIASES = {
  id: ["id", "track id", "trackid", "spotify id", "spotify_id", "spotifyid", "track_id"],
  title: ["title", "name", "song", "song title"],
  artist: ["artist", "artists"],
  length: ["length", "lengthsec", "length_sec", "duration", "time"],
  dances: ["dances", "dance"],
  tags: ["tags", "tag"],
  album: ["album"],
  released: ["released", "year"],
  isrc: ["isrc"],
  work: ["work"],
  recording: ["recording"],
};

/** Column order used when writing the song library (see songsToCSV). */
const LIBRARY_COLUMNS = ["id", "title", "artist", "album", "released", "length", "dances", "tags", "isrc", "work", "recording"];

/** Returns { songs, problems }. Never cached, so a freshly saved file is always read. */
export async function loadSongsFromUrl(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  return parseSongsText(await res.text(), url);
}

/** Parse a JSON or CSV file's text. Returns { songs, problems }. */
export function parseSongsText(text, filename = "") {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (/\.json$/i.test(filename) || trimmed.startsWith("[")) return fromRecords(JSON.parse(trimmed), "item");
  const rows = parseCSV(trimmed);
  if (rows.length < 2) return { songs: [], problems: ["The CSV file has no data rows."] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) col[key] = headers.findIndex((h) => aliases.includes(h));
  const missing = ["title", "length", "dances"].filter((k) => col[k] < 0);
  if (missing.length) return { songs: [], problems: [`The CSV file is missing column(s): ${missing.join(", ")}.`] };
  const records = rows.slice(1).map((r) => {
    const get = (k) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
    return {
      id: get("id"), title: get("title"), artist: get("artist"), length: get("length"),
      dances: get("dances"), tags: get("tags"), album: get("album"), isrc: get("isrc"),
      work: get("work"), recording: get("recording"), released: get("released"),
    };
  });
  return fromRecords(records, "row", 2);
}

/** Normalize records from JSON or CSV; skips unusable ones and reports why. */
function fromRecords(records, noun, firstNumber = 1) {
  const songs = [];
  const problems = [];
  const ids = new Set();
  records.forEach((r, i) => {
    const where = `${noun} ${i + firstNumber}`;
    if (!r || (!r.title && !r.dances)) return; // blank line
    const lengthSec = parseLength(r.lengthSec ?? r.length);
    // Standard dance names ("American Rumba" -> "Rhythm Rumba"); duplicates removed.
    const dances = [...new Set(splitList(r.dances ?? r.dance).map(canonicalDance))];
    if (!r.title) return problems.push(`${where}: no title.`);
    if (!(lengthSec > 0)) return problems.push(`${where} ("${r.title}"): length missing or not understood.`);
    if (!dances.length) return problems.push(`${where} ("${r.title}"): no dances.`);
    const rawId = String(r.id || "").trim();
    let id = spotifyTrackId(rawId) ?? (rawId || `row${i + firstNumber}`);
    if (ids.has(id)) {
      problems.push(`${where} ("${r.title}"): duplicate id ${id}; kept both.`);
      id = `${id}#${i}`;
    }
    ids.add(id);
    const song = { id, title: r.title, artist: r.artist || "", lengthSec, dances, tags: splitList(r.tags) };
    if (r.album) song.album = r.album;
    if (r.isrc) song.isrc = r.isrc;
    if (r.released) song.released = String(r.released);
    if (r.work) song.work = r.work;
    if (r.recording) song.recording = r.recording;
    songs.push(song);
  });
  return { songs, problems };
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
 * removed-songs.csv keeps the whole song (the same columns as songs.csv) plus the date it was
 * removed, so a removed song can be restored exactly as it was.
 */
const REMOVED_COLUMNS = ["id", "title", "artist", "removed", "album", "released", "length", "dances", "tags", "isrc", "work", "recording"];

/** Parse data/removed-songs.csv. Returns a Map id -> { id, title, artist, removed, album, lengthSec, dances, tags, isrc, work?, recording? }. */
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
      id,
      title: get("title"),
      artist: get("artist"),
      removed: get("removed"),
      album: get("album"),
      lengthSec: parseLength(get("length")),
      dances: [...new Set(splitList(get("dances")).map(canonicalDance))],
      tags: splitList(get("tags")),
      isrc: get("isrc"),
      ...(get("released") ? { released: get("released") } : {}),
      ...(get("work") ? { work: get("work") } : {}),
      ...(get("recording") ? { recording: get("recording") } : {}),
    });
  }
  return out;
}

/** Removed songs -> CSV text for data/removed-songs.csv. */
export function removedSongsToCSV(entries) {
  const cell = (e, c) => {
    if (c === "length") return e.lengthSec > 0 ? mmss(e.lengthSec) : "";
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
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** Song library -> CSV text in the format parseSongsText reads (lists joined with "; "). */
export function songsToCSV(songs) {
  const lines = [LIBRARY_COLUMNS.join(",")];
  for (const s of songs) {
    const row = {
      id: s.id,
      title: s.title,
      artist: s.artist ?? "",
      album: s.album ?? "",
      released: s.released ?? "",
      length: mmss(s.lengthSec),
      dances: (s.dances || []).join("; "),
      tags: (s.tags || []).join("; "),
      isrc: s.isrc ?? "",
      work: s.work ?? "",
      recording: s.recording ?? "",
    };
    lines.push(LIBRARY_COLUMNS.map((c) => esc(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Playlist -> CSV text (for download). */
export function playlistToCSV(result) {
  const lines = [["#", "start", "dance", "type", "title", "artist", "length", "spotify id", "spotify link"].join(",")];
  for (const it of result.playlist) {
    const fmt = mmss;
    lines.push(
      [it.index + 1, fmt(it.startSec), it.dance, it.category ?? it.source ?? it.kind, it.song.title, it.song.artist ?? "", fmt(it.song.lengthSec), it.song.id, spotifyLink(it.song.id) ?? ""]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}
