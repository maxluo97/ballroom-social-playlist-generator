/**
 * spotify.js — Spotify login (Authorization Code with PKCE) and the Web API calls the app uses.
 *
 * Checked against developer.spotify.com, Oct 2026 (Development Mode rules from Feb 2026):
 *   - authorize:  GET  https://accounts.spotify.com/authorize   (response_type=code, S256 challenge)
 *   - token:      POST https://accounts.spotify.com/api/token   (form-encoded; no client secret)
 *   - playlists:  GET  /me/playlists                (max 50 per page; song count in items.total)
 *   - songs:      GET  /playlists/{id}/items        (max 50 per page; song in items[].item;
 *                 only for playlists you own or collaborate on, otherwise 403)
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
 */

import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from "./config.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

const TOKENS_KEY = "dpg.spotify.tokens.v1";
const PENDING_KEY = "dpg.spotify.pending.v1"; // verifier, state, return page (sessionStorage)

/* ------------------------------------------------------------ token storage */

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY)) || null;
  } catch {
    return null;
  }
}

function saveTokens(t) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable: login will only last for this page view */
  }
  memoryTokens = t;
}

let memoryTokens = readTokens();

export function isLoggedIn() {
  return !!(memoryTokens && memoryTokens.refreshToken);
}

export function logout() {
  memoryTokens = null;
  try {
    localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------- login */

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Send the browser to Spotify's login/approval page. Returns to the current page afterwards. */
export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnTo: location.href }));
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    scope: SPOTIFY_SCOPES.join(" "),
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
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

  if (error) return fail(`Spotify login was cancelled or refused (${error}).`);
  if (!pending) return fail("Login could not be completed: this tab has no record of starting it. Please try again.");
  if (state !== pending.state) return fail("Login could not be completed: security check (state) did not match. Please try again.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      code_verifier: pending.verifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return fail(`Spotify refused the login (${res.status}): ${data.error_description || data.error || "unknown error"}.`);
  storeTokenResponse(data);
  location.replace(pending.returnTo || SPOTIFY_REDIRECT_URI);
  return { handled: true, error: null };
}

function storeTokenResponse(data) {
  saveTokens({
    accessToken: data.access_token,
    // Spotify may not send a new refresh token; then keep the old one.
    refreshToken: data.refresh_token || (memoryTokens && memoryTokens.refreshToken),
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh a minute early
    scope: data.scope,
  });
}

async function refreshAccessToken() {
  if (!isLoggedIn()) throw new SpotifyError("Not logged in to Spotify.", 401);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: memoryTokens.refreshToken,
      client_id: SPOTIFY_CLIENT_ID,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logout(); // the refresh token is no longer valid: a fresh login is needed
    throw new SpotifyError(`Spotify session expired; please log in again (${data.error_description || data.error || res.status}).`, 401);
  }
  storeTokenResponse(data);
}

/* ---------------------------------------------------------------- API calls */

export class SpotifyError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Web API. `path` is like "/me" or a full "https://api.spotify.com/..." URL (for paging).
 * Refreshes the token when needed and waits when Spotify says "too many requests" (429).
 */
export async function api(path, { method = "GET", body } = {}) {
  if (!isLoggedIn()) throw new SpotifyError("Not logged in to Spotify.", 401);
  const url = path.startsWith("http") ? path : API + path;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!memoryTokens.accessToken || Date.now() >= memoryTokens.expiresAt) await refreshAccessToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${memoryTokens.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      memoryTokens.expiresAt = 0; // token rejected: refresh and retry once
      continue;
    }
    if (res.status === 429) {
      // Too many requests. A short wait is waited out; a long one (Spotify's quota is used up for a
      // while) is reported at once, so callers can stop instead of making it worse.
      // Browsers usually hide Retry-After from the page (Spotify does not expose it), so the wait is
      // often unknown: then one short wait is tried, and a second refusal is reported straight away.
      const header = Number(res.headers.get("Retry-After"));
      if (!header && attempt > 0) {
        throw new SpotifyError("Spotify is limiting requests and did not say for how long; try again later.", 429, { retryAfter: null });
      }
      const wait = header || 5;
      if (wait > 30) throw new SpotifyError(`Spotify is limiting requests; try again in about ${Math.ceil(wait / 60)} minute(s).`, 429, { retryAfter: wait });
      await sleep(wait * 1000);
      continue;
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || res.statusText;
      throw new SpotifyError(`Spotify ${method} ${url.replace(API, "")} failed (${res.status}): ${msg}`, res.status, data);
    }
    return data;
  }
  throw new SpotifyError(`Spotify ${method} ${path} failed after several retries (Spotify may be limiting requests).`, 429);
}

