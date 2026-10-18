// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * night-state.js — the working state of one night while it is generated, shared by every part of the
 * generator: the settings, the songs, the random numbers, the playlist so far, which songs are used,
 * locked rows, and the basic moves (is a song still free? pick one; add it to the playlist).
 *
 * createNight() makes it; generate-playlist.js passes it to the other parts (category turns, theme
 * songs, excursions, special blocks, must-play songs), which read and change it as the night grows.
 *
 * Changing values are properties of the night (elapsedSec, placingChosen, worksRelaxed, themeShareRows,
 * themeShareThemeRows), so every part sees the same ones.
 */

import { resolveSettings, resolveSongs, withinLengthLimits, LATEST_RANDOM_BLOCK_POINT } from "./event-settings.js";
import { themeInfo, themePlan } from "./theme-plan.js";
import { SHARE_KINDS } from "./playlist-stats.js";
import { workKey, recordingKey } from "../shared/works.js";

/**
 * A small random-number generator that can be started from a seed ("mulberry32"), so a night can be
 * made again exactly from its seed. Returns a function giving numbers from 0 (included) to 1 (not).
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fields of a locked row that are put back as they were ("Regenerate unlocked songs"): its block, its
 * chosen / must-play marks, and the editing marks of js/generator/playlist-edit.js.
 */
const KEPT_FIELDS = ["blockId", "blockLabel", "blockTag", "keepApart", "fromDances", "chosen", "mustPlay", "groupLabel", "disbanded", "disbandedFrom", "inserted"];

/**
 * The working state of a night. `options` as for generatePlaylist: songFilter (a song may play at a
 * place, or not) and locked (rows kept in their places, from lockedForRegeneration).
 */
