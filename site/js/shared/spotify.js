// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * spotify.js — Spotify login (Authorization Code with PKCE) and the Web API calls the app uses.
 *
 * Checked against developer.spotify.com, Oct 2026 (Development Mode rules from Feb 2026):
 *   - authorize:  GET  https://accounts.spotify.com/authorize   (response_type=code, S256 challenge)
 *   - token:      POST https://accounts.spotify.com/api/token   (form-encoded; no client secret)
 *   - playlists:  GET  /me/playlists                (max 50 per page; song count in items.total)
 *   - songs:      GET  /playlists/{id}/items        (max 50 per page; song in items[].item;
 *                 only for playlists you own or collaborate on, otherwise 403)
 *   - playing:    GET  /me/player/currently-playing (scope user-read-currently-playing; free accounts
 *                 too; 204 when nothing is playing)
 *
 * How login works, in plain terms:
 *   1. login() makes a random secret (the "verifier"), keeps it in this tab, and sends the browser
 *      to Spotify with a scrambled form of it (the "challenge").
 *   2. You approve on Spotify's page; Spotify sends the browser back to the app's root page
 *      with a one-time "code" in the address.
 *   3. handleLoginRedirect() (run by every page at startup) trades code + verifier for an
 *      access token (valid about an hour) and a refresh token (used to get new access tokens),
 *      then returns you to the page where you clicked "Log in".
 * Tokens are kept in this browser's localStorage, so you stay logged in until you log out.
 * Several windows of the app (the generator and the live screens) share them: a window always uses
 * the newest tokens in storage, and only one window at a time renews them, because Spotify may
 * replace the refresh token on each renewal (an old one then no longer works).
 */

import { spotifyClientId, SPOTIFY_REDIRECT_URI } from "./config.js";
import { ensureAgreement } from "./agreement.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";

const TOKENS_KEY = "dpg.spotify.tokens.v1";
const PENDING_KEY = "dpg.spotify.pending.v1"; // a login in progress: verifier, state, return page (sessionStorage, this tab)

/* ------------------------------------------------------------ token storage */

/** The tokens kept in this browser, or null. */
function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY)) || null;
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    /* storage unavailable: login will only last for this page view */
  }
  memoryTokens = tokens;
}

/** This page's copy of the tokens: { accessToken, refreshToken, expiresAt, scope }, or null. */
let memoryTokens = readTokens();

/** Use the tokens in storage: another window may have renewed them, or logged out. */
export function syncLogin() {
  let stored;
  try {
    stored = localStorage.getItem(TOKENS_KEY);
  } catch {
    return; // storage unavailable: keep this page's own tokens
  }
  try {
    memoryTokens = JSON.parse(stored) || null;
  } catch {
    /* unreadable: keep this page's own tokens */
  }
}

/** Whether this browser is logged in to Spotify (a refresh token is kept). */
export function isLoggedIn() {
  return !!(memoryTokens && memoryTokens.refreshToken);
}

/** Forget the login in this browser. */
export function logout() {
  memoryTokens = null;
  try {
    localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------- login */

/** A random text of letters and digits (the browser's secure random numbers). */
function randomString(length) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => characters[byte % characters.length]).join("");
}

/** The PKCE "challenge" for a verifier: its SHA-256 digest, in URL-safe base64 without padding. */
async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** The permissions the current login was given ([] if unknown). */
export function grantedScopes() {
  return memoryTokens && memoryTokens.scope ? String(memoryTokens.scope).split(/\s+/).filter(Boolean) : [];
}

/** Whether the current login was given all these permissions. */
export const hasScopes = (scopes) => isLoggedIn() && scopes.every((scope) => grantedScopes().includes(scope));

/**
 * Send the browser to Spotify's login/approval page, asking for `scopes` (a page's permissions, see
 * SPOTIFY_SCOPES) plus any already given, so logging in on one page never takes away what the other
 * page needs. Returns to the current page afterwards. The first time, the user agrees to the privacy
 * policy and terms of use (site/js/shared/agreement.js); if they cancel, nothing happens.
 */
