/**
 * availability.js — whether songs can still be played on Spotify, remembered in this browser.
 *
 * The generator checks the songs of each playlist it makes (about 50 for a 3-hour night) and
 * replaces unavailable ones; the library builder shows what has been learned so far.
 * Stored as { results: { trackId: { status, reason?, playsAs?, message?, checkedAt } } }.
 * Statuses (see checkTrackAvailability in js/spotify.js):
 *   ok, relinked (Spotify plays another version itself: fine), unplayable, missing, error.
 */

import { checkTrackAvailability } from "./spotify.js";
import { spotifyTrackId } from "./data.js";

const KEY = "dpg.availability.v1";

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return (data && data.results) || {};
  } catch {
    return {};
  }
}

let results = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ results }));
  } catch {
    /* storage unavailable: results last for this page view only */
  }
}

/** Re-read the stored results (another page may have checked songs since). */
export function reloadAvailability() {
  results = load();
}

/** The last check of this song, or null if it was never checked. */
export function availabilityOf(songId) {
  const id = spotifyTrackId(songId);
  return (id && results[id]) || null;
}

/** True if Spotify said this song cannot be played (not licensed here, or gone). */
export function isUnavailable(songId) {
  const a = availabilityOf(songId);
  return !!a && (a.status === "unplayable" || a.status === "missing");
}

/** A short, plain explanation of why a song is unavailable ("" if it is not). */
export function unavailableReason(songId) {
  const a = availabilityOf(songId);
  if (!a) return "";
  if (a.status === "missing") return "no longer on Spotify";
  if (a.status !== "unplayable") return "";
  const why = { market: "not licensed in your country", product: "needs a different Spotify subscription", explicit: "blocked by your explicit-content setting" }[a.reason];
  return `cannot be played on Spotify${why ? ` (${why})` : a.reason ? ` (${a.reason})` : ""}`;
}

/** All stored results (for summaries). */
export const allAvailability = () => results;

/**
 * Check songs on Spotify, four at a time, and remember the results.
 * `onProgress(done, total)` reports progress; `shouldStop()` can end it early (results so far are kept).
 * Returns { trackId: result } for the songs checked.
 */
export async function checkSongs(songIds, { onProgress = () => {}, shouldStop = () => false } = {}) {
  const ids = [...new Set(songIds.map(spotifyTrackId).filter(Boolean))];
  const today = new Date().toISOString().slice(0, 10);
  const found = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (!shouldStop() && next < ids.length) {
      const id = ids[next++];
      found[id] = { ...(await checkTrackAvailability(id)), checkedAt: today };
      results[id] = found[id];
      onProgress(++done, ids.length);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  save();
  return found;
}
