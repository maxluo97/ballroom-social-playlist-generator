// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-data.js — the library on this page as data: building the review's rows (the starting library
 * merged with the imports), the groups of duplicates and versions, reading Spotify's details, and the
 * library's files (songs.csv, removed-songs.csv, library.json) as they would be saved.
 */

import { isLoggedIn } from "../../shared/spotify.js";
import { rememberDetails, refreshDetails } from "../../shared/song-details.js";
import { songsToCSV, removedSongsToCSV, libraryInfoText } from "../../shared/data.js";
import { workKey, recordingKey, sameKeyGroups, workName } from "../../shared/works.js";
import { $ } from "../../shared/dom.js";
import { mergeImport, markPreviouslyRemoved, keptSongs, updatedBlacklist, blacklistRows } from "../library-merge.js";
import { state, redraw, freshDetails, loadRules } from "./page-state.js";

/*
 * Works and duplicates (the agreed spec, docs/history.md, v0.2.4; logic in site/js/shared/works.js), among the
 * songs that stay in the library. Worked out again on every redraw of the review table.
 *   duplicates  song id -> the other songs that are the same recording
 *   versions    song id -> the other songs of the same work
 *   works       work key -> { songs, name }   (every work, one song or more; names: see works.js)
 */
export const groups = { duplicates: new Map(), versions: new Map(), works: new Map() };

export function updateGroups() {
  const keptSongsNow = (state.rows || []).filter((row) => !row.removedNow && !row.blocked).map((row) => row.song);
  const works = new Map();
  for (const song of keptSongsNow) {
    const work = workKey(song);
    if (!works.has(work)) works.set(work, { songs: [] });
    works.get(work).songs.push(song);
  }
  for (const work of works.values()) work.name = workName(work.songs);
  groups.duplicates = sameKeyGroups(keptSongsNow, recordingKey);
  groups.versions = sameKeyGroups(keptSongsNow, workKey);
  groups.works = works;
}

/** Ticked worklist songs (step 4a), as one-song "imports" for mergeImport. */
function manualImports() {
  return state.manual
    .filter((entry) => entry.include)
    .map((entry) => ({ playlistName: entry.source, dances: [...entry.dances], tags: [...entry.tags], songs: [entry.song] }));
}

/** (Re)build the review rows from the starting library, the imports, the worklist and the current tag rules. */
export function computeRows() {
  // Imported songs come with Spotify's details: remember them (temporarily) for this page and the
  // generator; a library song whose details were unknown gets them from the import.
  rememberDetails([...(state.imports || []).flatMap((playlist) => playlist.songs), ...state.manual.map((entry) => entry.song)]);
  const startingSongs = state.existing.map((song) => (song.unknown ? freshDetails(song) : song));
  const merged = markPreviouslyRemoved(
    mergeImport(startingSongs, [...(state.imports || []), ...manualImports()], { tagRules: loadRules() }), state.blacklist);
  // Every other blacklisted song gets a (hidden unless filtered) row too, so it can be restored.
  state.rows = [...merged, ...blacklistRows(merged, state.blacklist).map((row) => ({ ...row, song: freshDetails(row.song) }))];
  state.filter = "all";
  updateGroups();
  state.flagged = { duplicates: new Set(groups.duplicates.keys()), versions: new Set(groups.versions.keys()) };
  redraw.review();
}

/** The song IDs of the library as it is now (or as loaded, before the review is built). */
const libraryIdsNow = () => (state.rows ? keptSongs(state.rows) : state.pendingRows || []).map((song) => song.id);

/**
 * Read Spotify's details of the library from the library playlist (about one request per 50 songs).
 * `redrawReview`: show the new details in the review straight away.
 */
export async function refreshLibraryDetails(redrawReview = true) {
  if (!state.libraryPlaylistId || !isLoggedIn()) return;
  state.details = { refreshing: { done: 0, total: 0 }, error: null };
  if (redrawReview && state.rows) redraw.review();
  try {
    await refreshDetails(state.libraryPlaylistId, (done, total) => {
      state.details.refreshing = { done, total };
      const progress = $("details-progress");
      if (progress) progress.textContent = `Reading your library from Spotify… ${done} of ${total} songs`;
    }, libraryIdsNow());
  } catch (err) {
    state.details.error = err.status === 429
      ? "Spotify is limiting requests right now, so the library could not be read; try again later (an hour is a safe start)."
      : err.status === 404 || err.status === 403
        ? "The library playlist was not found in your Spotify account (it may have been deleted). Saving the library (step 6) makes a new one."
        : `The library could not be read from Spotify: ${err.message}`;
  }
  state.details.refreshing = null;
  if (redrawReview && state.rows) {
    // Show the new details: every row's song gets them again (its own data is kept).
    for (const row of state.rows) row.song = freshDetails(row.song);
    redraw.review();
  }
}

/* ---- the library's files ---- */

/** The files' contents for the library as it is on this page now (IDs and your own data only). */
export function currentFiles() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    songs: songsToCSV(keptSongs(state.rows || [])),
    removed: removedSongsToCSV(updatedBlacklist(state.blacklist, state.rows || [], today)),
    info: libraryInfoText({ playlistId: state.libraryPlaylistId }),
  };
}

/** A key for comparing libraries: two libraries are the same when their songs and removed songs are. */
export const filesKey = (files) => `${files.songs}\u0000${files.removed}`;

/** Whether the library on this page has changed since it was saved in this browser. */
export function looksUnsaved() {
  if (!state.rows) return false;
  return filesKey(currentFiles()) !== state.savedKey;
}