export async function login(scopes) {
  if (!(await ensureAgreement())) return;
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnTo: location.href }));
  const params = new URLSearchParams({
    client_id: spotifyClientId(),
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    scope: [...new Set([...scopes, ...grantedScopes()])].join(" "),
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/**
 * At start-up: someone already logged in who has not agreed to the current privacy policy and terms
 * (they logged in before there were any, or the terms changed) is asked now; if they decline, they are
 * logged out. Resolves when done.
 */
export async function confirmAgreementIfLoggedIn() {
  if (!isLoggedIn()) return;
  if (!(await ensureAgreement())) logout();
}

/**
 * Call once when any page loads. If the address holds a login result from Spotify, finish the
 * login and go back to the page that started it.
 * Returns { handled: false } normally, { handled: true, error } if a login attempt failed.
 * (On success the browser navigates away, so callers can simply stop.)
 */
export async function handleLoginRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (!code && !error) return { handled: false };

  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
  sessionStorage.removeItem(PENDING_KEY);
  history.replaceState(null, "", url.pathname); // remove ?code=... from the address bar
  const fail = (message) => ({ handled: true, error: message });

  if (error) return fail(`Spotify login was canceled or refused (${error}).`);
  if (!pending) return fail("Login could not be completed: this tab has no record of starting it. Please try again.");
  if (state !== pending.state) return fail("Login could not be completed: security check (state) did not match. Please try again.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: spotifyClientId(),
      code_verifier: pending.verifier,
    }),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) return fail(`Spotify refused the login (${response.status}): ${answer.error_description || answer.error || "unknown error"}.`);
  storeTokenResponse(answer);
  location.replace(pending.returnTo || SPOTIFY_REDIRECT_URI);
  return { handled: true, error: null };
}

/** Keep the tokens from Spotify's answer to a login or a renewal. */
function storeTokenResponse(answer) {
  saveTokens({
    accessToken: answer.access_token,
    // Spotify may not send a new refresh token; then keep the old one.
    refreshToken: answer.refresh_token || (memoryTokens && memoryTokens.refreshToken),
    expiresAt: Date.now() + (answer.expires_in - 60) * 1000, // renew a minute early
    scope: answer.scope || (memoryTokens && memoryTokens.scope) || "",
  });
}

/**
 * Get a new access token, unless another window already did (`rejected`: the token Spotify just
 * refused, if any). Only one window renews at a time (a browser lock, where there is one).
 */
function refreshAccessToken(rejected = null) {
  const run = async () => {
    syncLogin();
    if (!isLoggedIn()) throw new SpotifyError("Not logged in to Spotify.", 401);
    const tokens = memoryTokens;
    if (tokens.accessToken && tokens.accessToken !== rejected && Date.now() < tokens.expiresAt) return; // renewed elsewhere
    await renewTokens();
  };
  const locks = typeof navigator !== "undefined" && navigator.locks;
  return locks ? locks.request("dpg-spotify-token-renewal", run) : run();
}

/** Ask Spotify for new tokens with the refresh token. */
async function renewTokens() {
  const usedRefreshToken = memoryTokens.refreshToken;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: usedRefreshToken,
      client_id: spotifyClientId(),
    }),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    syncLogin();
    if (isLoggedIn() && memoryTokens.refreshToken !== usedRefreshToken && Date.now() < memoryTokens.expiresAt) return; // another window renewed them
    logout(); // the refresh token is no longer valid: a fresh login is needed
    throw new SpotifyError(`Spotify session expired; please log in again (${answer.error_description || answer.error || response.status}).`, 401);
  }
  storeTokenResponse(answer);
}

/* ---------------------------------------------------------------- API calls */

/** An error from Spotify, with its HTTP status (401 not logged in, 403 refused, 404 not found, 429 limited) and details. */
export class SpotifyError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waiting when Spotify limits requests (429), per Spotify's guidance: respect Retry-After when the
 * browser can read it (a wait over 30 s, or a used-up quota, is reported at once instead of waited
 * out); otherwise back off exponentially — 2, 4, then 8 seconds — and then report it. Never a tight loop.
 * (Changeable for the tests.)
 */
export const RETRY_POLICY = { delaysMs: [2000, 4000, 8000], longWaitSec: 30 };

/**
 * Call the Web API. `path` is like "/me" or a full "https://api.spotify.com/..." URL (for paging).
 * Renews the token when needed (once more if Spotify refuses it), and waits when Spotify says "too many
 * requests" (429, see RETRY_POLICY). Returns Spotify's answer (null for "204 No Content").
 */
