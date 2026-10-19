// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * song-picker.js — the Swap and Insert window: pick a song from the library, to swap into a row or to
 * insert at a place. Songs that follow the settings come first; every other song is listed after them
 * with "Warning: <reason>" and can still be picked.
 */

import { associationMap, withinLengthLimits } from "../generator.js";
import { workKey, recordingKey } from "../../shared/works.js";
import { spotifyLink } from "../../shared/data.js";
import { el, fill, $, spotifyCredit, spotifyListenLink } from "../../shared/dom.js";
import { isUnavailable, unavailableReason } from "../../shared/song-details.js";
import { activeItems } from "../playlist-edit.js";
import { state, formatDuration } from "./page-state.js";

/** The most songs the window lists at once (the search box narrows them). */
const MAX_LISTED = 300;

/**
 * Open the window. `row`: swap this row's song; or `insertAt`: insert at this place in the playlist (an
 * index into result.playlist). `onPick(song, dance)` is called with the chosen song (and, for an insert,
 * the dance chosen in the window's dance filter, or "").
 */
export function openSongPicker({ row = null, insertAt = null, onPick }) {
  const result = state.result;
  const settings = state.settings;
  const toGroup = associationMap(settings.associations);
  const swapping = !!row;
  const currentSong = swapping ? row.song : null;
  const indexOfSong = new Map(activeItems(result).map((other) => [other.song.id, other.index]));
  // Songs already in the playlist (the row being swapped left out), by recording and by work.
  const otherRows = activeItems(result).filter((other) => other !== row);
  const indexOfRecording = new Map(otherRows.map((other) => [recordingKey(other.song), other.index]));
  const indexOfWork = new Map(otherRows.map((other) => [workKey(other.song), other.index]));
  const mergedDances = (song) => [...new Set(song.dances.map(toGroup))];

  // Inserting: optionally narrow to one dance. Swapping: the row's dance.
  const danceNames = [...new Set(state.songs.flatMap(mergedDances))].sort();
  let dance = swapping ? row.dance : "";

  /** Why picking this song would not follow the settings (empty: it does). */
  const reasons = (song) => {
    const why = [];
    if (swapping && !mergedDances(song).includes(row.dance)) why.push(`a different dance (${mergedDances(song).join(", ") || "none"})`);
    if (swapping && row.blockTag && !(song.tags || []).includes(row.blockTag)) why.push(`no "${row.blockTag}" tag (this row is in the ${row.blockTag} block)`);
    if (indexOfSong.has(song.id)) why.push(`already in this playlist (#${indexOfSong.get(song.id) + 1})`);
    else if (indexOfRecording.has(recordingKey(song))) why.push(`the same recording as #${indexOfRecording.get(recordingKey(song)) + 1}`);
    else if ((settings.noRepeatWorks ?? true) && indexOfWork.has(workKey(song))) why.push(`another version of #${indexOfWork.get(workKey(song)) + 1}`);
    if (!withinLengthLimits(song, settings)) why.push("outside the song length limits");
    if (isUnavailable(song.id)) why.push(unavailableReason(song.id));
    return why;
  };
  const lengthDifference = (song) => (currentSong ? Math.abs(song.lengthSec - currentSong.lengthSec) : 0);
  const candidates = state.songs.filter((song) => !currentSong || song.id !== currentSong.id).map((song) => ({ song, why: reasons(song) }));
  const otherDanceLast = (candidate) => (candidate.why.some((reason) => reason.startsWith("a different dance")) ? 1 : 0);
  const following = candidates.filter((candidate) => !candidate.why.length)
    .sort((first, second) => lengthDifference(first.song) - lengthDifference(second.song) || first.song.title.localeCompare(second.song.title));
  const notFollowing = candidates.filter((candidate) => candidate.why.length)
    .sort((first, second) => otherDanceLast(first) - otherDanceLast(second) || first.song.title.localeCompare(second.song.title));

  const dialog = $("library-dialog");
  const pick = (song) => {
    dialog.close();
    onPick(song, dance);
  };
  const lengthNote = (song) => {
    const changeSec = song.lengthSec - (currentSong ? currentSong.lengthSec : 0);
    return changeSec === 0 ? "same length" : `${changeSec > 0 ? "+" : "−"}${formatDuration(Math.abs(changeSec))} to the night`;
  };
  const search = el("input", { type: "text", placeholder: "search title / artist…", "aria-label": "Search songs", style: "flex:1 1 16em" });
  const danceFilter = !swapping && el("select", { "aria-label": "Only this dance" },
    el("option", { value: "" }, "Any dance"), danceNames.map((name) => el("option", { value: name }, name)));
  const tbody = el("tbody");
  const visible = (list) => {
    const query = search.value.toLowerCase();
    return list.filter((candidate) => (!dance || swapping || mergedDances(candidate.song).includes(dance)) &&
      `${candidate.song.title} ${candidate.song.artist || ""}`.toLowerCase().includes(query));
  };
  const draw = () => {
    const shown = [...visible(following), ...visible(notFollowing)];
    fill(tbody,
      shown.slice(0, MAX_LISTED).map(({ song, why }) =>
        el("tr", { class: why.length ? "not-allowed" : null },
          el("td", {}, el("button", { type: "button", class: "small", onclick: () => pick(song) }, swapping ? "Use this" : "Insert")),
          el("td", {}, song.title, " ", spotifyListenLink(spotifyLink(song.id), song.title), why.length > 0 && el("div", { class: "swap-warning" }, `Warning: ${why.join("; ")}.`)),
          el("td", { class: "muted" }, song.artist || ""),
          el("td", {}, song.dances.join(", ")),
          el("td", { class: "num" }, formatDuration(song.lengthSec)),
          el("td", { class: "muted" }, lengthNote(song)))),
      shown.length > MAX_LISTED && el("tr", {}, el("td", { colspan: 6, class: "muted" }, `…and ${shown.length - MAX_LISTED} more. Use the search box.`)));
  };
  search.addEventListener("input", draw);
  if (danceFilter) danceFilter.addEventListener("change", () => { dance = danceFilter.value; draw(); });
  draw();

  const songsBefore = swapping ? 0 : activeItems({ playlist: result.playlist.slice(0, insertAt) }).length;
  const where = songsBefore === 0 ? "at the start" : `after #${songsBefore}`;
  fill(dialog,
    el("div", { class: "dialog-head" },
      el("h2", {}, swapping ? `Swap #${row.index + 1}: ${row.dance}` : `Insert a song ${where}`),
      el("button", { type: "button", onclick: () => dialog.close() }, "Close")),
    el("div", { class: "attribution" }, spotifyCredit()),
    currentSong && el("p", {}, "Now: ", el("strong", {}, currentSong.title), currentSong.artist ? ` – ${currentSong.artist}` : "", ` (${formatDuration(currentSong.lengthSec)})`),
    el("div", { class: "inline-fields" }, search, danceFilter,
      el("button", { type: "button", onclick: () => {
        const options = visible(following);
        if (!options.length) return alert("No song that follows the settings matches; pick one from the list instead.");
        pick(options[Math.floor(Math.random() * options.length)].song);
      } }, "Pick one for me")),
    el("p", { class: "help" },
      (swapping
        ? `Other ${row.dance} songs that follow the settings come first, closest in length first. `
        : "Songs that follow the settings (not already in the playlist, inside the length limits) come first. ") +
        "Every other song is listed after them with a warning; you can still pick one."),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["", "Title", "Artist", "Dances", "Length", "Change"].map((heading) => el("th", { scope: "col" }, heading)))),
        tbody)));
  dialog.showModal();
  search.focus();
}
