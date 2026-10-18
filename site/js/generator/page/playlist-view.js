// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * playlist-view.js — the generated playlist on the generator page: generating, the table with its editing
 * buttons (lock, move, swap, insert, remove, undo), dragging rows and blocks, and Regenerate unlocked songs.
 *
 * The editing itself is in site/js/generator/playlist-edit.js; this file shows the result and calls it.
 * Whether songs can play comes from the library refresh (site/js/shared/song-details.js): songs that
 * cannot play are never picked, so there is no check after generating.
 */

import { generatePlaylist } from "../generator.js";
import { spotifyLink, spotifyTrackId } from "../../shared/data.js";
import { livePlan, saveLivePlan } from "../../live/live-core.js";
import { el, fill, $, spotifyCredit, spotifyListenLink } from "../../shared/dom.js";
import { isUnavailable, unavailableReason } from "../../shared/song-details.js";
import {
  activeItems, activeResult, hasEdits, prepareGenerated,
  swapSong, resetSwap, insertSong, removeItem, restoreItem, resetAll,
  undo as undoEdit, moveItem, moveBy, moveGroup, moveGroupBy, toggleLock, lockAll, unlockAll,
  groupStates, typeLabel, lockedForRegeneration,
} from "../playlist-edit.js";
import { state, redraw, cancelPendingValidation, formatDuration, percent } from "./page-state.js";
import { openSongPicker } from "./song-picker.js";
import { saveToSpotifyBox } from "./save-to-spotify.js";

/** Songs that can play right now (Spotify said so when the library was read). */
const songFilter = (song) => !isUnavailable(song.id);

/** Generate a whole new playlist (after a confirmation, if one is shown). */
export function generate() {
  cancelPendingValidation();
  redraw.validation();
  if (state.errors.length) return;
  if (state.result && !confirm(hasEdits(state.result)
    ? "Generate a whole new playlist? The current one is replaced entirely, and your changes to it (and its locks) are lost."
    : "Generate a whole new playlist? The current one is replaced entirely.")) return;
  // Always a fresh random playlist; songs known to be unavailable on Spotify are never picked.
  const result = generatePlaylist(state.songs, { ...state.settings, seed: null }, { songFilter });
  state.result = prepareGenerated(result, state.settings);
  state.stale = false;
  renderResults();
}

/** A new playlist around the locked songs (the agreed spec, NOTES.md v0.2.5). */
function regenerateUnlocked() {
  cancelPendingValidation();
  redraw.validation();
  if (state.errors.length) return;
  if (!confirm("Make a new playlist around the locked songs? Every unlocked song is replaced, and this cannot be undone.")) return;
  const locked = lockedForRegeneration(state.result);
  const result = generatePlaylist(state.songs, { ...state.settings, seed: null }, { songFilter, locked });
  state.result = prepareGenerated(result, state.settings);
  state.stale = false;
  renderResults();
}

/* ---- editing by hand: apply an edit to the current playlist, then redraw ---- */
const edited = () => renderResults();
const doSwap = (row, song, dance) => {
  swapSong(state.result, row, song, dance, state.settings);
  edited();
};
const doInsert = (position, song, dance) => {
  insertSong(state.result, position, song, dance, state.settings);
  edited();
};
const doResetSwap = (row) => (resetSwap(state.result, row, state.settings), edited());
const doRemove = (row) => (removeItem(state.result, row, state.settings), edited());
const doRestore = (row) => (restoreItem(state.result, row, state.settings), edited());
function doResetAll() {
  if (!confirm("Undo all your changes (locks included) and go back to the playlist exactly as the generator made it?")) return;
  resetAll(state.result, state.settings);
  edited();
}
const doUndo = () => (undoEdit(state.result, state.settings), edited());
const doMove = (row, toIndex) => (moveItem(state.result, row, toIndex, state.settings), edited());
const doMoveBy = (row, by) => (moveBy(state.result, row, by, state.settings), edited());
const doMoveGroup = (groupId, toIndex) => (moveGroup(state.result, groupId, toIndex, state.settings), edited());
const doMoveGroupBy = (groupId, by) => (moveGroupBy(state.result, groupId, by, state.settings), edited());
const doToggleLock = (row) => (toggleLock(state.result, row, state.settings), edited());
const doLockAll = () => (lockAll(state.result, state.settings), edited());
const doUnlockAll = () => (unlockAll(state.result, state.settings), edited());

