// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-panel.js — the song library on the generator page: loading it at start-up, Refresh from Spotify,
 * Log out, the library line, and the View library window.
 *
 * Each Spotify account's library lives in this browser (site/js/shared/library-store.js), made and saved
 * with the library builder: Spotify IDs and your own data. Spotify's details (titles, lengths, whether a
 * song can play) are read from your library playlist and kept in this browser only temporarily
 * (site/js/shared/song-details.js). So the generator needs a Spotify login.
 */

import { associationMap } from "../generator.js";
import { spotifyLink } from "../../shared/data.js";
import { isLoggedIn, logout as spotifyLogout, hasScopes, checkAccess } from "../../shared/spotify.js";
import { spotifyConnectionPanel } from "../../shared/spotify-panel.js";
import { loadUserLibrary, changedSinceDownload } from "../../shared/library-store.js";
import { SPOTIFY_SCOPES } from "../../shared/config.js";
import { saveLivePlan } from "../../live/live-core.js";
import { el, fill, $, sortRows, sortHeader, spotifyCredit, spotifyListenLink } from "../../shared/dom.js";
import {
  isUnavailable, unavailableReason, withDetails, refreshDetails, detailsNeedRefresh, detailsAgeDays, forgetExpiredDetails, clearDetails,
} from "../../shared/song-details.js";
import { state, redraw, refresh, spotifyLogin, formatDuration, rawDances, referencedDances } from "./page-state.js";

/** Rebuild the songs the generator uses from the library rows and the details now known. */
function applyDetails() {
  const withSpotifyDetails = withDetails(state.rows || []);
  state.songs = withSpotifyDetails.filter((song) => !song.unknown);
  state.library.unknown = withSpotifyDetails.length - state.songs.length;
}

/** Use a library (its rows, a name, problems found while loading, its library playlist). Closes the playlist shown. */
function setLibrary(rows, name, problems, playlistId) {
  state.rows = rows;
  state.library = { name, problems, playlistId, unknown: 0, refreshing: null, error: null, notAllowed: false };
  applyDetails();
  state.result = null;
  renderLibrary();
  redraw.results();
  refresh();
}

/** Start-up: the login, then this account's library in this browser, then Spotify's details. */
export async function loadStartingLibrary() {
  forgetExpiredDetails(); // Spotify's details are only kept temporarily
  setLibrary([], "", [], null);
  if (!isLoggedIn()) return;
  // An account not on the key's list can log in, but Spotify refuses everything: say so.
  const access = await checkAccess();
  if (!access.ok) {
    state.library.notAllowed = true;
    return renderLibrary();
  }
  const library = loadUserLibrary(access.userId);
  if (!library) return renderLibrary(); // no library yet: the library builder starts one
  setLibrary(library.rows, "your library", [], library.playlistId);
  state.library.backupDue = changedSinceDownload(library);
  renderLibrary();
  if (library.playlistId && detailsNeedRefresh(library.playlistId)) await refreshLibrary();
}

/** Log out of Spotify: the library's details (read with that account) are forgotten too. */
function logOut(ask = true) {
  if (ask && state.result && !confirm("Log out of Spotify? The library's details are cleared too, so the current playlist is closed.")) return;
  spotifyLogout();
  clearDetails();
  saveLivePlan(null);
  state.result = null;
  setLibrary([], "", [], null); // the library belongs to the account that logged out
}

/** Read Spotify's details of the library from the library playlist (about one request per 50 songs). */
async function refreshLibrary() {
  const library = state.library;
  if (!library.playlistId || !isLoggedIn()) return;
  library.refreshing = { done: 0, total: state.rows.length };
  library.error = null;
  renderLibrary();
  try {
    await refreshDetails(library.playlistId, (done, total) => {
      library.refreshing = { done, total };
      const progress = $("refresh-progress");
      if (progress) progress.textContent = `Reading your library from Spotify… ${done} of ${total} songs`;
    }, (state.rows || []).map((row) => row.id));
  } catch (err) {
    library.error = err.status === 429
      ? "Spotify is limiting requests right now, so the library could not be read; try again later (an hour is a safe start)."
      : err.status === 404 || err.status === 403
        ? "The library playlist was not found in your Spotify account (it may have been deleted). Saving the library in the library builder makes a new one; nothing of yours is lost."
        : `The library could not be read from Spotify: ${err.message}`;
  }
  library.refreshing = null;
  applyDetails();
  state.result = null;
  renderLibrary();
  redraw.results();
  refresh();
}

