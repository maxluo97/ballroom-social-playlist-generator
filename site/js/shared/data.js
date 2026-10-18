// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * data.js — the song library files and their format, and Spotify IDs and links.
 *
 * The library files hold only Spotify IDs and the user's own data: Spotify's Developer Terms do not
 * allow storing Spotify Content (titles, artists, lengths, …) indefinitely. Spotify's details are read
 * from the library playlist and kept in the browser only temporarily (site/js/shared/song-details.js);
 * withDetails() there turns these rows into full songs for the generator.
 *
 * data/songs.csv (first row = headers, any capitals, extra columns ignored):
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

/** The headings each column may have in songs.csv. */
const HEADER_ALIASES = {
  id: ["id", "track id", "trackid", "spotify id", "spotify_id", "spotifyid", "track_id"],
  dances: ["dances", "dance"],
  tags: ["tags", "tag"],
  work: ["work"],
  recording: ["recording"],
};

/** The column order used when writing the song library (see songsToCSV). */
const LIBRARY_COLUMNS = ["id", "dances", "tags", "work", "recording"];

/** A file's text without the invisible "byte order mark" some editors put at the start. */
const withoutByteOrderMark = (text) => String(text).replace(/^﻿/, "");

/** Read songs.csv from a web address. Returns { songs, problems }: library rows (no Spotify details). Never cached, so a freshly saved file is always read. */
export async function loadSongsFromUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  return parseSongsText(await response.text());
}

/** Parse songs.csv's text into library rows. Returns { songs, problems }. */
export function parseSongsText(text) {
  const rows = parseCSV(withoutByteOrderMark(text).trim());
  if (rows.length < 2) return { songs: [], problems: ["The CSV file has no data rows."] };
  const headers = rows[0].map((heading) => heading.trim().toLowerCase());
  const columnOf = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) columnOf[key] = headers.findIndex((heading) => aliases.includes(heading));
  const missing = ["id", "dances"].filter((key) => columnOf[key] < 0);
  if (missing.length) return { songs: [], problems: [`The CSV file is missing column(s): ${missing.join(", ")}.`] };
  const records = rows.slice(1).map((cells) => {
    const cell = (key) => (columnOf[key] >= 0 ? (cells[columnOf[key]] ?? "").trim() : "");
    return { id: cell("id"), dances: cell("dances"), tags: cell("tags"), work: cell("work"), recording: cell("recording") };
  });
  return fromRecords(records, "row", 2);
}

/**
 * Library rows from records ({ id, dances, tags, work, recording } as text); unusable ones are skipped,
 * with the reason. `noun` and `firstNumber` name a record in the problems ("row 2").
 */
function fromRecords(records, noun, firstNumber = 1) {
  const songs = [];
  const problems = [];
  const seenIds = new Set();
  records.forEach((record, iRecord) => {
    const where = `${noun} ${iRecord + firstNumber}`;
    if (!record || (!record.id && !record.dances)) return; // a blank line
    const id = spotifyTrackId(record.id);
    // Standard dance names ("American Rumba" -> "Rhythm Rumba"); duplicates removed.
    const dances = [...new Set(splitList(record.dances).map(canonicalDance))];
    if (!id) return problems.push(`${where}: "${record.id}" is not a Spotify track ID.`);
    if (!dances.length) return problems.push(`${where} (${id}): no dances.`);
    if (seenIds.has(id)) return problems.push(`${where}: ${id} is listed twice; the second one was left out.`);
    seenIds.add(id);
    songs.push(libraryRow({ id, dances, tags: splitList(record.tags), work: record.work, recording: record.recording }));
  });
  return { songs, problems };
}

/** A library row: the ID and the user's own data only (what the library files may store). */
export function libraryRow(song) {
  const row = { id: song.id, dances: [...(song.dances || [])], tags: [...(song.tags || [])] };
  if (song.work) row.work = song.work;
  if (song.recording) row.recording = song.recording;
  return row;
}

/** A list from an array or from text separated by ";" or "|" (items trimmed, empty ones left out). */
function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A length in seconds: "3:25" -> 205, "1:02:03" -> 3723, "205" -> 205 (NaN if empty or not a length). */
export function parseLength(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  if (text.includes(":")) return text.split(":").reduce((totalSec, part) => totalSec * 60 + Number(part), 0);
  return Number(text);
}

