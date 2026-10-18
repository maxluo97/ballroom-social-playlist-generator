// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * save-step.js — step 6, saving: keeps the library in this browser (for your Spotify account) and brings
 * the library playlist on Spotify in step with it; downloads a backup (three files); and, for the site's
 * owner on their computer, publishes the library as the shared library into the project's data folder.
 * Also "Back to the generator", which warns about unsaved changes.
 */

import { isLoggedIn, createPlaylist, addTracksToPlaylist, removeTracksFromPlaylist, getPlaylistTrackIds } from "../../shared/spotify.js";
import { saveUserLibrary, loadUserLibrary, markDownloaded, changedSinceDownload } from "../../shared/library-store.js";
import { RUNNING_LOCALLY } from "../../shared/config.js";
import { el, fill, $ } from "../../shared/dom.js";
import { canSaveToFolder, getFolder, folderHasFile, writeTextFile } from "../folders.js";
import { keptSongs, updatedBlacklist } from "../library-merge.js";
import { state, LIBRARY_PLAYLIST_NAME, LIBRARY_PLAYLIST_DESCRIPTION, DATA_FOLDER_KEY } from "./page-state.js";
import { refreshLibraryDetails, currentFiles, looksUnsaved } from "./library-data.js";
import { resolvePlaylistOwner, useSavedLibrary } from "./start-steps.js";

/** Create the library playlist in your Spotify account (private). */
async function createLibraryPlaylist() {
  const playlist = await createPlaylist({ name: LIBRARY_PLAYLIST_NAME, description: LIBRARY_PLAYLIST_DESCRIPTION, isPublic: false });
  state.libraryPlaylistId = playlist.id;
}

/**
 * Bring the library playlist in step with the library (creating it the first time): add the songs it
 * lacks, remove the ones no longer in the library. Returns a message about what happened.
 */
async function syncLibraryPlaylist(report) {
  const ids = keptSongs(state.rows || []).map((song) => song.id);
  if (!state.libraryPlaylistId) {
    report("Creating the library playlist in your Spotify account…");
    await createLibraryPlaylist();
  }
  report("Reading the library playlist…");
  let idsInPlaylist;
  try {
    idsInPlaylist = await getPlaylistTrackIds(state.libraryPlaylistId);
  } catch (err) {
    // Gone from Spotify (or no longer yours): make a new one, after asking. Nothing of yours is lost.
    if (err.status !== 404 && err.status !== 403) throw err;
    if (!confirm(`The library playlist could not be found in your Spotify account (it may have been deleted).\n\nCreate a new private “${LIBRARY_PLAYLIST_NAME}” with all your songs?`)) {
      throw new Error("the library playlist was not found, and no new one was made");
    }
    report("Creating a new library playlist in your Spotify account…");
    await createLibraryPlaylist();
    idsInPlaylist = [];
  }
  const inPlaylist = new Set(idsInPlaylist);
  const wanted = new Set(ids);
  const toAdd = ids.filter((id) => !inPlaylist.has(id));
  const toRemove = [...inPlaylist].filter((id) => !wanted.has(id));
  if (toAdd.length) await addTracksToPlaylist(state.libraryPlaylistId, toAdd, (done, total) => report(`Adding songs to the library playlist… ${done} of ${total}`));
  if (toRemove.length) await removeTracksFromPlaylist(state.libraryPlaylistId, toRemove, (done, total) => report(`Removing songs from the library playlist… ${done} of ${total}`));
  return `The library playlist on Spotify is up to date (${toAdd.length} added, ${toRemove.length} removed).`;
}

/** The first save creates the library playlist: the user agrees to that first. */
function agreeToLibraryPlaylist() {
  if (state.libraryPlaylistId) return true;
  return confirm(
    `Saving creates a private playlist in your Spotify account:\n\n“${LIBRARY_PLAYLIST_NAME}”\n\n` +
      `It holds all ${keptSongs(state.rows || []).length} songs of your library, and the generator reads their titles and lengths from it. ` +
      "It is private (not on your profile), and every save brings it in step with the library (songs added or removed).\n\n" +
      "Create it and save?");
}

/** Before saving: the library playlist (needs a login). Returns { ok, message }. */
async function syncBeforeSaving(report) {
  if (!isLoggedIn()) return { ok: false, message: "Not logged in to Spotify, so the library playlist was not updated: log in (step 1) and save again." };
  try {
    return { ok: true, message: await syncLibraryPlaylist(report) };
  } catch (err) {
    const why = err.status === 429 ? "Spotify is limiting requests right now" : err.message;
    return { ok: false, message: `The library playlist could not be updated (${why}); your library was saved anyway. Save again later to finish it.` };
  }
}

/** "Back to the generator": with a warning if the library on this page is not saved. */
export function backToGenerator(event) {
  event.preventDefault();
  if (looksUnsaved() &&
    !confirm("Your changes to the library are not saved. If you go back to the generator now, they will be lost.\n\nLeave without saving?")) {
    $("output").scrollIntoView({ behavior: "smooth" });
    return;
  }
  state.leaving = true; // no second "unsaved changes" warning from the browser
  location.href = "./";
}