export async function api(path, { method = "GET", body } = {}) {
  syncLogin();
  if (!isLoggedIn()) throw new SpotifyError("Not logged in to Spotify.", 401);
  const url = path.startsWith("http") ? path : API_URL + path;
  let limitedRetries = 0;
  for (let attempt = 0; attempt < 2 + RETRY_POLICY.delaysMs.length; attempt++) {
    if (!memoryTokens.accessToken || Date.now() >= memoryTokens.expiresAt) await refreshAccessToken();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${memoryTokens.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && attempt === 0) {
      await refreshAccessToken(memoryTokens.accessToken); // token rejected: renew it and retry once
      continue;
    }
    if (response.status === 429) {
      // Too many requests. Browsers usually hide Retry-After from the page (Spotify does not expose
      // it), so the wait is often unknown. A used-up quota (reason QUOTA_EXCEEDED, since July 2026) or
      // a long stated wait is reported at once, so callers stop instead of making it worse.
      const retryAfterSec = Number(response.headers.get("Retry-After")) || 0;
      const answer = await response.json().catch(() => null);
      const reason = answer && answer.error ? String(answer.error.reason || "") : "";
      if (/QUOTA_EXCEEDED/i.test(reason)) {
        throw new SpotifyError("Spotify's request quota for this app is used up for now; try again later (an hour is a safe start).", 429, { retryAfter: retryAfterSec || null, quota: true });
      }
      if (retryAfterSec > RETRY_POLICY.longWaitSec) {
        throw new SpotifyError(`Spotify is limiting requests; try again in about ${Math.ceil(retryAfterSec / 60)} minute(s).`, 429, { retryAfter: retryAfterSec });
      }
      if (limitedRetries >= RETRY_POLICY.delaysMs.length) {
        throw new SpotifyError("Spotify is limiting requests and did not say for how long; try again later.", 429, { retryAfter: null });
      }
      await sleep(retryAfterSec ? retryAfterSec * 1000 : RETRY_POLICY.delaysMs[limitedRetries]);
      limitedRetries++;
      continue;
    }
    const answer = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const message = (answer && answer.error && (answer.error.message || answer.error)) || response.statusText;
      throw new SpotifyError(`Spotify ${method} ${url.replace(API_URL, "")} failed (${response.status}): ${message}`, response.status, answer);
    }
    return answer;
  }
  throw new SpotifyError(`Spotify ${method} ${path} failed after several retries (Spotify may be limiting requests).`, 429);
}

/** Follow `next` links until every page is read. `onPage(count, total)` reports progress. */
async function allPages(firstPath, onPage) {
  const items = [];
  let nextPath = firstPath;
  while (nextPath) {
    const page = await api(nextPath);
    items.push(...page.items);
    if (onPage) onPage(items.length, page.total);
    nextPath = page.next;
  }
  return items;
}

/** The logged-in user's profile. */
export function getMe() {
  return api("/me");
}

/**
 * Whether Spotify lets this account use the key in use (one request, once per page). In Development
 * Mode an account not on the key's list can log in, but every request is refused with 403.
 * Returns { ok: true, userId } or { ok: false, notAllowed: true } (or { ok: true } if it could not tell).
 */
let accessCheck = null; // asked once per page; later calls get the same answer
export function checkAccess() {
  accessCheck ??= getMe().then(
    (me) => ({ ok: true, userId: me && me.id }),
    (err) => (err.status === 403 ? { ok: false, notAllowed: true } : { ok: true, userId: null }),
  );
  return accessCheck;
}

/**
 * What is playing on Spotify right now (the live view): { at, isPlaying, progressMs, song } where song
 * is { id, linkedFromId, title, artist, isrc, durationMs }, or null when nothing (or an ad, or a podcast)
 * is playing. `at` is when the answer arrived (this computer's clock), for counting on from progressMs.
 * Asked with the user's country (market=from_token): Spotify may play another version of a song than the
 * one in the playlist ("relinking"), and may then say which song it stands in for (linkedFromId). Development
 * Mode apps no longer get that field (February 2026), so the live view also matches by ISRC, and by hand.
 */
