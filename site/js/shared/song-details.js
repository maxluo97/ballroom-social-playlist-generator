// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * song-details.js — Spotify's details of the library's songs, kept in this browser only temporarily.
 *
 * Spotify's Developer Terms do not allow storing Spotify Content (titles, artists, lengths, …)
 * indefinitely, so the library files hold only Spotify IDs and the user's own data (dances, tags,
 * works). The details are read from the library playlist (one playlist in the user's account that
 * holds the whole library, kept in step by the library builder), 50 songs per request, and kept here
 * for at most DETAILS_KEEP_DAYS (the agreed design, NOTES.md v0.3 item 1).
 *
 * Stored as { playlistId, fetchedAt, songs: { trackId: { title, artist, album, released, lengthSec,
 * isrc, playable, reason } } }. `playable` is Spotify's is_playable for the user's country.
 *
 * Also answers "can this song play?" for the rest of the app (isUnavailable and friends), from the
 * same refresh: there is no separate song-by-song availability check any more.
 */

import { getLibraryPlaylistSongs } from "./spotify.js";
import { spotifyTrackId } from "./data.js";

const KEY = "dpg.songDetails.v1";

/** How long Spotify's details are kept in this browser before they are read again. */
export const DETAILS_KEEP_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

/** The details kept in this browser, or null. */
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    return stored && stored.songs ? stored : null;
  } catch {
    return null;
  }
}

/** This page's copy of the details (see the format above), or null. */
let store = load();

function save() {
  try {
    if (store) localStorage.setItem(KEY, JSON.stringify(store));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the details last for this page view only */
  }
}

/** Forget every detail now (e.g. on logging out: they were read with that Spotify account). */
export function clearDetails() {
  store = null;
  save();
}

/** Re-read the stored details (another page may have refreshed them). */
export function reloadDetails() {
  store = load();
}

/** Days since the details were read, or null if there are none. */
export function detailsAgeDays() {
  return store && store.fetchedAt ? (Date.now() - Date.parse(store.fetchedAt)) / DAY_MS : null;
}

/** Whether the details need reading (none, too old, or from another library playlist). */
export function detailsNeedRefresh(playlistId) {
  const ageDays = detailsAgeDays();
  return !store || ageDays === null || ageDays > DETAILS_KEEP_DAYS || (playlistId && store.playlistId !== playlistId);
}

/** Delete details older than DETAILS_KEEP_DAYS (they are only ever kept temporarily). */
export function forgetExpiredDetails() {
  const ageDays = detailsAgeDays();
  if (store && (ageDays === null || ageDays > DETAILS_KEEP_DAYS)) {
    store = null;
    save();
  }
}

/**
 * Read the library playlist's songs from Spotify and keep their details here. `libraryIds` (the
 * library's song IDs) lets a song that Spotify relinked to another version keep its own ID. Returns the count.
 */
export async function refreshDetails(playlistId, onProgress, libraryIds = null) {
  const songs = await getLibraryPlaylistSongs(playlistId, onProgress, libraryIds);
  const detailsById = {};
  for (const song of songs) {
    detailsById[song.id] = { title: song.title, artist: song.artist, album: song.album, released: song.released, lengthSec: song.lengthSec,
      isrc: song.isrc, playable: song.isPlayable !== false, reason: song.reason || "" };
  }
  store = { playlistId, fetchedAt: new Date().toISOString(), songs: detailsById };
  save();
  return songs.length;
}

/**
 * Add details read some other way (an import, a song added one by one, a restored song), so they
 * are shown until the next refresh. They expire with the rest.
 */
export function rememberDetails(songs) {
  if (!store) store = { playlistId: null, fetchedAt: new Date().toISOString(), songs: {} };
  for (const song of songs) {
    const id = spotifyTrackId(song.id);
    if (!id || !song.title) continue;
    store.songs[id] = { title: song.title, artist: song.artist || "", album: song.album || "", released: song.released || "",
      lengthSec: song.lengthSec, isrc: song.isrc || "", playable: song.isPlayable !== false, reason: "" };
  }
  save();
}

/** The details of one song, or null if they are not known (yet). */
export function detailsOf(songId) {
  const id = spotifyTrackId(songId);
  return (store && id && store.songs[id]) || null;
}

/**
 * Library rows (id + the user's own data) with Spotify's details added, as full songs. A row whose
 * details are not known is marked `unknown` ("Unknown song (ID)", no length): it cannot be generated.
 */
export function withDetails(rows) {
  return rows.map((row) => {
    const details = detailsOf(row.id);
    if (!details) return { ...row, title: `Unknown song (${row.id})`, artist: "", lengthSec: 0, unknown: true };
    const { playable, reason, ...info } = details;
    return { ...info, ...row };
  });
}

/* ---------------------------------------------------- can this song play? */

/** True if Spotify said this song cannot be played in your country. */
export function isUnavailable(songId) {
  const details = detailsOf(songId);
  return !!details && details.playable === false;
}

/** True if Spotify's details (and so its availability) are known for this song. */
export const isChecked = (songId) => !!detailsOf(songId);

/** A short, plain explanation of why a song is unavailable ("" if it is not). */
export function unavailableReason(songId) {
  const details = detailsOf(songId);
  if (!details || details.playable !== false) return "";
  // Spotify's reasons, in plain words.
  const why = { market: "not licensed in your country", product: "needs a different Spotify subscription", explicit: "blocked by your explicit-content setting" }[details.reason];
  return `cannot be played on Spotify${why ? ` (${why})` : details.reason ? ` (${details.reason})` : ""}`;
}
