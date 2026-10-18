// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * playlist-stats.js — facts about a generated playlist's rows: the kinds of rows, the theme share,
 * songs per dance and category, and a time formatter.
 *
 * A playlist row is { index, startSec, song, dance, kind, category, source, isTheme, ... } with kind:
 *   "regular"    a song in its category's turn
 *   "excursion"  an excursion
 *   "theme"      a song of the hidden theme category (standalone theme dances)
 *   "block"      a special block's song outside the category turns (from a tag, or a chosen song)
 *   "event"      a song of a special block from dances (never a theme song)
 *   "final"      the last dance of the night
 * Rows of a special block also carry blockId and blockLabel (and blockTag, keepApart, fromDances, chosen).
 */

/** The kinds of rows the theme share is measured over (blocks from dances and the last song are left out). */
export const SHARE_KINDS = new Set(["regular", "excursion", "theme", "block"]);

/** Whether a row is a song of a "keep apart" special block (such blocks are never directly next to each other). */
export const isKeptApartRow = (row) => !!row && row.blockId !== undefined && !!row.keepApart;

/** Songs per dance and per category, the theme share, and the longest run of one category. */
export function computeStats(result) {
  const playlist = result.playlist;
  const perDance = {};
  const perCategory = {};
  for (const row of playlist) {
    perDance[row.dance] = (perDance[row.dance] || 0) + 1;
    if (row.category) perCategory[row.category] = (perCategory[row.category] || 0) + 1;
  }
  // The theme share is measured over regular, hidden-theme, excursion and block songs after the opening
  // (result.openingCount): the opening songs are theme songs anyway.
  const shareRows = playlist.filter((row) => SHARE_KINDS.has(row.kind) && row.index >= (result.openingCount || 0));
  const themeFraction = shareRows.length ? shareRows.filter((row) => row.isTheme).length / shareRows.length : 0;
  let longestRun = 0;
  let runLength = 0;
  let previousCategory = null;
  for (const row of playlist) {
    if (row.kind !== "regular") continue;
    runLength = row.category === previousCategory ? runLength + 1 : 1;
    previousCategory = row.category;
    longestRun = Math.max(longestRun, runLength);
  }
  return { songCount: playlist.length, perDance, perCategory, themeFraction, longestRun };
}

/** Seconds as m:ss (e.g. 185 -> "3:05", -75 -> "-1:15"). */
export function formatTime(totalSec) {
  const sign = totalSec < 0 ? "-" : "";
  // Round to whole seconds first, so 59.6 s is "1:00" (not "0:60").
  const roundedSec = Math.round(Math.abs(totalSec));
  const minutes = Math.floor(roundedSec / 60);
  const seconds = roundedSec % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}`;
}