export async function getCurrentlyPlaying() {
  const answer = await api("/me/player/currently-playing?additional_types=track&market=from_token");
  const at = Date.now();
  const track = answer && answer.item;
  if (!track || track.type !== "track") return { at, isPlaying: false, progressMs: 0, song: null };
  return {
    at,
    isPlaying: !!answer.is_playing,
    progressMs: answer.progress_ms || 0,
    song: {
      id: track.id || null,
      linkedFromId: (track.linked_from && track.linked_from.id) || null,
      title: track.name || "",
      artist: artistNames(track),
      isrc: (track.external_ids && track.external_ids.isrc) || "",
      durationMs: track.duration_ms || 0,
    },
  };
}

/** All playlists in the user's library (own, followed, collaborative). */
export async function getMyPlaylists(onPage) {
  const me = await getMe();
  const playlists = await allPages("/me/playlists?limit=50", onPage);
  return playlists.filter(Boolean).map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    description: playlist.description || "",
    owner: playlist.owner ? playlist.owner.display_name || playlist.owner.id : "",
    ownedByMe: !!(playlist.owner && playlist.owner.id === me.id),
    collaborative: !!playlist.collaborative,
    // `items.total` is current; `tracks.total` is the deprecated name.
    trackCount: (playlist.items && playlist.items.total) ?? (playlist.tracks && playlist.tracks.total) ?? null,
    url: playlist.external_urls ? playlist.external_urls.spotify : null,
  }));
}

/**
 * A Spotify track object as a library-style song:
 *   { id, title, artist, album, released (year of the album's release), lengthSec, isrc, isPlayable }
 */
function trackToSong(track) {
  return {
    id: track.id,
    title: track.name,
    artist: artistNames(track),
    album: track.album ? track.album.name : "",
    released: track.album && track.album.release_date ? String(track.album.release_date).slice(0, 4) : "",
    lengthSec: Math.round((track.duration_ms || 0) / 1000),
    isrc: track.external_ids ? track.external_ids.isrc || "" : "",
    isPlayable: track.is_playable ?? null,
  };
}

/** A track's artists, as "A, B". */
const artistNames = (track) => (track.artists || []).map((artist) => artist.name).join(", ");

/** The track of a playlist entry (`item` is the current name; `track` the deprecated one), or null. */
const entryTrack = (entry) => (entry && (entry.item ?? entry.track)) || null;

/**
 * The songs in a playlist you own or collaborate on, as library-style songs (plus `addedAt`).
 * Local files and podcast episodes are skipped.
 */
export async function getPlaylistTracks(playlistId, onPage) {
  const entries = await allPages(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`, onPage);
  const songs = [];
  for (const entry of entries) {
    const track = entryTrack(entry);
    if (!track || entry.is_local || track.type !== "track" || !track.id) continue;
    songs.push({ ...trackToSong(track), addedAt: entry.added_at || null });
  }
  return songs;
}

/**
 * The library playlist's songs, with Spotify's details and whether each can play in the user's
 * country (`GET /playlists/{id}/items?market=from_token`, 50 per request; see site/js/shared/song-details.js).
 * With a market, Spotify may "relink" a song to another version (the library keeps the original ID,
 * and Spotify plays the other version itself). The original ID comes from `linked_from`, which the
 * OpenAPI spec marks deprecated and which Development Mode apps no longer get (February 2026); so if `libraryIds` is given and a song comes back under an ID the
 * library does not know, the playlist is read once more without a market (no relinking: the original
 * IDs) and the two are matched by position.
 * Returns [{ id, title, artist, album, released, lengthSec, isrc, isPlayable, reason }].
 */
export async function getLibraryPlaylistSongs(playlistId, onPage, libraryIds = null) {
  const itemsPath = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`;
  const entries = await allPages(`${itemsPath}&market=from_token`, onPage);
  const songs = [];
  entries.forEach((entry, position) => {
    const track = entryTrack(entry);
    if (!track || entry.is_local || track.type !== "track" || !track.id) return;
    const id = (track.linked_from && track.linked_from.id) || track.id;
    songs.push({ ...trackToSong(track), id, position, reason: (track.restrictions && track.restrictions.reason) || "" });
  });
  const knownIds = libraryIds && new Set(libraryIds);
  if (knownIds && songs.some((song) => !knownIds.has(song.id))) {
    const originalEntries = await allPages(itemsPath); // without a market: Spotify returns the original IDs
    for (const song of songs) {
      if (knownIds.has(song.id)) continue;
      const original = entryTrack(originalEntries[song.position]);
      if (original && original.id && knownIds.has(original.id)) song.id = original.id;
    }
  }
  return songs.map(({ position, ...song }) => song);
}

/** Spotify adds or removes at most this many tracks per request. */
const MAX_TRACKS_PER_REQUEST = 100;

/**
 * Remove tracks from a playlist (`DELETE /playlists/{id}/items`, at most 100 per request).
 * `onProgress(removed, total)` reports progress. Returns the number removed.
 */
export async function removeTracksFromPlaylist(playlistId, trackIds, onProgress) {
  let removedCount = 0;
  for (let iFirst = 0; iFirst < trackIds.length; iFirst += MAX_TRACKS_PER_REQUEST) {
    const items = trackIds.slice(iFirst, iFirst + MAX_TRACKS_PER_REQUEST).map((id) => ({ uri: `spotify:track:${id}` }));
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: "DELETE", body: { items } });
    removedCount += items.length;
    if (onProgress) onProgress(removedCount, trackIds.length);
  }
  return removedCount;
}

