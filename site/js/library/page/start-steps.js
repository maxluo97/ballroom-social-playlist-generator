// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * start-steps.js — the library builder's first steps:
 *   1. Spotify: logged in or not, Log out, the Spotify connection panel.
 *   2. The starting library: this account's library in this browser, the shared library, an empty
 *      one, or a backup's files.
 *
 * Each Spotify account's library lives in this browser (site/js/shared/library-store.js). A new library
 * starts from the shared library (the site owner's data/ folder: songs with their dances and tags; the
 * owner's library playlist is only reused if it is yours) or empty; files are backups.
 */

import { login, logout, isLoggedIn, hasScopes, getPlaylistOwnerId } from "../../shared/spotify.js";
import { loadUserLibrary } from "../../shared/library-store.js";
import { withDetails, detailsNeedRefresh, clearDetails } from "../../shared/song-details.js";
import { SPOTIFY_SCOPES } from "../../shared/config.js";
import { spotifyConnectionPanel } from "../../shared/spotify-panel.js";
import { loadSongsFromUrl, parseSongsText, parseRemovedSongs, parseLibraryInfo } from "../../shared/data.js";
import { el, fill, $ } from "../../shared/dom.js";
import { state, redraw, errorBox, updateLists, SHARED_LIBRARY_URL, SHARED_LIBRARY_INFO_URL } from "./page-state.js";
import { computeRows, refreshLibraryDetails, currentFiles, filesKey } from "./library-data.js";

/* ---------------------------------------------------------------- 1. Spotify */

export function renderSpotify(message) {
  // The library on this page belongs to the account: logging out starts the page afresh.
  const signOut = () => { logout(); clearDetails(); location.reload(); };
  fill($("spotify"),
    el("p", {}, isLoggedIn() ? el("strong", {}, "Logged in to Spotify.") : "Not logged in."),
    message && errorBox(message),
    el("div", { class: "actions" },
      isLoggedIn()
        ? el("button", { type: "button", onclick: signOut }, "Log out")
        : el("button", { type: "button", class: "primary", onclick: () => login(SPOTIFY_SCOPES.library) }, "Log in with Spotify")),
    isLoggedIn() && !hasScopes(SPOTIFY_SCOPES.library) && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      "The library builder needs one more Spotify permission (reading collaborative playlists, or keeping the library playlist). ",
      el("button", { type: "button", class: "small", onclick: () => login(SPOTIFY_SCOPES.library) }, "Log in again to allow it"))),
    // Which Spotify key this browser uses; after changing it, log out (a login belongs to one key).
    spotifyConnectionPanel({ notAllowed: !!state.notAllowed, onChange: signOut }));
}

/* ------------------------------------------------------- 2. Starting library */

const SAVED_LIBRARY_NAME = "Your library (this browser)";

/** Start-up (logged in): this account's library in this browser, if there is one. */
export async function loadStart() {
  state.saved = loadUserLibrary(state.userId);
  if (state.saved) return useLibrary(state.saved, SAVED_LIBRARY_NAME, []);
  setExisting([], "", []);
}

/**
 * Work on a library (rows of IDs and your data, removed songs, the library playlist's ID).
 * `savedNow`: it is the library saved in this browser (otherwise the page counts as having unsaved changes).
 */
export async function useLibrary(library, name, problems, { savedNow = true } = {}) {
  state.libraryPlaylistId = library.playlistId;
  state.blacklist = library.removed instanceof Map ? library.removed : new Map();
  await resolvePlaylistOwner();
  // Spotify's details (titles, lengths, …) are not stored: read them from the library playlist.
  state.pendingRows = library.rows;
  if (isLoggedIn() && state.libraryPlaylistId && detailsNeedRefresh(state.libraryPlaylistId)) await refreshLibraryDetails(false);
  state.pendingRows = null;
  setExisting(withDetails(library.rows), name, problems);
  // Changes are measured against what is saved in this browser (a library from elsewhere is unsaved).
  state.savedKey = savedNow ? filesKey(currentFiles()) : null;
  redraw.output();
}

/** A library playlist from the shared library or from files is only used if it is in your account. */
export async function resolvePlaylistOwner() {
  if (!state.playlistMaybeForeign) return;
  state.playlistMaybeForeign = false;
  if (!state.libraryPlaylistId) return;
  const ownerId = await getPlaylistOwnerId(state.libraryPlaylistId);
  if (!ownerId || ownerId !== state.userId) state.libraryPlaylistId = null; // your first save makes your own
}

/** Start from the shared library (data/ on the site): its songs with their dances and tags. */
async function startFromShared() {
  if (state.saved && !confirm("Start again from the shared library? The library on this page is replaced (your saved library stays in this browser until you save).")) return;
  try {
    const { songs, problems } = await loadSongsFromUrl(SHARED_LIBRARY_URL);
    state.libraryPlaylistId = await loadSharedLibraryPlaylistId();
    state.playlistMaybeForeign = true;
    await useLibrary({ rows: songs, removed: new Map(), playlistId: state.libraryPlaylistId }, "the shared library", problems, { savedNow: false });
  } catch (err) {
    alert(`The shared library could not be loaded: ${err.message}`);
  }
}

