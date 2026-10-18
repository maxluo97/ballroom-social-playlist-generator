// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * same-song.js — in the review (step 5): duplicates (the same recording under another Spotify ID) and
 * versions (other recordings of the same work), with the corrections: "Not a duplicate", "Same
 * recording as…", the Work box and "Rename work…" (the agreed spec, NOTES.md v0.2.4; the logic is in
 * site/js/shared/works.js).
 */

import { workKey, workFromTitle, plainText, recordingKey, ownRecordingKey, workName, joinValue } from "../../shared/works.js";
import { el, chipEditor, comboInput } from "../../shared/dom.js";
import { state, redraw } from "./page-state.js";
import { groups } from "./library-data.js";

/** The name of the work a song belongs to. */
export const workNameOf = (song) => (groups.works.get(workKey(song)) || { name: workName([song]) }).name;
const songName = (song) => `“${song.title}”${song.artist ? ` by ${song.artist}` : ""}`;

/** Notes under a song's title: its duplicates and versions, with the buttons to correct them. */
export function sameSongNotes(song) {
  const smallButton = (className, label, title, onclick) =>
    el("button", { type: "button", class: `small ${className}`.trim(), title, "aria-label": title, onclick: () => { onclick(); redraw.review(); } }, label);
  const duplicates = groups.duplicates.get(song.id) || [];
  const versions = (groups.versions.get(song.id) || []).filter((other) => !duplicates.includes(other));
  const notes = [];
  if (song.recording) {
    // A hand-made correction: say what it is, with its undo.
    const joinedSong = (state.rows || []).map((row) => row.song).find((other) => other !== song && recordingKey(other) === song.recording && !other.recording);
    notes.push(el("div", { class: "muted", style: "font-size:0.85em" },
      song.recording === ownRecordingKey(song) ? "Marked as not a duplicate. " : `Marked as the same recording as ${joinedSong ? songName(joinedSong) : "another song"}. `,
      smallButton("undo", "Undo", `Undo the duplicate correction for ${song.title}`, () => delete song.recording)));
  }
  if (duplicates.length) {
    notes.push(el("div", { class: "swap-warning" }, `Same recording as ${duplicates.slice(0, 3).map(songName).join(", ")}${duplicates.length > 3 ? " …" : ""}. `,
      song.recording !== ownRecordingKey(song) && smallButton("", "Not a duplicate", `${song.title} is not the same recording`, () => (song.recording = ownRecordingKey(song)))));
  }
  if (versions.length) {
    notes.push(el("div", { class: "muted", style: "font-size:0.85em" },
      `Another version: ${versions.slice(0, 3).map(songName).join(", ")}${versions.length > 3 ? " …" : ""}.`));
  } else if (!groups.versions.has(song.id) && state.flagged.versions.has(song.id)) {
    notes.push(el("div", { class: "muted", style: "font-size:0.85em" }, "No other versions now (flagged when the review started)."));
  }
  if (!duplicates.length && !song.recording && state.flagged.duplicates.has(song.id)) {
    notes.push(el("div", { class: "muted", style: "font-size:0.85em" }, "No duplicates now (flagged when the review started)."));
  }
  // "Same recording as…": pick another library song (for duplicates the ISRC misses).
  if (!song.recording) {
    if (state.pickingRecording === song.id) {
      const otherSongs = (state.rows || []).filter((row) => row.song !== song && !row.removedNow && !row.blocked).map((row) => row.song);
      const optionLabel = (other) => `${other.title} — ${other.artist || "?"}${other.album ? ` (${other.album})` : ""}`;
      const songByLabel = new Map(otherSongs.map((other) => [optionLabel(other), other]));
      const combo = comboInput({ placeholder: "type a title…", "aria-label": `Same recording as (for ${song.title})` }, () => [...songByLabel.keys()], (value) => {
        const target = songByLabel.get(value);
        if (!target) return;
        song.recording = recordingKey(target);
        state.pickingRecording = null;
        redraw.review();
      });
      notes.push(el("div", { class: "inline-fields" }, "Same recording as:", combo.wrap,
        smallButton("undo", "Cancel", "Cancel", () => (state.pickingRecording = null))));
      setTimeout(() => combo.input.focus(), 0);
    } else {
      notes.push(el("div", {}, smallButton("", "Same recording as…", `Mark ${song.title} as the same recording as another song`,
        () => (state.pickingRecording = song.id))));
    }
  }
  return notes;
}

/**
 * The Work box: empty = the work worked out from the title (its name is shown in grey). Picking a work's
 * name from the list joins that work; typing a new name makes a work of its own. "Rename work…" gives
 * the whole work (all its songs) a new name.
 */
export function workEditor(song) {
  const list = song.work ? [song.work] : [];
  const otherWorks = () => [...groups.works.values()].filter((work) => !work.songs.includes(song));
  const editor = chipEditor(list, () => otherWorks().map((work) => work.name).sort(), {
    placeholder: `auto: ${workNameOf(song)}`,
    label: `Work for ${song.title}`,
    // A work's name (as listed) becomes the text that joins it.
    normalize: (value) => {
      const work = otherWorks().find((other) => other.name === value);
      return work ? joinValue(work.songs) : value;
    },
    onChange: () => {
      // One work per song: the newest entry wins; none = back to the title's work.
      const value = list[list.length - 1];
      if (value && plainText(value) && plainText(value) !== workFromTitle(song.title)) song.work = value;
      else delete song.work;
      redraw.review();
    },
  });
  const work = groups.works.get(workKey(song));
  const renameButton = work && work.songs.length > 1 && el("button", {
    type: "button", class: "small", title: `Rename the work ${work.name}`, "aria-label": `Rename the work ${work.name}`,
    onclick: () => {
      const name = (prompt(`New name for this work (all ${work.songs.length} songs):`, work.name) || "").trim();
      if (!name || !plainText(name) || name === work.name) return;
      for (const member of work.songs) member.work = name;
      redraw.review();
    },
  }, "Rename work…");
  return el("div", {}, editor, renameButton);
}
