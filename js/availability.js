/**
 * availability.js — whether songs can still be played on Spotify, remembered in this browser.
 *
 * The generator checks the songs of each playlist it makes and replaces unavailable ones; the
 * library builder shows what has been learned so far.
 * Stored as { results: { trackId: { status, reason?, playsAs?, message?, checkedAt } } }.
 * Statuses (see checkTrackAvailability in js/spotify.js):
 *   ok, relinked (Spotify plays another version itself: fine), unplayable, missing,
 *   error (could not be checked, e.g. Spotify was limiting requests: NOT a result, checked again later).
 *
 * To spare Spotify's request limit, a song checked recently (see `maxAgeDays`) is not looked up
 * again unless asked, and lookups go two at a time and stop as soon as Spotify asks for a long wait.
 */

import { checkTrackAvailability } from "./spotify.js";
import { spotifyTrackId } from "./data.js";

const KEY = "dpg.availability.v1";

/** After generating, songs checked within this many days are not looked up again. */
export const RECHECK_AFTER_DAYS = 7;

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

/** The last check of this song (possibly an "error"), or null if it was never checked. */
export function availabilityOf(songId) {
  const id = spotifyTrackId(songId);
  return (id && results[id]) || null;
}

/** True if Spotify gave an answer for this song (a failed lookup does not count). */
export function isChecked(songId) {
  const a = availabilityOf(songId);
  return !!a && a.status !== "error";
}

/** True if this song could not be checked the last time (Spotify did not answer). */
export function checkFailed(songId) {
  const a = availabilityOf(songId);
  return !!a && a.status === "error";
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

const daysSince = (date) => (Date.now() - Date.parse(date)) / 86400e3;

/**
 * Check songs on Spotify, two at a time, and remember the results.
 *   maxAgeDays   skip songs successfully checked within this many days (0 = check all)
 *   onProgress(done, total), shouldStop() as usual (results so far are kept).
 * Stops early if Spotify asks for a long wait. Returns
 *   { results: { trackId: result }, rateLimited: null | { retryAfter: seconds } }.
 */
export async function checkSongs(songIds, { onProgress = () => {}, shouldStop = () => false, maxAgeDays = 0 } = {}) {
  const ids = [...new Set(songIds.map(spotifyTrackId).filter(Boolean))].filter((id) =>
    !(maxAgeDays > 0 && isChecked(id) && daysSince(results[id].checkedAt) <= maxAgeDays));
  const today = new Date().toISOString().slice(0, 10);
  const found = {};
  let rateLimited = null;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (!shouldStop() && !rateLimited && next < ids.length) {
      const id = ids[next++];
      const result = { ...(await checkTrackAvailability(id)), checkedAt: today };
      // A failed lookup never replaces a real answer from before.
      if (result.status !== "error" || !isChecked(id)) results[id] = result;
      found[id] = result;
      if (result.rateLimited) rateLimited = { retryAfter: result.retryAfter || 0 };
      onProgress(++done, ids.length);
    }
  };
  await Promise.all([1, 2].map(worker));
  save();
  return { results: found, rateLimited };
}