export function createNight(rawSongs, userSettings, options) {
  const settings = resolveSettings(userSettings);
  const seed = settings.seed ?? ((Math.random() * 2 ** 32) >>> 0);
  const random = mulberry32(seed);
  /** A whole number from 0 to count - 1. */
  const randomInt = (count) => Math.floor(random() * count);
  /** One item of a list, at random. */
  const pickRandom = (list) => list[randomInt(list.length)];
  /** A shuffled copy of a list (Fisher-Yates: from the end, swap each item with one at or before it). */
  const shuffled = (list) => {
    const copy = list.slice();
    for (let iLast = copy.length - 1; iLast > 0; iLast--) {
      const iSwap = randomInt(iLast + 1);
      [copy[iLast], copy[iSwap]] = [copy[iSwap], copy[iLast]];
    }
    return copy;
  };
  const songFilter = options.songFilter || null;

  /* ---- the songs ---- */
  // Songs outside the length limits are left out entirely, so every rule (including the end-of-night
  // timing, which uses the shortest song) only sees the songs that can play.
  const allSongs = resolveSongs(rawSongs, settings);
  const songs = allSongs.filter((song) => withinLengthLimits(song, settings));
  const songById = new Map(allSongs.map((song) => [song.id, song])); // chosen songs may break the length limits
  const songsByDance = new Map();
  for (const song of songs) {
    for (const dance of song.dances) {
      if (!songsByDance.has(dance)) songsByDance.set(dance, []);
      songsByDance.get(dance).push(song);
    }
  }
  const shortestSongSec = songs.length ? Math.min(...songs.map((song) => song.lengthSec)) : 0;
  const averageSongSec = songs.length ? songs.reduce((total, song) => total + song.lengthSec, 0) / songs.length : 0;

  /* ---- the settings, prepared ---- */
  const targetSec = settings.eventLengthMinutes * 60;
  const categories = settings.categories.map((category) => ({ name: category.name, dances: [...category.dances] }));
  const categoryOfDance = new Map(); // dance -> index of its category
  categories.forEach((category, iCategory) => category.dances.forEach((dance) => categoryOfDance.set(dance, iCategory)));
  const theme = themeInfo(settings);
  const plan = themePlan(settings, theme);
  const startingPool = settings.excursions.pool;
  // Every dance the settings use: category dances, excursions, standalone theme dances (in this order).
  const dancesTheSettingsUse = [...new Set([
    ...categoryOfDance.keys(),
    ...Object.keys(startingPool).filter((dance) => startingPool[dance] > 0),
    ...plan.standalone,
  ])];

  // Duplicates (same recording) never play in one night; with noRepeatWorks, nor do two versions of one work.
  const recordingOf = new Map(allSongs.map((song) => [song.id, recordingKey(song)]));
  const workOf = new Map(allSongs.map((song) => [song.id, workKey(song)]));

  const night = {
    settings,
    seed,
    random,
    randomInt,
    pickRandom,
    shuffled,
    songFilter,

    allSongs,
    songs,
    songById,
    songsByDance,
    shortestSongSec,
    averageSongSec,
    targetSec,
    categories,
    categoryOfDance,
    theme,
    plan,
    themeLabel: (settings.theme && settings.theme.name) || "Theme",
    themeMidShare: theme.active ? (settings.theme.fractionMin + settings.theme.fractionMax) / 2 : 0,
    notThemeTag: (song) => !theme.hasTag(song),
    openingBlacklist: new Set(settings.opening.blacklist),
    dancesTheSettingsUse,
    // The opening's share of the night (about): a random block point or a must-play song comes after it.
    openingShare: targetSec ? Math.min(LATEST_RANDOM_BLOCK_POINT, (settings.opening.earlyCount * averageSongSec) / targetSec) : 0,
    // The theme share is measured over regular, hidden-theme, excursion and block songs after the opening
    // (the opening songs are theme songs anyway, so counting them would hold the theme back afterwards).
    openingCount: theme.active ? settings.opening.earlyCount : 0,

    warnings: [],
    playlist: [],
    danceHistory: [], // the dance of each place so far, for the repeat gap
    elapsedSec: 0,
    themeShareRows: 0, // songs the theme share is measured over, so far
    themeShareThemeRows: 0, // of which theme songs

    usedIds: new Set(),
    usedRecordings: new Set(),
    usedWorks: new Set(),
    // Chosen songs of special blocks and must-play songs are kept for their moment, and so are their duplicates.
    reservedIds: new Set(),
    reservedRecordings: new Set(),
    recordingOf,
    workOf,
    placingChosen: false, // a chosen or must-play song's work does not count toward the works rule
    worksRelaxed: false, // set while a relaxation level allows versions of the same song
    finalReserveSec: 0, // the length of the last song, kept free at the end of the night

    // Set by special-blocks.js: the dances other songs should avoid now (or null).
    upcomingDances: () => null,
  };

  night.warn = (index, message) => night.warnings.push({ index, message });

  night.markUsed = (song) => {
    night.usedIds.add(song.id);
    night.usedRecordings.add(recordingOf.get(song.id));
    if (!night.placingChosen) night.usedWorks.add(workOf.get(song.id));
  };

  /** Whether a song may still play tonight: not played, not a duplicate of one, not kept for later, not another version (unless relaxed). */
  night.isFresh = (song) =>
    !night.usedIds.has(song.id) && !night.usedRecordings.has(recordingOf.get(song.id)) &&
    !night.reservedIds.has(song.id) && !night.reservedRecordings.has(recordingOf.get(song.id)) &&
    (!settings.noRepeatWorks || night.worksRelaxed || !night.usedWorks.has(workOf.get(song.id)));

  /* ---- locked rows ("Regenerate unlocked songs", the agreed spec, NOTES.md v0.2.5) ----
   * Each keeps its place and counts as played from the start (no repeats of it; the repeat gap is kept
   * around it). */
  const lockedPlan = options.locked || null;
  night.lockedPlan = lockedPlan;
  night.lockedAt = new Map(); // place -> row
  night.lockedFinal = null;
  for (const { position, row } of (lockedPlan && lockedPlan.keep) || []) {
    if (row.kind === "final") night.lockedFinal = row;
    else night.lockedAt.set(position, row);
    night.placingChosen = !!(row.chosen || row.mustPlay);
    night.markUsed(row.song);
    night.placingChosen = false;
  }
  // A dance with a locked song skips the shuffle-bag tonight (like a theme dance; it keeps the gap),
  // so a locked song coming up never leaves its category's bag stuck.
  night.lockedDances = new Set([...night.lockedAt.values()].filter((row) => row.kind !== "final").map((row) => row.dance));

  /** Whether a locked song of this dance comes up within the next `gap` places after place `fromPlace`. */
  night.lockedAhead = (dance, gap, fromPlace) => {
    for (let placesAhead = 1; placesAhead <= gap; placesAhead++) {
      const row = night.lockedAt.get(fromPlace + placesAhead);
      if (row && row.dance === dance) return true;
    }
    return false;
  };

  /** Whether the next `songCount` places are free of locked rows (a special block needs room). */
  night.freeFor = (songCount) => {
    for (let placesAhead = 0; placesAhead < songCount; placesAhead++) {
      if (night.lockedAt.has(night.playlist.length + placesAhead)) return false;
    }
    return true;
  };

  /* ---- picking songs ---- */

  /** The songs of a dance that may play now. `reuse`: played songs too; `require`: a song filter. */
  night.availableSongs = (dance, reuse, require = null) =>
    (songsByDance.get(dance) || []).filter(
      (song) =>
        (reuse || night.isFresh(song)) &&
        (!require || require(song)) &&
        (!songFilter || songFilter(song, { dance, elapsed: night.elapsedSec, index: night.playlist.length }))
    );
  night.hasSong = (dance, reuse, require = null) => night.availableSongs(dance, reuse, require).length > 0;

  /** A song of a dance, at random, or null. `require` is a hard song filter; `prefer` a soft one (ignored if nothing matches). */
  night.pickSong = (dance, reuse = false, { require = null, prefer = null } = {}) => {
    let candidates = night.availableSongs(dance, reuse, require);
    if (prefer) {
      const preferred = candidates.filter(prefer);
      if (preferred.length) candidates = preferred;
    }
    return candidates.length ? pickRandom(candidates) : null;
  };

  /** Whether a dance keeps the repeat gap: not among the last `gap` songs, and no locked song of it within `gap` places ahead. */
  night.gapAllowed = (dance, gap) =>
    gap <= 0 || (!night.danceHistory.slice(-gap).includes(dance) && !night.lockedAhead(dance, gap, night.playlist.length));

  night.isInOpening = () => night.playlist.length < settings.opening.earlyCount;

  /** Theme steering for the next place: "want" (below the share), "avoid" (above it) or "neutral". */
  night.themeMood = () => {
    if (!theme.active) return "neutral";
    const share = night.themeShareRows ? night.themeShareThemeRows / night.themeShareRows : 0;
    if (share < settings.theme.fractionMin) return "want";
    if (share > settings.theme.fractionMax) return "avoid";
    return random() < night.themeMidShare ? "want" : "neutral";
  };

  /** Add a song to the playlist (see playlist-stats.js for the kinds of rows). */
  night.addSong = (dance, song, kind, category, source) => {
    // Songs of a block from dances (kind "event") are never theme songs and not in the theme share.
    const isTheme = kind !== "event" && theme.isThemeSong(song, dance);
    night.playlist.push({
      index: night.playlist.length,
      startSec: night.elapsedSec,
      song,
      dance,
      kind,
      category,
      source,
      isTheme,
    });
    night.danceHistory.push(dance);
    night.markUsed(song);
    night.elapsedSec += song.lengthSec;
    if (SHARE_KINDS.has(kind) && night.playlist.length > night.openingCount) {
      night.themeShareRows++;
      if (isTheme) night.themeShareThemeRows++;
    }
  };

  /** The row just added. */
  night.lastRow = () => night.playlist[night.playlist.length - 1];

  /**
   * Put a locked row in its place, as it was (block, chosen / must-play marks and all). Locked songs are
   * the user's choice: they stand outside the category turns, the shuffle-bags and the excursion counts
   * (the repeat gap is still kept around them, see lockedAhead).
   */
  night.placeLocked = (row) => {
    const iCategory = row.kind === "regular" ? categoryOfDance.get(row.dance) : undefined;
    night.placingChosen = !!(row.chosen || row.mustPlay);
    night.addSong(row.dance, row.song, row.kind, iCategory !== undefined ? categories[iCategory].name : row.category ?? null, row.source ?? null);
    night.placingChosen = false;
    const placed = night.lastRow();
    for (const field of KEPT_FIELDS) if (row[field] !== undefined) placed[field] = row[field];
    placed.locked = true;
  };

  return night;
}