/** Follow `next` links until every page is read. `onPage(count, total)` reports progress. */
async function allPages(firstPath, onPage) {
  const out = [];
  let next = firstPath;
  while (next) {
    const page = await api(next);
    out.push(...page.items);
    if (onPage) onPage(out.length, page.total);
    next = page.next;
  }
  return out;
}

/** The logged-in user's profile. */
export function getMe() {
  return api("/me");
}

/** All playlists in the user's library (own, followed, collaborative). */
export async function getMyPlaylists(onPage) {
  const me = await getMe();
  const lists = await allPages("/me/playlists?limit=50", onPage);
  return lists.filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || "",
    owner: p.owner ? p.owner.display_name || p.owner.id : "",
    ownedByMe: !!(p.owner && p.owner.id === me.id),
    collaborative: !!p.collaborative,
    // `items.total` is current; `tracks.total` is the deprecated name.
    trackCount: (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? null,
    url: p.external_urls ? p.external_urls.spotify : null,
  }));
}

/**
 * A Spotify track object as a library-style song:
 *   { id, title, artist, album, lengthSec, isrc, isPlayable }
 */
function trackToSong(t) {
  return {
    id: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    album: t.album ? t.album.name : "",
    lengthSec: Math.round((t.duration_ms || 0) / 1000),
    isrc: t.external_ids ? t.external_ids.isrc || "" : "",
    isPlayable: t.is_playable ?? null,
  };
}

/**
 * The songs in a playlist you own or collaborate on, as library-style songs (plus `addedAt`).
 * Local files and podcast episodes are skipped.
 */
export async function getPlaylistTracks(playlistId, onPage) {
  const entries = await allPages(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`, onPage);
  const songs = [];
  for (const e of entries) {
    const t = e && (e.item ?? e.track); // `item` is current; `track` is the deprecated name
    if (!t || e.is_local || t.type !== "track" || !t.id) continue;
    songs.push({ ...trackToSong(t), addedAt: e.added_at || null });
  }
  return songs;
}

/**
 * Whether a track can still be played in the user's country (`GET /tracks/{id}?market=from_token`).
 * With a market, Spotify reports `is_playable`, and may "relink" an unavailable track to another
 * version, which then comes back under a different ID. Spotify asks apps to keep using the original
 * ID (it substitutes the other version itself), so a relink is information, not something to fix.
 * Returns { status: "ok" | "relinked" | "unplayable" | "missing" | "error", reason?, playsAs?, message? }.
 */
export async function checkTrackAvailability(trackId) {
  try {
    const t = await api(`/tracks/${encodeURIComponent(trackId)}?market=from_token`);
    // Only a real track answer counts; anything else is "could not be checked", never "fine".
    if (!t || !t.id) return { status: "error", message: "Spotify did not send the track." };
    if (t.is_playable === false) return { status: "unplayable", reason: (t.restrictions && t.restrictions.reason) || "" };
    if (t.id !== trackId) return { status: "relinked", playsAs: `${t.name} – ${(t.artists || []).map((a) => a.name).join(", ")}` };
    return { status: "ok" };
  } catch (err) {
    if (err.status === 404 || err.status === 400) return { status: "missing" };
    return { status: "error", message: err.message, rateLimited: err.status === 429, retryAfter: (err.details && err.details.retryAfter) || 0 };
  }
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
  const data = await api(`/search?${params}`);
  const page = data.tracks || { items: [], total: 0 };
  const songs = page.items.filter((t) => t && t.id).map(trackToSong);
  return { songs, total: page.total, nextOffset: page.next ? offset + page.items.length : null };
}

/**
 * Create a playlist in the logged-in user's account (`POST /me/playlists`).
 * Spotify makes playlists public unless told otherwise; this defaults to private.
 * Returns { id, url }.
 */
export async function createPlaylist({ name, description = "", isPublic = false }) {
  const p = await api("/me/playlists", { method: "POST", body: { name, description, public: isPublic } });
  return { id: p.id, url: p.external_urls ? p.external_urls.spotify : null };
}

/**
 * Append tracks to a playlist, in order (`POST /playlists/{id}/items`, at most 100 per request).
 * `onProgress(added, total)` reports progress. Returns the number added.
 */
export async function addTracksToPlaylist(playlistId, trackIds, onProgress) {
  let added = 0;
  for (let i = 0; i < trackIds.length; i += 100) {
    const uris = trackIds.slice(i, i + 100).map((id) => `spotify:track:${id}`);
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: "POST", body: { uris } });
    added += uris.length;
    if (onProgress) onProgress(added, trackIds.length);
  }
  return added;
}

/** The playlist ID from a playlist link, a "spotify:playlist:..." URI, or a bare ID; else null. */
export function playlistIdFrom(text) {
  const m = String(text ?? "").trim().match(/^(?:spotify:playlist:|https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/)?([A-Za-z0-9]{22})(?:[?#].*)?$/);
  return m ? m[1] : null;
}
