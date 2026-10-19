// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-page.js — the library builder (library.html): connects its steps and starts it.
 *
 * Flow: log in -> start from your saved library, the shared library, an empty one or a backup -> set up
 * automatic tags -> choose your own single-dance playlists and confirm each one's dance(s), or add songs
 * one by one -> import -> review (dances, tags, works, duplicates; remove songs) -> save.
 * Imports only add to the library; see site/js/library/library-merge.js for the exact rules.
 *
 * THE PAGE'S FILES (all in this folder)
 *   page-state.js       the page's state, constants, known dances and tags, the tag rules
 *   library-data.js     the review's rows, duplicate / version groups, Spotify's details, the library's files
 *   own-dances.js       "Define a new dance…"
 *   start-steps.js      step 1 (Spotify) and step 2 (the starting library)
 *   tag-rules-step.js   step 3 (automatic tags)
 *   playlists-step.js   step 4 (your playlists, and the import)
 *   songs-step.js       step 4a (songs one by one: links, search, a playlist song by song; the worklist)
 *   review-step.js      step 5 (the review table)
 *     same-song.js      duplicates and versions, and their corrections
 *     song-preview.js   the ▶ player
 *   save-step.js        step 6 (save, backup, publish) and "Back to the generator"
 * Library merging is in ../library-merge.js, writing to a folder in ../folders.js.
 */

import { isLoggedIn, checkAccess, handleLoginRedirect, confirmAgreementIfLoggedIn } from "../../shared/spotify.js";
import { forgetExpiredDetails } from "../../shared/song-details.js";
import { rememberedFolderName } from "../folders.js";
import { state, redraw, DATA_FOLDER_KEY } from "./page-state.js";
import { looksUnsaved } from "./library-data.js";
import { renderSpotify, loadStart, renderExisting } from "./start-steps.js";
import { renderRules } from "./tag-rules-step.js";
import { renderPlaylists } from "./playlists-step.js";
import { renderManual } from "./songs-step.js";
import { renderReview } from "./review-step.js";
import { renderOutput, backToGenerator } from "./save-step.js";

// The steps redraw each other through these (see page-state.js).
redraw.spotify = renderSpotify;
redraw.existing = renderExisting;
redraw.playlists = renderPlaylists;
redraw.manual = renderManual;
redraw.review = renderReview;
redraw.output = renderOutput;

async function start() {
  const login = await handleLoginRedirect();
  if (login.handled && !login.error) return;
  await confirmAgreementIfLoggedIn();
  renderSpotify(login.error);
  if (isLoggedIn()) {
    // An account not on the key's list can log in, but Spotify refuses everything: say so.
    const access = await checkAccess();
    state.notAllowed = !access.ok;
    state.userId = access.ok ? access.userId : null;
    if (state.notAllowed) renderSpotify();
  }
  renderRules();
  renderPlaylists();
  renderManual();
  // Both "Back to the generator" buttons check that the library is saved first.
  for (const link of document.querySelectorAll("a.back-to-generator")) link.addEventListener("click", backToGenerator);
  // Closing the tab or leaving another way with unsaved changes: the browser's own warning.
  window.addEventListener("beforeunload", (event) => {
    if (!state.leaving && looksUnsaved()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  state.dataFolderName = await rememberedFolderName(DATA_FOLDER_KEY);
  forgetExpiredDetails(); // Spotify's details are only kept temporarily
  if (state.userId) await loadStart();
  else {
    renderExisting();
    renderOutput();
  }
}

start();