/** The library line: name and size, Refresh from Spotify, View library, the library builder, Log out, and what needs doing. */
export function renderLibrary() {
  const { name, problems, playlistId, unknown, refreshing, error, notAllowed } = state.library;
  // Which Spotify key this browser uses; after changing it, log out (a login belongs to one key).
  const connection = spotifyConnectionPanel({ notAllowed, onChange: () => logOut(false) });
  const builderLink = el("a", { href: "library.html", class: "button-link small" }, "Library builder");
  if (!name) {
    const message =
      !isLoggedIn() ? el("li", { class: "warning" }, "Log in to Spotify to use your library: it is kept in this browser for your Spotify account, and its songs' titles and lengths come from Spotify. ",
        el("button", { type: "button", class: "small", onclick: () => spotifyLogin() }, "Log in with Spotify"))
        : notAllowed ? null
          : el("li", { class: "warning" }, "You do not have a library in this browser yet. Open the library builder: start from the shared library " +
            "(songs already sorted into dances and tagged) or build your own from your Spotify playlists, and save it. The generator then uses it.");
    return fill($("library"),
      message && el("ul", { class: "msgs" }, message),
      el("div", { class: "library-line" }, builderLink,
        isLoggedIn() && el("button", { type: "button", class: "small", onclick: logOut, title: "Log out of Spotify on this site" }, "Log out")),
      connection);
  }
  const ageDays = detailsAgeDays();
  const ageText = ageDays === null ? "" : ageDays < 1 ? "today" : `${Math.floor(ageDays)} day(s) ago`;
  const status =
    notAllowed ? null
      : !playlistId ? el("li", { class: "warning" }, "The library has no library playlist yet: open the library builder and save the library once, which creates it.")
      : !isLoggedIn() ? el("li", { class: "warning" }, "Log in to Spotify to load your library: its titles, lengths and availability are read from Spotify. ",
        el("button", { type: "button", class: "small", onclick: () => spotifyLogin() }, "Log in with Spotify"))
        : !hasScopes(SPOTIFY_SCOPES.generator) ? el("li", { class: "warning" },
          "This page needs one more Spotify permission (reading your private library playlist, or saving playlists). ",
          el("button", { type: "button", class: "small", onclick: () => spotifyLogin() }, "Log in again to allow it"))
          : error ? el("li", { class: "error" }, error)
            : null;
  fill($("library"),
    el("div", { class: "library-line" },
      el("span", {}, "Song library: ", el("strong", {}, name), ` — ${state.songs.length} songs, ${rawDances().length} dances`),
      refreshing
        ? el("span", { class: "muted", id: "refresh-progress" }, `Reading your library from Spotify… ${refreshing.done} of ${refreshing.total} songs`)
        : isLoggedIn() && playlistId && el("span", { class: "muted" }, ageText ? `details from Spotify, read ${ageText}` : "",
          el("button", { type: "button", class: "small", onclick: refreshLibrary, title: "Read the titles, lengths and availability again from Spotify" }, "Refresh from Spotify")),
      el("button", { type: "button", class: "small", onclick: openLibraryView, disabled: !state.songs.length }, "View library"),
      builderLink,
      isLoggedIn() && el("button", { type: "button", class: "small", onclick: logOut, title: "Log out of Spotify on this site" }, "Log out")),
    status && el("ul", { class: "msgs" }, status),
    state.library.backupDue && el("p", { class: "muted" },
      "Your library has changes that are not in a downloaded backup: download one in the library builder (step 6) now and then."),
    unknown > 0 && isLoggedIn() && !refreshing && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      `${unknown} song(s) of the library are not in the library playlist on Spotify, so their details are unknown and they cannot be generated. ` +
        "Saving the library in the library builder puts them back.")),
    problems.length > 0 &&
      el("details", {},
        el("summary", {}, `${problems.length} row(s) skipped or changed while loading`),
        el("ul", { class: "msgs" }, problems.map((problem) => el("li", { class: "warning" }, problem)))),
    connection
  );
}

/* ------------------------------------------------------------ View library */

/** The most rows the View library window shows at once (a search narrows them). */
const MAX_SHOWN = 1000;

/**
 * A read-only window listing the song library, with search, a dance filter, song counts per dance, and
 * why a song cannot play with the current settings. Editing and removing songs happen in the library builder.
 */
