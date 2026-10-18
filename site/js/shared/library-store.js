// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-store.js — each user's song library, kept in this browser per Spotify account (the agreed
 * v0.3 design, NOTES.md part B).
 *
 * A library is the user's own data only (Spotify IDs, dances, tags, work / recording corrections,
 * removed songs) plus the ID of their library playlist; Spotify's details are read from that playlist
 * (site/js/shared/song-details.js). Keyed by the Spotify user ID, so two people sharing a computer never mix
 * libraries. Browser storage can be wiped, so the library builder offers backups as files.
 *
 * Stored as { rows: [libraryRow], removed: [{ ...libraryRow, removed }], playlistId, savedAt, downloadedAt }.
 */

import { libraryRow } from "./data.js";

const PREFIX = "dpg.library.v1:";

/** The library of this Spotify account in this browser, or null. Removed songs come back as a Map id -> entry. */
export function loadUserLibrary(userId) {
  if (!userId) return null;
  try {
    const d = JSON.parse(localStorage.getItem(PREFIX + userId));
    if (!d || !Array.isArray(d.rows)) return null;
    return {
      rows: d.rows.map(libraryRow),
      removed: new Map((d.removed || []).map((e) => [e.id, { ...libraryRow(e), removed: e.removed || "" }])),
      playlistId: d.playlistId || null,
      savedAt: d.savedAt || null,
      downloadedAt: d.downloadedAt || null,
    };
  } catch {
    return null;
  }
}

/** Keep this account's library in this browser (only the user's own data). Returns the time saved. */
export function saveUserLibrary(userId, { rows, removed, playlistId }) {
  const before = loadUserLibrary(userId);
  const savedAt = new Date().toISOString();
  const data = {
    rows: rows.map(libraryRow),
    removed: [...(removed instanceof Map ? removed.values() : removed)].map((e) => ({ ...libraryRow(e), removed: e.removed || "" })),
    playlistId: playlistId || null,
    savedAt,
    downloadedAt: before ? before.downloadedAt : null,
  };
  localStorage.setItem(PREFIX + userId, JSON.stringify(data)); // throws if storage is unavailable or full: the caller says so
  return savedAt;
}

/** Note that the library was just downloaded as a backup. */
export function markDownloaded(userId) {
  try {
    const d = JSON.parse(localStorage.getItem(PREFIX + userId));
    if (!d) return;
    d.downloadedAt = new Date().toISOString();
    localStorage.setItem(PREFIX + userId, JSON.stringify(d));
  } catch {
    /* nothing to note */
  }
}

/** Whether the library has changed since its last backup download (or was never downloaded). */
export function changedSinceDownload(lib) {
  return !!lib && (!lib.downloadedAt || (lib.savedAt && lib.savedAt > lib.downloadedAt));
}