/** A minimal CSV reader: quoted fields, "" inside quotes, commas and line breaks inside quotes. Blank rows are left out. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let iChar = 0; iChar < text.length; iChar++) {
    const char = text[iChar];
    if (inQuotes) {
      if (char === '"' && text[iChar + 1] === '"') {
        field += '"'; // "" inside quotes is one quote
        iChar++;
      } else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[iChar + 1] === "\n") iChar++; // a Windows line break is two characters
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** A CSV cell: quoted if it holds a quote, comma or line break (quotes doubled). */
const csvCell = (value) => (/[",\n\r]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/* ------------------------------------------- removed songs (data/removed-songs.csv) */

/*
 * removed-songs.csv keeps the song's library row (the same columns as songs.csv) plus the date it was
 * removed, so a removed song can be restored with its dances, tags and corrections.
 */
const REMOVED_COLUMNS = ["id", "removed", "dances", "tags", "work", "recording"];

/** Parse data/removed-songs.csv. Returns a Map id -> { id, removed, dances, tags, work?, recording? }. */
export function parseRemovedSongs(text) {
  const rows = parseCSV(withoutByteOrderMark(text).trim());
  const removedById = new Map();
  if (rows.length < 2) return removedById;
  const headers = rows[0].map((heading) => heading.trim().toLowerCase());
  const columnOf = Object.fromEntries(REMOVED_COLUMNS.map((column) => [column, headers.indexOf(column)]));
  for (const cells of rows.slice(1)) {
    const cell = (column) => (columnOf[column] >= 0 ? (cells[columnOf[column]] ?? "").trim() : "");
    const id = spotifyTrackId(cell("id")) ?? cell("id");
    if (!id) continue;
    removedById.set(id, {
      ...libraryRow({ id, dances: [...new Set(splitList(cell("dances")).map(canonicalDance))], tags: splitList(cell("tags")), work: cell("work"), recording: cell("recording") }),
      removed: cell("removed"),
    });
  }
  return removedById;
}

/** Removed songs -> the text of data/removed-songs.csv. */
export function removedSongsToCSV(entries) {
  const cellText = (entry, column) => {
    if (column === "dances" || column === "tags") return (entry[column] || []).join("; ");
    return entry[column] ?? "";
  };
  return [REMOVED_COLUMNS.join(","), ...entries.map((entry) => REMOVED_COLUMNS.map((column) => csvCell(cellText(entry, column))).join(","))].join("\n") + "\n";
}

/* ---------------------------------------------------------- Spotify IDs */

/**
 * The 22-character Spotify track ID from a bare ID, a "spotify:track:..." URI, or an open.spotify.com
 * track link (with or without "?si=..." or a language part such as "intl-de"). Otherwise null.
 */
export function spotifyTrackId(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(?:spotify:track:|https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)?([A-Za-z0-9]{22})(?:[?#].*)?$/);
  return match ? match[1] : null;
}

/** The shareable link for a track ID, or null if it is not a real Spotify ID. */
export function spotifyLink(id) {
  const trackId = spotifyTrackId(id);
  return trackId ? `https://open.spotify.com/track/${trackId}` : null;
}

/** Song library -> the text of songs.csv, in the format parseSongsText reads (lists joined with "; "). Only IDs and the user's own data. */
export function songsToCSV(songs) {
  const lines = [LIBRARY_COLUMNS.join(",")];
  for (const song of songs) {
    const row = libraryRow(song);
    const cells = { id: row.id, dances: row.dances.join("; "), tags: row.tags.join("; "), work: row.work ?? "", recording: row.recording ?? "" };
    lines.push(LIBRARY_COLUMNS.map((column) => csvCell(cells[column])).join(","));
  }
  return lines.join("\n") + "\n";
}

/* ---------------------------------------------- the library playlist (data/library.json) */

/** Read data/library.json: { playlistId } (the library playlist's ID, or null). */
export function parseLibraryInfo(text) {
  try {
    const info = JSON.parse(withoutByteOrderMark(text));
    return { playlistId: info && typeof info.playlistId === "string" && info.playlistId ? info.playlistId : null };
  } catch {
    return { playlistId: null };
  }
}

/** The text of data/library.json. */
export const libraryInfoText = (info) => JSON.stringify({ playlistId: info.playlistId || null }, null, 2) + "\n";
