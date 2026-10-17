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

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return data && data.songs ? data : null;
  } catch {
    return null;
  }
}

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
  const age = detailsAgeDays();
  return !store || age === null || age > DETAILS_KEEP_DAYS || (playlistId && store.playlistId !== playlistId);
}

/** Delete details older than DETAILS_KEEP_DAYS (they are only ever kept temporarily). */
export function forgetExpiredDetails() {
  const age = detailsAgeDays();
  if (store && (age === null || age > DETAILS_KEEP_DAYS)) {
    store = null;
    save();
  }
}

/** Read the library playlist's songs from Spotify and keep their details here. Returns the count. */
export async function refreshDetails(playlistId, onProgress) {
  const songs = await getLibraryPlaylistSongs(playlistId, onProgress);
  const map = {};
  for (const sg of songs) {
    map[sg.id] = { title: sg.title, artist: sg.artist, album: sg.album, released: sg.released, lengthSec: sg.lengthSec,
      isrc: sg.isrc, playable: sg.isPlayable !== false, reason: sg.reason || "" };
  }
  store = { playlistId, fetchedAt: new Date().toISOString(), songs: map };
  save();
  return songs.length;
}

/**
 * Add details read some other way (an import, a song added one by one, a restored song), so they
 * are shown until the next refresh. They expire with the rest.
 */
export function rememberDetails(songs) {
  if (!store) store = { playlistId: null, fetchedAt: new Date().toISOString(), songs: {} };
  for (const sg of songs) {
    const id = spotifyTrackId(sg.id);
    if (!id || !sg.title) continue;
    store.songs[id] = { title: sg.title, artist: sg.artist || "", album: sg.album || "", released: sg.released || "",
      lengthSec: sg.lengthSec, isrc: sg.isrc || "", playable: sg.isPlayable !== false, reason: "" };
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
  return rows.map((r) => {
    const d = detailsOf(r.id);
    if (!d) return { ...r, title: `Unknown song (${r.id})`, artist: "", lengthSec: 0, unknown: true };
    const { playable, reason, ...info } = d;
    return { ...info, ...r };
  });
}

/* ---------------------------------------------------- can this song play? */

/** True if Spotify said this song cannot be played in your country. */
export function isUnavailable(songId) {
  const d = detailsOf(songId);
  return !!d && d.playable === false;
}

/** True if Spotify's details (and so its availability) are known for this song. */
export const isChecked = (songId) => !!detailsOf(songId);

/** A short, plain explanation of why a song is unavailable ("" if it is not). */
export function unavailableReason(songId) {
  const d = detailsOf(songId);
  if (!d || d.playable !== false) return "";
  const why = { market: "not licensed in your country", product: "needs a different Spotify subscription", explicit: "blocked by your explicit-content setting" }[d.reason];
  return `cannot be played on Spotify${why ? ` (${why})` : d.reason ? ` (${d.reason})` : ""}`;
}
