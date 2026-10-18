// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * save-to-spotify.js — the "Save to Spotify" box: creates a playlist in the logged-in account with the
 * generated songs, in order. If not logged in, it offers to log in first, and the playlist is kept
 * across the trip to Spotify's login page. Copy Spotify links remains the fallback if Spotify refuses.
 */

import { isLoggedIn, createPlaylist, addTracksToPlaylist } from "../../shared/spotify.js";
import { el, fill } from "../../shared/dom.js";
import { state, redraw, spotifyLogin, formatDuration } from "./page-state.js";

/** Where the playlist waits during a login (this tab only). */
const PENDING_RESULT_KEY = "dpg.pendingResult.v1";

/** The box, for a playlist `result` whose songs have these Spotify track IDs (in order). */
export function saveToSpotifyBox(result, trackIds) {
  if (!isLoggedIn()) {
    return el("div", { class: "subbox" },
      el("div", { class: "subbox-title" }, "Save to Spotify"),
      el("p", { class: "help" }, "Log in to Spotify to create this playlist in your account. This playlist is kept while you log in."),
      el("div", {}, el("button", { type: "button", onclick: () => {
        try {
          sessionStorage.setItem(PENDING_RESULT_KEY, JSON.stringify(result));
        } catch {
          /* too large or unavailable: the playlist will need generating again */
        }
        spotifyLogin();
      } }, "Log in with Spotify")));
  }

  const today = new Date().toISOString().slice(0, 10);
  const nameBox = el("input", { type: "text", value: `Dance social ${today}`, "aria-label": "Playlist name", style: "flex:1 1 16em" });
  const publicBox = el("input", { type: "checkbox" });
  const status = el("div", { "aria-live": "polite" });
  const createButton = el("button", { type: "button", class: "primary" }, `Create playlist (${trackIds.length} songs)`);
  const say = (kind, ...content) => fill(status, el("ul", { class: "msgs" }, el("li", { class: kind }, ...content)));
  const openLink = (url) => url && el("a", { href: url, target: "_blank", rel: "noopener" }, "Open in Spotify");
  const fallback = " You can still use “Copy Spotify links” and paste them into a playlist by hand.";

  createButton.addEventListener("click", async () => {
    const title = nameBox.value.trim();
    if (!title) return nameBox.focus();
    createButton.disabled = true;
    fill(status, el("p", { class: "muted" }, "Creating the playlist…"));
    let playlist;
    try {
      playlist = await createPlaylist({
        name: title,
        isPublic: publicBox.checked,
        description: `Made with Dance Playlist Generator on ${today}: ${trackIds.length} songs, ${formatDuration(result.totalSec)}.`,
      });
    } catch (err) {
      createButton.disabled = false;
      const hint = err.status === 403
        ? " Spotify refused (403). Check that your account is listed under User Management in the Spotify developer dashboard, then log out and in again."
        : "";
      return say("error", `Could not create the playlist: ${err.message}.${hint}${fallback}`);
    }
    try {
      await addTracksToPlaylist(playlist.id, trackIds, (added, total) => fill(status, el("p", { class: "muted" }, `Adding songs… ${added} of ${total}`)));
    } catch (err) {
      return say("error", `The playlist “${title}” was created, but adding its songs failed: ${err.message}.${fallback} `, openLink(playlist.url));
    }
    say("ok", `Created “${title}” in your Spotify account with ${trackIds.length} songs, in order. `, openLink(playlist.url));
  });

  return el("div", { class: "subbox" },
    el("div", { class: "subbox-title" }, "Save to Spotify"),
    el("div", { class: "inline-fields" }, "Name:", nameBox),
    el("label", { class: "inline-fields" }, publicBox, "Public (shows on your Spotify profile); otherwise private"),
    el("div", { class: "inline-fields" }, createButton),
    status);
}

/** After a login trip started from "Save to Spotify", bring the generated playlist back. */
export function restorePendingResult() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PENDING_RESULT_KEY));
    sessionStorage.removeItem(PENDING_RESULT_KEY);
  } catch {
    /* nothing to restore */
  }
  if (saved && Array.isArray(saved.playlist)) {
    state.result = saved;
    state.stale = false;
    redraw.results();
  }
}