/** The time now, as hours:minutes (for the save messages). */
const timeNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function renderOutput() {
  if (!state.userId) return fill($("output"), el("p", { class: "muted" }, "Log in first (step 1)."));
  if (!state.rows || !state.rows.length) return fill($("output"), el("p", { class: "muted" }, "Nothing to save yet."));
  const songCount = keptSongs(state.rows).length;
  const removedNowCount = state.rows.filter((row) => row.removedNow).length;
  const leftOutCount = state.rows.filter((row) => row.blocked && !row.fromBlacklist).length;
  const restoredCount = state.rows.filter((row) => row.fromBlacklist && row.reimported).length;
  const withoutDanceCount = keptSongs(state.rows).filter((song) => !song.dances.length).length;
  const unsaved = looksUnsaved();
  const today = () => new Date().toISOString().slice(0, 10);

  const download = (name, text) => {
    const blob = new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/csv" });
    const link = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const report = (text) => {
    const progress = $("save-progress");
    if (progress) progress.textContent = text;
  };

  /** Save: the library playlist brought in step, then the library kept in this browser. */
  const save = async () => {
    await resolvePlaylistOwner();
    if (!agreeToLibraryPlaylist()) return;
    const sync = await syncBeforeSaving(report);
    try {
      saveUserLibrary(state.userId, {
        rows: keptSongs(state.rows),
        removed: updatedBlacklist(state.blacklist, state.rows, today()),
        playlistId: state.libraryPlaylistId,
      });
    } catch (err) {
      return alert(`The library could not be kept in this browser (${err.message}). Download a backup (below) so nothing is lost.`);
    }
    if (sync.ok) await refreshLibraryDetails(false);
    state.saved = loadUserLibrary(state.userId);
    await useSavedLibrary();
    state.saveMessage = `Saved ${songCount} songs in this browser at ${timeNow()}. ${sync.message}`;
    state.saveOk = sync.ok;
    renderOutput();
  };

  /** A backup: the three files, as the library is saved. */
  const downloadBackup = () => {
    if (unsaved && !confirm("You have unsaved changes. Download the library as it is on this page (with the changes)?")) return;
    const files = currentFiles();
    download("songs.csv", files.songs);
    download("removed-songs.csv", files.removed);
    download("library.json", files.info);
    if (!unsaved) markDownloaded(state.userId);
    state.saved = loadUserLibrary(state.userId);
    renderOutput();
  };

  // On the computer (Chrome / Edge): publish the saved library as the shared library, into the project's data folder.
  const publish = async (choose) => {
    if (unsaved) return alert("Save the library first (above); then publish it.");
    let folder;
    try {
      folder = await getFolder(DATA_FOLDER_KEY, {
        choose,
        check: async (handle) => ((await folderHasFile(handle, "default-settings.json")) ? null
          : `The folder “${handle.name}” does not look like the project's data folder (it has no default-settings.json).`),
      });
    } catch (err) {
      return alert(`Could not open the folder: ${err.message}`);
    }
    if (!folder) return;
    const files = currentFiles();
    try {
      await writeTextFile(folder, "songs.csv", files.songs);
      await writeTextFile(folder, "removed-songs.csv", files.removed);
      await writeTextFile(folder, "library.json", files.info);
    } catch (err) {
      return alert(`Could not save: ${err.message}`);
    }
    state.dataFolderName = folder.name;
    state.saveMessage = `Published ${songCount} songs as the shared library in ${folder.name}/ at ${timeNow()}. ` +
      "Commit and push data/ so the online site offers it.";
    state.saveOk = true;
    renderOutput();
  };

  const saved = state.saved;
  fill($("output"),
    el("p", {}, `The library will have ${songCount} songs.` +
      (removedNowCount ? ` ${removedNowCount} removed now.` : "") +
      (leftOutCount ? ` ${leftOutCount} previously removed song(s) from the import left out.` : "") +
      (restoredCount ? ` ${restoredCount} restored from the removed songs.` : "")),
    withoutDanceCount > 0 && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      `${withoutDanceCount} song(s) have no dance. They are kept, but the generator skips them until they get one (filter “No dance” above).`)),
    unsaved
      ? el("ul", { class: "msgs" }, el("li", { class: "warning" }, "You have changes that are not saved yet. Unsaved changes are lost when you leave this page."))
      : state.saveMessage && el("ul", { class: "msgs" }, el("li", { class: state.saveOk ? "ok" : "warning" }, state.saveMessage)),
    !unsaved && saved && changedSinceDownload(saved) && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      "Your library has changes that are not in a downloaded backup. Browser storage can be wiped (clearing site data, another browser or computer): download a backup now and then.")),
    el("p", { class: "muted", id: "save-progress", "aria-live": "polite" }),
    el("p", { class: "help" }, "Saving keeps your library in this browser, for your Spotify account: the songs' Spotify IDs, dances, tags, " +
      "corrections and removed songs. It also brings your library playlist on Spotify in step, from which the songs' titles and lengths are read. " +
      "A backup is three files (songs.csv, removed-songs.csv, library.json); load them with “Load library files…” in step 2, e.g. on another computer."),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: save }, "Save"),
      el("button", { type: "button", onclick: downloadBackup }, "Download a backup")),
    RUNNING_LOCALLY && canSaveToFolder() && el("details", {}, el("summary", { class: "muted" }, "Publish as the shared library (site owner)"),
      el("p", { class: "help" }, "Writes your saved library into the project's data folder, as the shared library that new users can start from. " +
        (state.dataFolderName ? `Folder: “${state.dataFolderName}”.` : "The first time, choose the “data” folder inside the project’s “site” folder.") +
        " Then commit and push site/data/."),
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: () => publish(false) }, "Publish to the data folder"),
        state.dataFolderName && el("button", { type: "button", class: "small", onclick: () => publish(true) }, "Choose a different folder…"))));
}
