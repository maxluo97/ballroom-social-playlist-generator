// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * validate-settings.js — the settings check before generating: errors (generating would make no sense)
 * and warnings (it works, but some preference will often be missed). The generator page shows both.
 */

import { DANCE_ALIASES, BALLROOM_DANCE_NAMES } from "../shared/dance-names.js";
import { mergeSettings, resolveSettings, resolveSongs, normalizeSong, withinLengthLimits, blockLabel, outsideTurns } from "./event-settings.js";
import { themeInfo, themePlan } from "./theme-plan.js";
import { formatTime } from "./playlist-stats.js";

/** Dance names the app knows (plain and ballroom-styled), for spotting typos in associations. */
const KNOWN_DANCE_NAMES = new Set([...Object.keys(DANCE_ALIASES), ...BALLROOM_DANCE_NAMES]);

const percent = (fraction) => `${(fraction * 100).toFixed(0)}%`;

/** Associations: every one named, names unique, each dance in at most one association. */
function validateAssociations(settings, libraryDances, errors, warnings) {
  const associationOfDance = new Map();
  const names = new Set();
  for (const association of settings.associations) {
    if (!association.name || !association.name.trim()) {
      errors.push("Every association needs a name.");
      continue;
    }
    if (names.has(association.name)) errors.push(`Two associations are both named "${association.name}".`);
    names.add(association.name);
    if (!association.dances || !association.dances.length) warnings.push(`Association "${association.name}" has no dances.`);
    for (const dance of association.dances || []) {
      if (associationOfDance.has(dance)) {
        errors.push(`Dance "${dance}" is in both associations "${associationOfDance.get(dance)}" and "${association.name}".`);
      }
      associationOfDance.set(dance, association.name);
      // Members without songs are harmless (the association's own name, or a dance the library may
      // gain later, e.g. plain "Jive"); only unrecognized names are reported, as likely typos.
      if (!libraryDances.has(dance) && dance !== association.name && !KNOWN_DANCE_NAMES.has(dance)) {
        warnings.push(`Association "${association.name}": no songs are tagged "${dance}" (typo?).`);
      }
    }
  }
  for (const name of names) {
    if (associationOfDance.has(name) && associationOfDance.get(name) !== name) {
      errors.push(`"${name}" is an association name and also a member of "${associationOfDance.get(name)}".`);
    }
  }
}

/**
 * Check settings against a song list before generating. Returns { errors, warnings } (lists of text).
 * Errors mean generating would be meaningless; warnings mean it will work but may not satisfy every
 * preference.
 */