function openLibraryView() {
  const dialog = $("library-dialog");
  const settings = state.settings;
  const toGroup = associationMap(settings.associations);
  const usedDances = referencedDances();

  /** Why a song cannot play with the current settings, or "". */
  const cannotPlayBecause = (song) => {
    if (settings.minSongSec > 0 && song.lengthSec < settings.minSongSec) return "shorter than the shortest allowed";
    if (settings.maxSongSec > 0 && song.lengthSec > settings.maxSongSec) return "longer than the longest allowed";
    if (isUnavailable(song.id)) return unavailableReason(song.id);
    if (!song.dances.some((dance) => usedDances.has(toGroup(dance)))) return "its dances are not used by the settings";
    return "";
  };
  const rows = state.songs.map((song) => ({ song, merged: [...new Set(song.dances.map(toGroup))], why: cannotPlayBecause(song) }));

  // Songs per dance (after associations), counting only songs that can play.
  const songCountOfDance = new Map();
  for (const row of rows) if (!row.why) for (const dance of row.merged) songCountOfDance.set(dance, (songCountOfDance.get(dance) || 0) + 1);
  const danceNames = [...new Set(rows.flatMap((row) => row.merged))].sort();

  const view = { search: "", dance: "", only: "" }; // only: "" | "can" | "cannot"
  const search = el("input", { type: "text", placeholder: "search title / artist / tag…", "aria-label": "Search the library", style: "flex:1 1 16em" });
  const danceFilter = el("select", { "aria-label": "Show one dance" },
    el("option", { value: "" }, "All dances"),
    danceNames.map((dance) => el("option", { value: dance }, `${dance} (${songCountOfDance.get(dance) || 0})`)));
  // Two "only" boxes that exclude each other: ticking one unticks the other.
  const onlyCan = el("input", { type: "checkbox" });
  const onlyCannot = el("input", { type: "checkbox" });
  const summary = el("p", { class: "muted" });
  const tbody = el("tbody");

  // Sortable columns (heading -> value to sort by); clicking a heading sorts, clicking again reverses.
  const columns = {
    "Title": (row) => row.song.title,
    "Artist": (row) => row.song.artist,
    "Length": (row) => row.song.lengthSec,
    "Dances": (row) => row.song.dances.join(", "),
    "Tags": (row) => (row.song.tags || []).join(", "),
    "Cannot play because": (row) => row.why,
  };
  view.sort = { key: null, dir: 1 };
  const headerRow = el("tr");
  const drawHeader = () => fill(headerRow, Object.keys(columns).map((label) =>
    sortHeader(label, label, view.sort, (sort) => {
      view.sort = sort;
      drawHeader();
      draw();
    })));

  const draw = () => {
    const query = view.search.toLowerCase();
    const shown = sortRows(rows.filter((row) =>
      (!view.dance || row.merged.includes(view.dance)) &&
      (view.only !== "can" || !row.why) &&
      (view.only !== "cannot" || row.why) &&
      `${row.song.title} ${row.song.artist || ""} ${(row.song.tags || []).join(" ")}`.toLowerCase().includes(query)), view.sort, columns);
    summary.textContent = `Showing ${Math.min(shown.length, MAX_SHOWN)} of ${shown.length} matching songs (${rows.length} in the library).`;
    fill(tbody, shown.slice(0, MAX_SHOWN).map((row) =>
      el("tr", { class: row.why ? "cannot-play" : null },
        el("td", {}, spotifyListenLink(spotifyLink(row.song.id), row.song.title), row.song.title),
        el("td", { class: "muted" }, row.song.artist || ""),
        el("td", { class: "num" }, formatDuration(row.song.lengthSec)),
        el("td", { title: row.merged.join(", ") !== row.song.dances.join(", ") ? `Counts as: ${row.merged.join(", ")}` : null }, row.song.dances.join(", ")),
        el("td", {}, (row.song.tags || []).join(", ")),
        el("td", { class: "muted" }, row.why))));
  };
  search.addEventListener("input", () => { view.search = search.value; draw(); });
  danceFilter.addEventListener("change", () => { view.dance = danceFilter.value; draw(); });
  const setOnly = (box, otherBox, value) => {
    if (box.checked) otherBox.checked = false;
    view.only = box.checked ? value : "";
    draw();
  };
  onlyCan.addEventListener("change", () => setOnly(onlyCan, onlyCannot, "can"));
  onlyCannot.addEventListener("change", () => setOnly(onlyCannot, onlyCan, "cannot"));
  drawHeader();
  draw();

  const cannotPlayCount = rows.filter((row) => row.why).length;
  fill(dialog,
    el("div", { class: "dialog-head" },
      el("h2", {}, `Song library: ${state.library.name}`),
      el("button", { type: "button", onclick: () => dialog.close() }, "Close")),
    el("div", { class: "attribution" }, spotifyCredit()),
    el("p", { class: "help" },
      `${rows.length} songs. ` + (cannotPlayCount ? `${cannotPlayCount} cannot play with the current settings (marked below). ` : "") +
        "Click a column heading to sort by it (click again to reverse). To change or remove songs, use the library builder."),
    el("details", {},
      el("summary", {}, "Songs per dance (playable songs, after associations)"),
      el("div", { class: "chips" }, [...songCountOfDance.entries()].sort((first, second) => second[1] - first[1]).map(([dance, count]) =>
        el("button", { type: "button", class: "chip count-chip", onclick: () => { danceFilter.value = dance; view.dance = dance; draw(); } }, `${dance} · ${count}`)))),
    el("div", { class: "inline-fields" }, search, danceFilter,
      el("label", { class: "inline-fields" }, onlyCan, "Only songs that can play"),
      el("label", { class: "inline-fields" }, onlyCannot, "Only songs that cannot play")),
    summary,
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, headerRow),
        tbody)));
  dialog.showModal();
}
