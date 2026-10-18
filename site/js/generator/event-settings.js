// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * event-settings.js — the settings of one event (a night): the defaults, filling in what a settings file
 * leaves out, special-block defaults and names, and associations.
 *
 * An association is a group of dances treated as one ("Waltz" = Smooth Waltz + Standard Waltz). It is
 * applied first, to the settings and to the songs: every dance named anywhere is renamed to its group's
 * name, so the generator's rules only ever see the merged dances.
 *
 * Part of the generator engine; the other parts import from here. Pages and tests use generator.js.
 */

/** Every setting, with its default. See generator.js for what each one means. */
export const DEFAULT_SETTINGS = {
  eventLengthMinutes: 180,
  minSongSec: null,
  maxSongSec: null,
  associations: [],
  categories: [],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: { intervalMinutes: 25, jitterMinutes: 0, pool: {} },
  theme: null,
  specialBlocks: [],
  opening: { earlyCount: 6, blacklist: [] },
  closing: { finalDance: null },
  noRepeatWorks: true,
  mustPlay: [],
  seed: null,
};

/** A theme's settings, filled in. */
export const THEME_DEFAULTS = {
  name: "",
  dances: [],
  tags: [],
  fractionMin: 0.5, // broad-theme default; dance-focused themes should use about 0.2-0.25
  fractionMax: 0.7,
  minGap: null, // theme minimum gap; null = the normal gap (minToRepeat) - 2
};

/** A special block's settings, filled in (the agreed spec, NOTES.md v0.4). */
export const BLOCK_DEFAULTS = {
  name: "", // shown in the playlist; empty = its dances, "<tag> block" or "Chosen songs block"
  source: "tag", // "dances": songs of these dances; "tag": songs with the tag; "songs": exactly the chosen songs, in order
  dances: [],
  tag: "",
  songs: [],
  count: 4,
  inTurns: true, // a block from a tag: its songs take part in the category turns
  keepApart: false, // never directly next to another "keep apart" block (default on for blocks from dances)
  notAfter: [], // dances or block names this block may not directly follow
  placement: { mode: "at", at: 0.5, from: 0.3, to: 0.6 },
  interruptBy: { excursions: false, theme: false },
  afterInterruption: "continue",
};

/** A random block point is never in the last part of the night: at most this share of the night. */
export const LATEST_RANDOM_BLOCK_POINT = 0.85;

/** A special block's name: the user's, else its dances, "<tag> block" or "Chosen songs block". */
export const blockLabel = (block) =>
  (block.name && block.name.trim()) ||
  (block.source === "songs" ? "Chosen songs block"
    : block.source === "dances" ? (block.dances || []).join(" / ") || "Dances block"
      : `${block.tag || "Tag"} block`);

/** Whether a block plays outside the category turns (blocks from dances or chosen songs always do). */
export const outsideTurns = (block) => block.source !== "tag" || !block.inTurns;

/** Settings with every missing value filled in from the defaults (nothing renamed yet). */
export function mergeSettings(userSettings = {}) {
  const defaults = DEFAULT_SETTINGS;
  return {
    ...defaults,
    ...userSettings,
    associations: userSettings.associations ?? defaults.associations,
    categories: userSettings.categories ?? defaults.categories,
    excursions: { ...defaults.excursions, ...(userSettings.excursions || {}) },
    opening: { ...defaults.opening, ...(userSettings.opening || {}) },
    closing: { ...defaults.closing, ...(userSettings.closing || {}) },
    mustPlay: [...(userSettings.mustPlay ?? defaults.mustPlay)],
    theme: userSettings.theme ? { ...THEME_DEFAULTS, ...userSettings.theme } : null,
    specialBlocks: (userSettings.specialBlocks ?? defaults.specialBlocks).map((block) => ({
      ...BLOCK_DEFAULTS,
      ...block,
      dances: [...(block.dances || [])],
      notAfter: [...(block.notAfter || [])],
      placement: { ...BLOCK_DEFAULTS.placement, ...(block.placement || {}) },
      interruptBy: { ...BLOCK_DEFAULTS.interruptBy, ...(block.interruptBy || {}) },
    })),
  };
}

/** A song always has `dances`; `tags` may be left out of a library, so it is filled in. */
export function normalizeSong(song) {
  return { ...song, dances: song.dances || [], tags: song.tags || [] };
}

/* ------------------------------------------------------------- associations */

/** A function that turns a dance into its association's name (or leaves it as it is, if in none). */
export function associationMap(associations = []) {
  const groupOfDance = new Map();
  for (const association of associations) {
    for (const dance of association.dances || []) groupOfDance.set(dance, association.name);
  }
  return (dance) => groupOfDance.get(dance) ?? dance;
}

/** A list renamed through `rename`, with the duplicates that renaming creates removed. */
const renameUnique = (list, rename) => [...new Set((list || []).map(rename))];

/** Settings, filled in, with associations applied (every dance named in them renamed to its group). */
export function resolveSettings(userSettings) {
  const settings = mergeSettings(userSettings);
  if (!settings.associations.length) return settings;
  const toGroup = associationMap(settings.associations);
  // Excursion weights of associated dances add up (e.g. Salsa 1 + Mambo 2 = "Mambo / Salsa" 3).
  const pool = {};
  for (const [dance, weight] of Object.entries(settings.excursions.pool)) {
    pool[toGroup(dance)] = (pool[toGroup(dance)] || 0) + weight;
  }
  return {
    ...settings,
    categories: settings.categories.map((category) => ({ ...category, dances: renameUnique(category.dances, toGroup) })),
    excursions: { ...settings.excursions, pool },
    specialBlocks: settings.specialBlocks.map((block) => ({
      ...block,
      dances: renameUnique(block.dances, toGroup),
      notAfter: renameUnique(block.notAfter, toGroup),
    })),
    theme: settings.theme ? { ...settings.theme, dances: renameUnique(settings.theme.dances, toGroup) } : null,
    opening: { ...settings.opening, blacklist: renameUnique(settings.opening.blacklist, toGroup) },
    closing: { ...settings.closing, finalDance: settings.closing.finalDance ? toGroup(settings.closing.finalDance) : null },
  };
}

/** Songs with associations applied to their dances. Each song's original dances are kept in `sourceDances`. */
export function resolveSongs(rawSongs, settings) {
  const toGroup = associationMap(settings.associations);
  return rawSongs.map((rawSong) => {
    const song = normalizeSong(rawSong);
    return { ...song, sourceDances: song.dances, dances: renameUnique(song.dances, toGroup) };
  });
}

/** Whether a song's length is inside the settings' song-length limits (null or 0 = no limit). */
export function withinLengthLimits(song, settings) {
  const lengthSec = song.lengthSec;
  if (settings.minSongSec > 0 && lengthSec < settings.minSongSec) return false;
  if (settings.maxSongSec > 0 && lengthSec > settings.maxSongSec) return false;
  return true;
}

/** The distinct dances of a song list, after associations, sorted (for the pages' pick lists). */
export function listDances(rawSongs, userSettings = {}) {
  const settings = mergeSettings(userSettings);
  const dances = new Set();
  for (const song of resolveSongs(rawSongs, settings)) song.dances.forEach((dance) => dances.add(dance));
  return [...dances].sort();
}
