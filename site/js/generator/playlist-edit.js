// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * playlist-edit.js — changing a generated playlist by hand. No page code: the generator page calls these
 * and redraws; the tests call them directly.
 *
 * A generated playlist (`result`, from generatePlaylist) can be edited. Each row of result.playlist may carry:
 *   swapped + original   the song was swapped; `original` = the generator's choice (for Reset)
 *   inserted             the row was added by hand (Remove deletes it)
 *   removed              a generator row taken out (kept, so it can be Restored)
 *   genIndex             its place when generated (the generator's warnings refer to these)
 *   locked               kept by "Regenerate unlocked songs" (see lockedForRegeneration)
 *   group                the special block (2+ songs) the row belongs to (see groups below)
 *   disbanded            it was in a block that was broken up: labeled by category / Excursion / dance
 * Times, numbering, stats, the rule check and every output use only the rows that are not removed.
 * Rule breaks are reported only if an edit caused them (`baselineViolations` / `editViolations`).
 *
 * Every edit can be undone (`undo`): before each edit the rows are copied onto `result.history`; undoing
 * them all gives the generated playlist back, which is what `resetAll` does in one step.
 *
 * Groups (the agreed spec, NOTES.md v0.2.5): special blocks with several songs. A group is intact while
 * its songs are together (in any order) and "modified" if its songs were reordered, swapped or removed;
 * if another song lands inside it or its songs are scattered, it is disbanded: its songs lose the block,
 * are labeled by category / "Excursion" / dance, and are locked.
 */

import { associationMap, checkRules, computeStats } from "./generator.js";

/** The rows actually in the playlist (removed ones left out), in order. */
export const activeItems = (result) => result.playlist.filter((row) => !row.removed);
/** The playlist with only its active rows. */
export const activeResult = (result) => ({ ...result, playlist: activeItems(result) });
/** Whether the playlist was changed by hand at all. */
export const hasEdits = (result) =>
  !!result && ((result.history && result.history.length > 0) || result.playlist.some((row) => row.swapped || row.inserted || row.removed));
/** A rule break tied to its song (not its place), so it survives insertions and removals. */
export const violationKey = (violation, rows) =>
  `${violation.rule}|${violation.index >= 0 && rows[violation.index] ? rows[violation.index].song.id : "-"}`;

/** The " (modified)" ending of a group's label. */
const MODIFIED_ENDING = / \(modified\)$/;

/** Make a freshly generated playlist ready for editing. */
export function prepareGenerated(result, settings) {
  result.playlist.forEach((row) => (row.genIndex = row.index));
  result.history = [];
  assignGroups(result);
  rebaseline(result, settings);
  updateGroups(result);
  return result;
}

/* ------------------------------------------------------------------ groups */

/** Number the generated playlist's groups: special blocks with 2+ songs. */
function assignGroups(result) {
  result.groups = {};
  const rows = activeItems(result);
  let groupCount = 0;
  for (const row of rows) {
    if (row.disbanded || row.group) continue;
    const members = row.blockId !== undefined ? rows.filter((other) => other.blockId === row.blockId && !other.disbanded) : [];
    if (members.length < 2) continue;
    const groupId = `g${++groupCount}`;
    const label = row.groupLabel || row.blockLabel || row.source || "Block";
    result.groups[groupId] = { label: label.replace(MODIFIED_ENDING, ""), songIds: members.map((member) => member.song.id), modifiedBefore: MODIFIED_ENDING.test(label) };
    members.forEach((member) => (member.group = groupId));
  }
}

/**
 * Each group's state now: { intact, modified, label, rows }. A group is intact while its rows sit
 * together; modified if they were reordered, swapped or removed (or it was modified before).
 */
export function groupStates(result) {
  const rows = activeItems(result);
  const states = {};
  for (const [groupId, group] of Object.entries(result.groups || {})) {
    const members = rows.filter((row) => row.group === groupId && !row.disbanded);
    if (!members.length) continue;
    const intact = members.every((member, iMember) => iMember === 0 || member.index === members[iMember - 1].index + 1);
    const songIds = members.map((member) => member.song.id);
    const modified = group.modifiedBefore || songIds.join("\u0000") !== group.songIds.join("\u0000");
    states[groupId] = { intact, modified, label: group.label + (modified ? " (modified)" : ""), rows: members };
  }
  return states;
}

/** Break up groups whose songs are no longer together: they lose the block and are locked. */
function updateGroups(result) {
  for (const group of Object.values(groupStates(result))) {
    if (group.intact) continue;
    for (const row of group.rows) {
      row.disbanded = true;
      row.locked = true;
      row.disbandedFrom = { blockId: row.blockId };
      delete row.group;
      for (const field of ["blockId", "blockLabel", "blockTag", "keepApart", "groupLabel"]) delete row[field];
    }
  }
}

/** The "Type" of a row: its block (with "(modified)"), else its category, "Excursion" or its dance; null for the usual label. */
export function typeLabel(row, result, settings) {
  const group = row.group && groupStates(result)[row.group];
  if (group && group.intact) return row.kind === "regular" && row.category ? `${group.label} (${row.category})` : group.label;
  if (row.disbanded || row.group) {
    const categoryName = categoryNameOf(row.dance, settings);
    if (categoryName) return categoryName;
    const toGroup = associationMap(settings.associations);
    const excursionDances = Object.keys((settings.excursions && settings.excursions.pool) || {}).map(toGroup);
    return excursionDances.includes(row.dance) ? "Excursion" : row.dance;
  }
  return null; // the usual label (category, Excursion, block, …)
}

/* -------------------------------------------------------------------- undo */

/** Remember the rows as they are, so this edit can be undone. */
function remember(result) {
  result.history = result.history || [];
  result.history.push(result.playlist.map((row) => ({ ...row })));
}

/** Undo the last edit (of any kind). */
export function undo(result, settings) {
  if (!result.history || !result.history.length) return result;
  result.playlist = result.history.pop();
  return recompute(result, settings);
}

/** Every edit goes through here: remember, change, then recompute and break up split groups. */
function edit(result, settings, change) {
  remember(result);
  change();
  recompute(result, settings);
  updateGroups(result);
  return result;
}

/* -------------------------------------------------------------- move, lock */

/** Move a row to just before the active row now at `toIndex` (or to the end). */
export function moveItem(result, row, toIndex, settings) {
  if (row.index === toIndex || row.index + 1 === toIndex) return result; // dropped on itself, or where it already is
  return edit(result, settings, () => moveRows(result, [row], toIndex));
}

/** Move every row of an intact group, in its current order, to just before the active row at `toIndex`. */
export function moveGroup(result, groupId, toIndex, settings) {
  const group = groupStates(result)[groupId];
  if (!group) return result;
  const firstIndex = group.rows[0].index;
  if (toIndex >= firstIndex && toIndex <= group.rows.at(-1).index + 1) return result; // onto itself, or where it already is
  return edit(result, settings, () => moveRows(result, group.rows, toIndex));
}

/** Take `rows` out and put them back just before the active row at `toIndex` (or at the end). */
function moveRows(result, rows, toIndex) {
  const target = activeItems(result).find((row) => row.index === toIndex && !rows.includes(row)) || null;
  result.playlist = result.playlist.filter((row) => !rows.includes(row));
  const insertAt = target ? result.playlist.indexOf(target) : result.playlist.length;
  result.playlist.splice(insertAt, 0, ...rows);
}

/** Move a row one place up (-1) or down (+1) among the active rows. */
export function moveBy(result, row, by, settings) {
  const rows = activeItems(result);
  const fromPlace = rows.indexOf(row);
  const toPlace = fromPlace + by;
  if (fromPlace < 0 || toPlace < 0 || toPlace >= rows.length) return result;
  // Down: before the row after the next one.
  return moveItem(result, row, by < 0 ? rows[toPlace].index : toPlace + 1 < rows.length ? rows[toPlace + 1].index : rows.length, settings);
}

/** Move an intact group one place up or down (past the neighboring row). */
export function moveGroupBy(result, groupId, by, settings) {
  const group = groupStates(result)[groupId];
  if (!group) return result;
  const rowCount = activeItems(result).length;
  const firstIndex = group.rows[0].index;
  const lastIndex = group.rows.at(-1).index;
  if (by < 0 && firstIndex === 0) return result;
  if (by > 0 && lastIndex === rowCount - 1) return result;
  return moveGroup(result, groupId, by < 0 ? firstIndex - 1 : lastIndex + 2 < rowCount ? lastIndex + 2 : rowCount, settings);
}

export const toggleLock = (result, row, settings) => edit(result, settings, () => (row.locked = !row.locked));
export const lockAll = (result, settings) => edit(result, settings, () => activeItems(result).forEach((row) => (row.locked = true)));
export const unlockAll = (result, settings) => edit(result, settings, () => result.playlist.forEach((row) => (row.locked = false)));

/**
 * What "Regenerate unlocked songs" keeps (the agreed spec, NOTES.md v0.2.5), for the generator's
 * `locked` option: [{ position, row }] plus the blocks not to create again.
 *   - a locked row keeps its place;
 *   - an intact group with locked songs keeps only those, together, from its first locked song's
 *     place ("(modified)" if any were dropped), and is not created again;
 *   - a disbanded group whose songs are (partly) locked is not created again either.
 */
export function lockedForRegeneration(result) {
  const rows = activeItems(result);
  const groups = groupStates(result);
  const keep = [];
  const skipBlocks = new Set();
  const handled = new Set();
  for (const row of rows) {
    if (handled.has(row)) continue;
    const group = row.group && groups[row.group];
    if (group && group.intact) {
      group.rows.forEach((member) => handled.add(member));
      const lockedMembers = group.rows.filter((member) => member.locked);
      if (!lockedMembers.length) continue;
      const dropped = lockedMembers.length < group.rows.length;
      const label = group.label.replace(MODIFIED_ENDING, "") + (group.modified || dropped ? " (modified)" : "");
      lockedMembers.forEach((member, iMember) => keep.push({
        position: lockedMembers[0].index + iMember,
        row: { ...member, groupLabel: label, blockLabel: member.blockLabel ? label : member.blockLabel },
      }));
      skipBlocks.add(row.blockId);
      continue;
    }
    handled.add(row);
    if (!row.locked) continue;
    keep.push({ position: row.index, row: { ...row } });
    // A one-song block that is kept is not created again.
    if (!row.disbanded && row.blockId !== undefined) skipBlocks.add(row.blockId);
    if (row.disbanded && row.disbandedFrom) skipBlocks.add(row.disbandedFrom.blockId);
  }
  // Places must not collide: a later row moves down one place if needed.
  keep.sort((first, second) => first.position - second.position);
  for (let iKept = 1; iKept < keep.length; iKept++) {
    if (keep[iKept].position <= keep[iKept - 1].position) keep[iKept].position = keep[iKept - 1].position + 1;
  }
  return { keep, skipBlocks: [...skipBlocks] };
}

/** Remember which rules are broken right now, so later edits only report problems they cause. */
export function rebaseline(result, settings) {
  const rows = activeItems(result);
  result.baselineViolations = checkRules({ ...result, playlist: rows }, settings).map((violation) => violationKey(violation, rows));
  result.editViolations = [];
}

/** A library song in the form the playlist uses (dances after associations). */
export function asPlaylistSong(song, settings) {
  const toGroup = associationMap(settings.associations);
  return { ...song, sourceDances: song.dances, dances: [...new Set(song.dances.map(toGroup))] };
}

/** Whether a song counts toward the theme when played as `dance`. */
export function isThemeSong(song, dance, kind, settings) {
  if (!settings.theme || kind === "event") return false; // songs of a block from dances are never theme songs
  const toGroup = associationMap(settings.associations);
  return new Set((settings.theme.dances || []).map(toGroup)).has(dance) ||
    (song.tags || []).some((tag) => (settings.theme.tags || []).includes(tag));
}

/** The category a dance (after associations) belongs to, or null. */
function categoryNameOf(dance, settings) {
  const toGroup = associationMap(settings.associations);
  const category = settings.categories.find((candidate) => candidate.dances.some((member) => toGroup(member) === dance));
  return category ? category.name : null;
}

/** After any edit: renumber, retime, restat, and check the rules again (reporting only new problems). */
export function recompute(result, settings) {
  let elapsedSec = 0;
  let rowCount = 0;
  for (const row of result.playlist) {
    if (row.removed) {
      row.index = -1;
      continue;
    }
    row.index = rowCount++;
    row.startSec = elapsedSec;
    elapsedSec += row.song.lengthSec;
  }
  result.totalSec = elapsedSec;
  result.overtimeSec = elapsedSec - result.targetSec;
  const active = activeResult(result);
  result.stats = computeStats(active);
  const brokenBefore = new Set(result.baselineViolations || []);
  result.editViolations = checkRules(active, settings).filter((violation) => !brokenBefore.has(violationKey(violation, active.playlist)));
  // The generator never repeats a song, so its rule check does not look for that; hand edits can.
  const firstIndexOfSong = new Map();
  for (const row of active.playlist) {
    if (firstIndexOfSong.has(row.song.id)) {
      result.editViolations.push({ rule: "duplicate", index: row.index, message: `“${row.song.title}” is also #${firstIndexOfSong.get(row.song.id) + 1}.` });
    } else firstIndexOfSong.set(row.song.id, row.index);
  }
  return result;
}

/** Put `song` (a library song) into a row. A song of another dance changes what the row is. */
export function swapSong(result, row, song, dance, settings) {
  return edit(result, settings, () => swapInto(row, song, dance, settings));
}
function swapInto(row, song, dance, settings) {
  if (!row.original) row.original = { song: row.song, dance: row.dance, isTheme: row.isTheme };
  row.song = asPlaylistSong(song, settings);
  if (!row.song.dances.includes(row.dance)) row.dance = dance || row.song.dances[0] || row.dance;
  row.isTheme = isThemeSong(row.song, row.dance, row.kind, settings);
  row.swapped = !row.inserted; // an inserted row just gets a different song
  if (row.inserted) delete row.original;
}

/** Put back the generator's song in a swapped row. */
export function resetSwap(result, row, settings) {
  return edit(result, settings, () => {
    Object.assign(row, row.original);
    delete row.original;
    row.swapped = false;
  });
}

/** Insert a library song at `position` in result.playlist, played as `dance` (if it has it). */
export function insertSong(result, position, song, dance, settings) {
  const playlistSong = asPlaylistSong(song, settings);
  const playedAs = dance && playlistSong.dances.includes(dance) ? dance : playlistSong.dances[0] || "";
  return edit(result, settings, () => result.playlist.splice(position, 0, {
    song: playlistSong, dance: playedAs, kind: "inserted", category: playedAs ? categoryNameOf(playedAs, settings) : null, source: null,
    isTheme: isThemeSong(playlistSong, playedAs, "inserted", settings), inserted: true,
  }));
}

/** Remove a row: a row added by hand is deleted; a generator row is kept (removed) so it can be restored. */
export function removeItem(result, row, settings) {
  return edit(result, settings, () => {
    if (row.inserted) result.playlist.splice(result.playlist.indexOf(row), 1);
    else row.removed = true;
  });
}

/** Put a removed row back. */
export function restoreItem(result, row, settings) {
  return edit(result, settings, () => (row.removed = false));
}

/** Undo every manual change (locks included): exactly the playlist the generator made. */
export function resetAll(result, settings) {
  if (!result.history || !result.history.length) return result;
  result.playlist = result.history[0];
  result.history = [];
  return recompute(result, settings);
}