function startEmpty() {
  if (state.saved && !confirm("Start an empty library? The library on this page is replaced (your saved library stays in this browser until you save).")) return;
  state.libraryPlaylistId = state.saved ? state.saved.playlistId : null; // keep your library playlist
  state.blacklist = new Map();
  setExisting([], "an empty library", []);
  state.savedKey = null;
  redraw.output();
}

/** Load a backup: songs.csv (needed), removed-songs.csv and library.json (optional). */
async function loadLibraryFiles(files) {
  // "songs (1).csv" (a second download of the same file) counts as songs.csv.
  const fileByName = Object.fromEntries([...files].map((file) => [file.name.toLowerCase().replace(/ \(\d+\)(?=\.)/, ""), file]));
  const songsFile = fileByName["songs.csv"] || [...files].find((file) => /\.csv$/i.test(file.name) && !/removed/i.test(file.name));
  if (!songsFile) return alert("Choose your songs.csv (and, if you have them, removed-songs.csv and library.json).");
  try {
    const { songs, problems } = parseSongsText(await songsFile.text());
    const removedFile = fileByName["removed-songs.csv"] || [...files].find((file) => /removed/i.test(file.name));
    const infoFile = fileByName["library.json"] || [...files].find((file) => /\.json$/i.test(file.name));
    const removed = removedFile ? parseRemovedSongs(await removedFile.text()) : new Map();
    const playlistId = infoFile ? parseLibraryInfo(await infoFile.text()).playlistId : null;
    state.playlistMaybeForeign = true;
    await useLibrary({ rows: songs, removed, playlistId }, songsFile.name, problems, { savedNow: false });
  } catch (err) {
    alert(`Could not read the files: ${err.message}`);
  }
}

/** The shared library's playlist ID (data/library.json), or null. */
async function loadSharedLibraryPlaylistId() {
  try {
    const response = await fetch(SHARED_LIBRARY_INFO_URL, { cache: "no-store" });
    return response.ok ? parseLibraryInfo(await response.text()).playlistId : null;
  } catch {
    return null;
  }
}

/** Start from these songs (the starting library): the review is built from them straight away. */
export function setExisting(songs, name, problems) {
  state.existing = songs;
  state.existingName = name;
  state.imports = null;
  updateLists();
  renderExisting(problems);
  redraw.manual(); // its "In library" column depends on the starting library
  computeRows(); // the review shows the whole library straight away (so songs can be removed)
}

export function renderExisting(problems = []) {
  if (!state.userId) {
    return fill($("existing"), el("p", { class: "muted" },
      "Log in first (step 1): your library is kept in this browser, for your Spotify account."));
  }
  const fileInput = el("input", { type: "file", accept: ".csv,.json", multiple: true, hidden: true });
  fileInput.addEventListener("change", () => fileInput.files.length && loadLibraryFiles(fileInput.files));
  const saved = state.saved;
  fill($("existing"),
    el("p", {}, state.existingName
      ? ["Starting from ", el("strong", {}, state.existingName), `: ${state.existing.length} songs. Imported songs are added to it; nothing in it is removed.`]
      : "You do not have a library in this browser yet. Start from the shared library (songs already sorted into dances and tagged), or start empty and build your own."),
    saved && el("p", { class: "muted" }, `Your library in this browser: ${saved.rows.length} songs, saved ${new Date(saved.savedAt).toLocaleString()}` +
      (saved.downloadedAt ? `; last backup downloaded ${new Date(saved.downloadedAt).toLocaleString()}.` : "; no backup downloaded yet.")),
    state.existingName === "the shared library" && el("p", { class: "help" },
      "If this is your first library, the songs' titles appear after your first save (step 6), which puts them in a playlist in your Spotify account."),
    problems.length > 0 && el("ul", { class: "msgs" }, problems.map((problem) => el("li", { class: "warning" }, problem))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: saved ? "small" : "primary", onclick: startFromShared }, "Start from the shared library"),
      el("button", { type: "button", class: "small", onclick: startEmpty }, "Start empty"),
      el("button", { type: "button", class: "small", onclick: () => fileInput.click() }, "Load library files…"),
      saved && state.existingName !== SAVED_LIBRARY_NAME &&
        el("button", { type: "button", class: "small undo", onclick: () => useLibrary(state.saved, SAVED_LIBRARY_NAME, []) }, "Back to your saved library"),
      fileInput));
}

/** After saving: the saved library, as this account's library in this browser. */
export const useSavedLibrary = () => useLibrary(state.saved, SAVED_LIBRARY_NAME, []);