export function validateSettings(rawSongs, userSettings) {
  const errors = [];
  const warnings = [];
  const libraryDances = new Set(rawSongs.flatMap((song) => normalizeSong(song).dances));
  validateAssociations(mergeSettings(userSettings), libraryDances, errors, warnings);
  const settings = resolveSettings(userSettings);
  const allSongs = resolveSongs(rawSongs, settings);
  const songs = allSongs.filter((song) => withinLengthLimits(song, settings)); // the songs that can actually play
  const afterAssociations = settings.associations.length ? " (after associations)" : "";
  const songCountOf = (dance) => songs.filter((song) => song.dances.includes(dance)).length;
  const averageSongSec = songs.length ? songs.reduce((total, song) => total + song.lengthSec, 0) / songs.length : 0;

  /* ---- event basics ---- */
  if (!(settings.eventLengthMinutes > 0)) errors.push("Event length must be positive.");
  if (settings.minSongSec > 0 && settings.maxSongSec > 0 && settings.minSongSec > settings.maxSongSec) {
    errors.push(`The shortest allowed song (${formatTime(settings.minSongSec)}) is longer than the longest allowed song (${formatTime(settings.maxSongSec)}).`);
  }
  const outsideLimitsCount = allSongs.length - songs.length;
  if (outsideLimitsCount > 0) {
    warnings.push(`${outsideLimitsCount} of ${allSongs.length} songs are outside the song length limits and will not be played.`);
  }
  if (!settings.categories.length) errors.push("At least one category is required.");
  if (!(settings.maxInARow >= 1)) errors.push("maxInARow must be at least 1.");
  if (!(settings.minToRepeat >= 0)) errors.push("minToRepeat cannot be negative.");
  if (songs.some((song) => !(song.lengthSec > 0))) errors.push("Every song needs a positive lengthSec.");

  /* ---- categories ---- */
  const categoryOfDance = new Map();
  for (const category of settings.categories) {
    if (!category.dances || !category.dances.length) errors.push(`Category "${category.name}" has no dances.`);
    for (const dance of category.dances || []) {
      if (categoryOfDance.has(dance)) errors.push(`Dance "${dance}" is in both "${categoryOfDance.get(dance)}" and "${category.name}"${afterAssociations}.`);
      categoryOfDance.set(dance, category.name);
      if (songCountOf(dance) === 0) {
        const outsideLimits = allSongs.filter((song) => song.dances.includes(dance)).length;
        warnings.push(outsideLimits
          ? `All ${outsideLimits} song(s) tagged "${dance}" are outside the song length limits.`
          : `No songs are tagged "${dance}".`);
      }
    }
  }

  // Spacing feasibility: with too few dances, minToRepeat forces (or breaks) the order.
  const categoryDancesWithSongs = [...categoryOfDance.keys()].filter((dance) => songCountOf(dance) > 0);
  const openingBlacklist = new Set(settings.opening.blacklist);
  const dancesCount = categoryDancesWithSongs.length;
  if (dancesCount && dancesCount <= settings.minToRepeat) {
    warnings.push(`Only ${dancesCount} dances are available but minToRepeat=${settings.minToRepeat}; spacing will often be relaxed.`);
  } else if (dancesCount && dancesCount === settings.minToRepeat + 1) {
    warnings.push(
      `With ${dancesCount} dances and minToRepeat=${settings.minToRepeat}, the dance order is almost fixed; ` +
        `rules will sometimes be relaxed. Consider a lower minToRepeat.`
    );
  }
  const openableDances = categoryDancesWithSongs.filter((dance) => !openingBlacklist.has(dance));
  if (settings.opening.earlyCount > 1 && openableDances.length && openableDances.length <= Math.min(settings.minToRepeat, settings.opening.earlyCount - 1)) {
    warnings.push(`Only ${openableDances.length} dances are allowed in the opening but minToRepeat=${settings.minToRepeat}; spacing will be relaxed there.`);
  }

  /* ---- the theme ---- */
  const excursionPool = settings.excursions.pool;
  const theme = themeInfo(settings);
  if (settings.theme) {
    if (!theme.active) warnings.push("The theme has no dances or tags, so it has no effect.");
    if (settings.theme.fractionMin > settings.theme.fractionMax) errors.push("Theme fractionMin exceeds fractionMax.");
    for (const dance of theme.dances) {
      // A theme dance is meant to be played a lot, so it belongs in a category, not among the excursions.
      if (excursionPool[dance] > 0) {
        warnings.push(`Theme dance "${dance}" is still an excursion. A theme dance belongs in a category; consider removing it from the excursions.`);
      }
      if (!categoryOfDance.has(dance) && !(excursionPool[dance] > 0) && songCountOf(dance) === 0) {
        warnings.push(`No songs are tagged "${dance}" (theme dance).`);
      }
    }
    for (const tag of theme.tags) {
      if (!songs.some((song) => song.tags.includes(tag))) warnings.push(`No songs carry the theme tag "${tag}".`);
    }
    if (settings.theme.minGap != null && !(settings.theme.minGap >= 0)) errors.push("The theme minimum gap cannot be negative.");
    const plan = themePlan(settings, theme);

    if (!theme.tags.size) {
      // Each theme dance can fill at most 1 slot in every (gap + 1): the normal gap for theme dances in a
      // category, the standalone gap for the hidden theme category. Excursions are not steered by the theme.
      const themeDancesInCategories = plan.catDances.filter((dance) => songCountOf(dance) > 0);
      const themeDancesInPool = [...theme.dances].filter((dance) => !categoryOfDance.has(dance) && excursionPool[dance] > 0 && songCountOf(dance) > 0);
      const standaloneDances = plan.standalone.filter((dance) => songCountOf(dance) > 0);
      // Categories also take turns equally, and a theme dance in a category only plays in that category's
      // turns: with theme dances in one of two categories, at most about half of the category songs can be
      // theme songs, whatever the theme share asks for. Excursions are not steered, so they lower it further.
      const categoriesWithTheme = settings.categories.filter((category) => category.dances.some((dance) => themeDancesInCategories.includes(dance))).length;
      const turnShare = settings.categories.length ? categoriesWithTheme / settings.categories.length : 0;
      const hasExcursions = settings.excursions.intervalMinutes > 0 && Object.values(excursionPool).some((weight) => weight > 0);
      // About one excursion per interval, out of (event length / average song length) songs.
      const excursionShare = hasExcursions && averageSongSec
        ? Math.min(1, settings.eventLengthMinutes / settings.excursions.intervalMinutes / ((settings.eventLengthMinutes * 60) / averageSongSec))
        : 0;
      const gapCeiling = themeDancesInCategories.length / (settings.minToRepeat + 1);
      const turnCeiling = turnShare * (1 - excursionShare);
      const limitedByTurns = themeDancesInCategories.length > 0 && turnCeiling < gapCeiling;
      const ceiling = Math.min(1, Math.min(gapCeiling, turnCeiling) + standaloneDances.length / (plan.standaloneGap + 1));
      // Theme dances in no category have a shorter repeat gap (the hidden theme category), so taking
      // them out of their categories can raise the ceiling: suggest it when it would.
      const playableThemeDances = themeDancesInCategories.length + standaloneDances.length;
      const gapIfMovedOut = playableThemeDances === 1 ? plan.minGap : playableThemeDances;
      const ceilingIfMovedOut = Math.min(1, playableThemeDances / (gapIfMovedOut + 1));
      const moveOutHint = themeDancesInCategories.length && ceilingIfMovedOut > ceiling + 1e-9
        ? ` To allow more, remove ${themeDancesInCategories.map((dance) => `"${dance}"`).join(", ").replace(/, ([^,]*)$/, " and $1")} from ${themeDancesInCategories.length > 1 ? "their categories" : "its category"}: ` +
          `theme dances in no category have a shorter repeat gap, which allows up to about ${percent(ceilingIfMovedOut)}.`
        : "";
      if (playableThemeDances && settings.theme.fractionMin >= ceiling - 1e-9) {
        warnings.push(limitedByTurns
          ? `The theme dances are in ${categoriesWithTheme} of the ${settings.categories.length} categories, and categories take turns equally, ` +
            `so theme songs can make up at most about ${percent(ceiling)} of songs; the requested minimum (${percent(settings.theme.fractionMin)}) will often be missed. ` +
            `To allow more, add dances of the other categories to the theme, or split the theme dances' category into two (two turns in three).`
          : `With ${playableThemeDances} playable theme dance(s) and their repeat gaps, theme songs can make up ` +
            `at most about ${percent(ceiling)} of songs; the requested minimum (${percent(settings.theme.fractionMin)}) will often be missed.` +
            moveOutHint
        );
      }
      // Theme dances only in the excursion pool are limited by how often excursions fire.
      if (!themeDancesInCategories.length && themeDancesInPool.length && settings.excursions.intervalMinutes > 0 && songs.length) {
        const excursionOnlyShare = settings.eventLengthMinutes / settings.excursions.intervalMinutes / ((settings.eventLengthMinutes * 60) / averageSongSec);
        if (excursionOnlyShare < settings.theme.fractionMin) {
          warnings.push(
            `Theme dances are only excursions, which fire about ${percent(excursionOnlyShare)} of the time; ` +
              `the requested minimum (${percent(settings.theme.fractionMin)}) cannot be reached. Shorten the excursion interval.`
          );
        }
      }
      // Openers are theme dances from the categories and standalone ones (the other rules do not apply to them).
      if (settings.opening.earlyCount > 0 && theme.dances.size && !themeDancesInCategories.length && !standaloneDances.length) {
        warnings.push(
          `The first ${settings.opening.earlyCount} songs should be theme songs, but every theme dance with songs is an excursion, ` +
            `so the openers cannot be theme dances.`
        );
      }
    }
  }

  /* ---- special blocks: from dances (any dance), a tag (in the turns: category dances; outside them: any
   * dance the settings use: categories, excursions, standalone theme dances) or chosen songs ---- */
  const planForBlocks = themePlan(settings);
  const dancesTheSettingsUse = new Set([
    ...categoryOfDance.keys(),
    ...Object.keys(excursionPool).filter((dance) => excursionPool[dance] > 0),
    ...planForBlocks.standalone,
  ]);
  settings.specialBlocks.forEach((block, iBlock) => {
    const name = `Special block "${blockLabel(block)}"`;
    if (block.source === "songs") {
      if (!block.songs.length) errors.push(`${name} has no songs chosen.`);
      const libraryIds = new Set(allSongs.map((song) => song.id));
      const missingCount = block.songs.filter((id) => !libraryIds.has(id)).length;
      if (missingCount) warnings.push(`${name}: ${missingCount} chosen song(s) are not in the library and will be left out.`);
    } else if (block.source === "dances") {
      if (!block.dances.length) errors.push(`Special block ${iBlock + 1} has no dances.`);
      if (!(block.count >= 1)) errors.push(`${name} needs at least 1 song.`);
      const availableCount = songs.filter((song) => song.dances.some((dance) => block.dances.includes(dance))).length;
      if (block.dances.length && availableCount < block.count) {
        warnings.push(`${name} needs ${block.count} song(s) of ${block.dances.map((dance) => `"${dance}"`).join(" or ")}; only ${availableCount} found, so it will be shorter.`);
      }
    } else {
      if (!block.tag) errors.push(`Special block ${iBlock + 1} has no tag.`);
      if (!(block.count >= 1)) errors.push(`${name} needs at least 1 song.`);
      if (block.tag) {
        const canPlayInBlock = (song) => song.dances.some((dance) => (outsideTurns(block) ? dancesTheSettingsUse.has(dance) : categoryOfDance.has(dance)));
        const taggedCount = songs.filter((song) => song.tags.includes(block.tag) && canPlayInBlock(song)).length;
        if (taggedCount < block.count) warnings.push(`${name} needs ${block.count} songs with the tag, but only ${taggedCount} can play in it; it will be shorter.`);
      }
    }
    const placement = block.placement;
    if (placement.mode === "at" && !(placement.at >= 0 && placement.at <= 1)) errors.push(`${name}: its point must be between 0% and 100%.`);
    if (placement.mode === "window" && !(placement.from >= 0 && placement.to <= 1 && placement.from <= placement.to)) {
      errors.push(`${name}: the window must run from an earlier point to a later one.`);
    }
  });

  /* ---- must-play songs: in the library, and with a dance the settings let play ---- */
  for (const id of settings.mustPlay) {
    const song = allSongs.find((candidate) => candidate.id === id);
    if (!song) warnings.push(`A must-play song (${id}) is not in the library and will be left out.`);
    else if (!song.dances.some((dance) => dancesTheSettingsUse.has(dance))) {
      warnings.push(`Must-play song "${song.title}" will never play: its dance (${song.dances.join(", ")}) is not in a category, an excursion or a theme dance.`);
    }
  }

  /* ---- excursions, the last dance, the opening ---- */
  for (const [dance, weight] of Object.entries(excursionPool)) {
    if (!(weight >= 0)) errors.push(`Excursion weight for "${dance}" must be 0 or more.`);
    if (weight > 0 && songCountOf(dance) === 0) warnings.push(`No songs are tagged "${dance}" (excursion).`);
  }
  if (settings.closing.finalDance && songCountOf(settings.closing.finalDance) === 0) {
    warnings.push(`No songs are tagged "${settings.closing.finalDance}" (final dance).`);
  }
  for (const category of settings.categories) {
    if (category.dances && category.dances.length && category.dances.every((dance) => openingBlacklist.has(dance))) {
      warnings.push(`Every dance in "${category.name}" is on the opening blacklist.`);
    }
  }
  return { errors, warnings };
}