/** The Spotify user ID of a playlist's owner, or null if it cannot be read (gone, or not yours to read). */
export async function getPlaylistOwnerId(playlistId) {
  try {
    const playlist = await api(`/playlists/${encodeURIComponent(playlistId)}?fields=owner.id`);
    return (playlist && playlist.owner && playlist.owner.id) || null;
  } catch {
    return null;
  }
}

/** The track IDs in a playlist (for keeping the library playlist in step). */
export async function getPlaylistTrackIds(playlistId) {
  const entries = await allPages(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`);
  return entries.map(entryTrack).filter((track) => track && track.type === "track" && track.id).map((track) => track.id);
}

/** One song by its track ID (`GET /tracks/{id}`; the several-at-once endpoint was removed). */
export async function getTrack(trackId) {
  return trackToSong(await api(`/tracks/${encodeURIComponent(trackId)}`));
}

/**
 * Search Spotify for songs. Development Mode returns at most 10 per page; use `offset` for more.
 * Returns { songs, total, nextOffset } (nextOffset is null when there are no more results).
 */
export async function searchTracks(query, offset = 0) {
  const params = new URLSearchParams({ q: query, type: "track", limit: "10", offset: String(offset) });
  const answer = await api(`/search?${params}`);
  const page = answer.tracks || { items: [], total: 0 };
  const songs = page.items.filter((track) => track && track.id).map(trackToSong);
  return { songs, total: page.total, nextOffset: page.next ? offset + page.items.length : null };
}

/**
 * Create a playlist in the logged-in user's account (`POST /me/playlists`).
 * Spotify makes playlists public unless told otherwise; this defaults to private.
 * Returns { id, url }.
 */
export async function createPlaylist({ name, description = "", isPublic = false }) {
  const playlist = await api("/me/playlists", { method: "POST", body: { name, description, public: isPublic } });
  return { id: playlist.id, url: playlist.external_urls ? playlist.external_urls.spotify : null };
}

/**
 * Append tracks to a playlist, in order (`POST /playlists/{id}/items`, at most 100 per request).
 * `onProgress(added, total)` reports progress. Returns the number added.
 */
export async function addTracksToPlaylist(playlistId, trackIds, onProgress) {
  let addedCount = 0;
  for (let iFirst = 0; iFirst < trackIds.length; iFirst += MAX_TRACKS_PER_REQUEST) {
    const uris = trackIds.slice(iFirst, iFirst + MAX_TRACKS_PER_REQUEST).map((id) => `spotify:track:${id}`);
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: "POST", body: { uris } });
    addedCount += uris.length;
    if (onProgress) onProgress(addedCount, trackIds.length);
  }
  return addedCount;
}

/** The playlist ID from a playlist link, a "spotify:playlist:..." URI, or a bare ID; else null. */
export function playlistIdFrom(text) {
  const match = String(text ?? "").trim().match(/^(?:spotify:playlist:|https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/)?([A-Za-z0-9]{22})(?:[?#].*)?$/);
  return match ? match[1] : null;
}
