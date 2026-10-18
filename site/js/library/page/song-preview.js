// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * song-preview.js — the ▶ buttons in the review: one Spotify embedded player docked at the bottom of the
 * page (no login code, and it does not count toward the Spotify request limit). The whole song plays if
 * this browser is logged in to Spotify (Premium); otherwise Spotify plays a short preview.
 */

import { spotifyTrackId } from "../../shared/data.js";
import { el, fill, $ } from "../../shared/dom.js";
import { redraw } from "./page-state.js";

let previewing = null; // the song in the player

/** The ▶ button for a song (null if it has no Spotify ID). */
export function previewButton(song) {
  const id = spotifyTrackId(song.id);
  if (!id) return null;
  const playing = previewing && previewing.id === song.id;
  return el("button", {
    type: "button", class: playing ? "small primary preview-button" : "small preview-button",
    title: `Listen to ${song.title}`, "aria-label": `Listen to ${song.title}`,
    onclick: () => showPreview(song),
  }, playing ? "▶ playing" : "▶");
}

function showPreview(song) {
  previewing = song;
  let dock = $("preview-dock");
  if (!dock) {
    dock = el("div", { id: "preview-dock", class: "preview-dock", role: "region", "aria-label": "Song preview" });
    document.body.append(dock);
  }
  fill(dock,
    el("div", { class: "preview-head" },
      el("span", {}, el("span", { class: "muted" }, "Song preview: "), el("strong", {}, song.title), song.artist ? ` — ${song.artist}` : ""),
      el("button", { type: "button", class: "small", onclick: closePreview }, "Close")),
    el("iframe", {
      src: `https://open.spotify.com/embed/track/${spotifyTrackId(song.id)}`,
      width: "100%", height: "80", loading: "lazy", title: `Spotify player: ${song.title}`,
      allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      style: "border:0;border-radius:12px",
    }));
  document.body.classList.add("previewing");
  redraw.review();
}

function closePreview() {
  previewing = null;
  const dock = $("preview-dock");
  if (dock) dock.remove();
  document.body.classList.remove("previewing");
  redraw.review();
}