/** The Swap window for a row, and the Insert window for a place in the playlist. */
const swapFor = (row) => openSongPicker({ row, onPick: (song, dance) => doSwap(row, song, dance) });
const insertAt = (position) => openSongPicker({ insertAt: position, onPick: (song, dance) => doInsert(position, song, dance) });

/** Draw the playlist, with its summary, actions, warnings and editing buttons. */
export function renderResults() {
  const result = state.result;
  const box = $("results");
  if (!result) {
    box.replaceChildren(el("p", { class: "muted" }, "Adjust the settings, then press ", el("strong", {}, "Generate playlist"), "."));
    return;
  }
  // The live view and the program follow this playlist, edits included (they read it from storage).
  saveLivePlan(livePlan(result, state.rows));
  const settings = state.settings;
  const themed = Boolean(settings.theme && (settings.theme.dances.length || (settings.theme.tags || []).length));
  const activeRows = activeItems(result);
  const differenceSec = result.totalSec - result.targetSec;
  const removedCount = result.playlist.length - activeRows.length;

  /** A button that copies text to the clipboard and briefly confirms. */
  const copyButton = (label, getText, doneText = "Copied!") => {
    const button = el("button", { type: "button", onclick: async () => {
      try {
        await navigator.clipboard.writeText(getText());
        button.textContent = doneText;
        setTimeout(() => (button.textContent = label), 2000);
      } catch {
        alert("Copying failed in this browser.");
      }
    } }, label);
    return button;
  };

  // Spotify links, in playlist order. Songs without a real Spotify ID are left out (and reported).
  const links = activeRows.map((row) => spotifyLink(row.song.id));
  const linkCount = links.filter(Boolean).length;
  const rowsWithoutLink = activeRows.filter((row, iRow) => !links[iRow]);
  const copyLinks = copyButton("Copy Spotify links", () => links.filter(Boolean).join("\n"), `Copied ${linkCount} links!`);
  if (!linkCount) {
    copyLinks.disabled = true;
    copyLinks.title = "No song in this playlist has a Spotify track ID.";
  }

  /** The Type column: the row's block, category, excursion, theme, ... */
  const kindLabel = (row) =>
    typeLabel(row, result, settings) ??
    (row.blockLabel ? `${row.blockLabel}${row.kind === "regular" && row.category ? ` (${row.category})` : ""}`
      : row.kind === "regular" ? row.category
      : row.kind === "excursion" ? "Excursion"
      : row.kind === "theme" ? row.source
      : row.kind === "event" ? row.source
      : row.kind === "inserted" ? "Added by you"
      : "Last dance");

  /** The generator's warnings name places from generation time; show today's number instead. */
  const warningPrefix = (warning) => {
    if (warning.index < 0) return "";
    const rowNow = result.playlist.find((row) => row.genIndex === warning.index);
    if (!rowNow) return `#${warning.index + 1}: `;
    return rowNow.removed ? "(removed song) " : `#${rowNow.index + 1}: `;
  };

  const smallButton = (label, title, onclick) => el("button", { type: "button", class: "small", title, "aria-label": title, onclick }, label);
  /** Buttons that undo a manual change (Reset, Remove an inserted song, Restore) look different. */
  const undoButton = (label, title, onclick) => el("button", { type: "button", class: "small undo", title, "aria-label": title, onclick }, label);
  // Drag and drop: drop a row (or a whole block, by its header) onto a row to put it just before that row.
  const dropTarget = (node, toIndex) => {
    node.addEventListener("dragover", (event) => {
      if (!state.drag) return;
      event.preventDefault();
      node.classList.add("drop-before");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop-before"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("drop-before");
      const dragged = state.drag;
      state.drag = null;
      if (dragged && dragged.item) doMove(dragged.item, toIndex);
      else if (dragged && dragged.group) doMoveGroup(dragged.group, toIndex);
    });
    return node;
  };
  const draggable = (node, what) => {
    node.draggable = true;
    node.addEventListener("dragstart", (event) => {
      state.drag = what;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "move");
    });
    node.addEventListener("dragend", () => (state.drag = null));
    return node;
  };
  const columnCount = themed ? 8 : 7;
  /** Undo / Reset all / Lock all / Unlock all / Regenerate unlocked songs (shown above and below the table). */
  const editButtons = () => [
    (result.history || []).length > 0 && el("button", { type: "button", class: "undo", onclick: doUndo,
      title: "Undo the last change" }, "Undo"),
    hasEdits(result) && el("button", { type: "button", class: "undo", onclick: doResetAll,
      title: "Undo every change (locks included): back to exactly the playlist the generator made" }, "Reset all"),
    el("button", { type: "button", class: "small", onclick: doLockAll, title: "Lock every song" }, "Lock all"),
    activeRows.some((row) => row.locked) && el("button", { type: "button", class: "small", onclick: doUnlockAll, title: "Unlock every song" }, "Unlock all"),
    activeRows.some((row) => row.locked) && el("button", { type: "button", class: "primary", onclick: regenerateUnlocked,
      title: "Make a new playlist around the locked songs, which keep their places" }, "Regenerate unlocked songs"),
  ];
  const groups = groupStates(result);
  /** The header row of an intact block: its name, and moving the whole block. */
  const groupHead = (groupId, group) => draggable(dropTarget(el("tr", { class: "group-head" },
    el("td", { colspan: columnCount },
      el("span", { class: "drag-handle", title: "Drag to move the whole block", "aria-hidden": "true" }, "⠿ "),
      el("strong", {}, group.label), el("span", { class: "muted" }, ` · ${group.rows.length} songs · drag this line to move the whole block `),
      smallButton("Move block up", `Move ${group.label} up`, () => doMoveGroupBy(groupId, -1)),
      smallButton("Move block down", `Move ${group.label} down`, () => doMoveGroupBy(groupId, 1)))), group.rows[0].index), { group: groupId });

  const activeRow = (row) => {
    const name = `#${row.index + 1} ${row.song.title}`;
    const group = row.group && groups[row.group];
    const inGroupClasses = group && group.intact ? ["in-group", group.rows.at(-1) === row && "group-last"] : [];
    const classes = [row.kind, row.blockId !== undefined && "block", row.swapped && "swapped", row.inserted && "inserted", row.locked && "locked", ...inGroupClasses];
    return draggable(dropTarget(el("tr", { class: classes.filter(Boolean).join(" ") },
      el("td", { class: "num" }, String(row.index + 1)),
      el("td", { class: "num" }, formatDuration(row.startSec)),
      el("td", { title: row.song.sourceDances ? `Tagged: ${row.song.sourceDances.join(", ")}` : null }, row.dance),
      el("td", { class: "type" }, kindLabel(row)),
      el("td", {}, spotifyListenLink(spotifyLink(row.song.id), row.song.title), row.song.title, row.song.artist && el("span", { class: "muted" }, ` – ${row.song.artist}`),
        row.swapped && el("span", { class: "swap-note", title: `The generator chose: ${row.original.song.title}` }, " (swapped)"),
        row.autoReplaced && !row.swapped && el("div", { class: "muted", style: "font-size:0.85em" },
          `Replaced “${row.autoReplaced.title}” (${row.autoReplaced.why}).`),
        isUnavailable(row.song.id) && el("div", { class: "swap-warning" }, `Warning: ${unavailableReason(row.song.id)}.`)),
      el("td", { class: "num" }, formatDuration(row.song.lengthSec)),
      themed && el("td", { class: "theme-mark" }, row.isTheme ? "Yes" : ""),
      el("td", {}, el("div", { class: "row-actions" },
        el("button", { type: "button", class: row.locked ? "small primary" : "small", "aria-pressed": row.locked ? "true" : "false",
          title: row.locked ? `Unlock ${name}` : `Lock ${name}: "Regenerate unlocked songs" keeps it in its place`,
          "aria-label": row.locked ? `Unlock ${name}` : `Lock ${name}`, onclick: () => doToggleLock(row) }, row.locked ? "🔒 Locked" : "Lock"),
        smallButton("↑", `Move ${name} up`, () => doMoveBy(row, -1)),
        smallButton("↓", `Move ${name} down`, () => doMoveBy(row, 1)),
        smallButton("Swap", `Choose a different song for ${name}`, () => swapFor(row)),
        row.swapped && undoButton("Reset", `Put back the generator's song (${row.original.song.title})`, () => doResetSwap(row)),
        smallButton("Insert before…", `Insert a song before ${name}`, () => insertAt(result.playlist.indexOf(row))),
        smallButton("Insert after…", `Insert a song after ${name}`, () => insertAt(result.playlist.indexOf(row) + 1)),
        row.inserted
          ? undoButton("Remove", `Delete ${name} (added by you)`, () => doRemove(row))
          : smallButton("Remove", `Take ${name} out (it can be restored)`, () => doRemove(row))))), row.index), { item: row });
  };
  /** Each intact block gets a header row before its first song. */
  const rowsWithHeads = () => result.playlist.flatMap((row) => {
    if (row.removed) return [removedRow(row)];
    const group = row.group && groups[row.group];
    const head = group && group.intact && group.rows[0] === row ? [groupHead(row.group, group)] : [];
    return [...head, activeRow(row)];
  });
  const removedRow = (row) =>
    el("tr", { class: "removed" },
      el("td", { class: "num" }, "–"),
      el("td", {}),
      el("td", {}, row.dance),
      el("td", { class: "type" }, kindLabel(row)),
      el("td", {}, el("s", {}, row.song.title), " (removed)"),
      el("td", { class: "num" }, formatDuration(row.song.lengthSec)),
      themed && el("td", {}),
      el("td", {}, el("div", { class: "row-actions" },
        undoButton("Restore", `Put ${row.song.title} back in the playlist`, () => doRestore(row)))));

  fill(box,
    el("ul", { id: "stale", class: "msgs", hidden: !state.stale },
      el("li", { class: "warning" }, "Settings have changed since this playlist was generated.")),
    el("div", { class: "summary" },
      el("span", {}, "Songs: ", el("b", {}, String(activeRows.length)), removedCount ? ` (${removedCount} removed)` : ""),
      el("span", {}, "Length: ", el("b", {}, formatDuration(result.totalSec)), ` (target ${formatDuration(result.targetSec)}, ${differenceSec >= 0 ? "+" : ""}${formatDuration(differenceSec)})`),
      themed && el("span", {}, "Theme share: ", el("b", {}, percent(result.stats.themeFraction)))),
    el("div", { class: "result-actions" },
      el("button", { type: "button", class: "primary", onclick: generate, disabled: state.errors.length > 0 || !state.songs.length }, "Generate another"),
      copyLinks,
      el("button", { type: "button", class: "primary", title: "What is playing and what comes next, during the night (follows Spotify; opens in a new window)",
        onclick: () => window.open("live.html", "dpg-live") }, "Live view"),
      el("button", { type: "button", title: "The song order with each song's dance, to print or download as a Word document",
        onclick: () => window.open("program.html", "dpg-program") }, "Program")),
    linkCount > 0 && saveToSpotifyBox(activeResult(result), links.filter(Boolean).map(spotifyTrackId)),
    linkCount > 0 &&
      el("p", { class: "help" },
        "To build the playlist by hand: copy the Spotify links, open an empty playlist in the Spotify desktop app, " +
          "click in its track list and paste (Ctrl+V)."),
    rowsWithoutLink.length > 0 &&
      el("ul", { class: "msgs" }, el("li", { class: "warning" },
        linkCount
          ? `${rowsWithoutLink.length} song(s) have no Spotify track ID and are left out of the links: ` +
              rowsWithoutLink.map((row) => `#${row.index + 1} ${row.song.title}`).join(", ") + "."
          : "This song library has no Spotify track IDs, so there are no Spotify links to copy.")),
    result.warnings.length > 0 &&
      el("ul", { class: "msgs" },
        result.warnings.map((warning) => el("li", { class: "warning" }, warningPrefix(warning) + warning.message))),
    (result.editViolations || []).length > 0 &&
      el("ul", { class: "msgs" },
        result.editViolations.map((violation) => el("li", { class: "warning" }, `After your changes: ${violation.index >= 0 ? `#${violation.index + 1}: ` : ""}${violation.message}`))),
    el("div", { class: "edit-bar" },
      el("p", { class: "help" }, "Change the playlist with the buttons on each row, or drag a row (a block by its header line) to move it. " +
        "Undo takes back one change at a time; Reset all takes back every change. " +
        "Lock the songs you want to keep, then Regenerate unlocked songs to redo the rest."),
      ...editButtons()),
    el("div", { class: "attribution" }, spotifyCredit()),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {},
          ["#", "Start", "Dance", "Type", "Title", "Length"].map((heading) => el("th", { scope: "col" }, heading)),
          themed && el("th", { scope: "col" }, "Theme?"),
          el("th", { scope: "col" }, el("span", { class: "visually-hidden" }, "Change")))),
        el("tbody", {}, rowsWithHeads(),
          dropTarget(el("tr", { class: "drop-end" }, el("td", { colspan: columnCount, class: "muted" }, "Drop a song here to move it to the end.")), activeRows.length)))),
    el("div", { class: "edit-bar" }, ...editButtons()));
}
