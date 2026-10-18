// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * theme-plan.js — how a night's theme is played (the agreed theme spec, NOTES.md v0.2.4).
 *
 * A theme lists theme dances and/or theme song tags. A song is a "theme song" if it plays as a theme
 * dance, or carries a theme tag. Theme dances come in two kinds:
 *   - in a category: they play in that category's turns, skip its shuffle-bag, keep the normal gap;
 *   - in no category and not an excursion ("standalone"): together they form a hidden theme category,
 *     with its own shuffle-bag and gap, that plays whenever a theme song is due.
 *
 * Used by the generator, the settings check and the rule checker.
 */

import { mergeSettings, resolveSettings } from "./event-settings.js";

/** The theme's lookups: its dances and tags, and whether a song is a theme song. */
export function themeInfo(settings) {
  const dances = new Set(settings.theme ? settings.theme.dances : []);
  const tags = new Set(settings.theme ? settings.theme.tags : []);
  const hasTag = (song) => (song.tags || []).some((tag) => tags.has(tag));
  return {
    active: dances.size > 0 || tags.size > 0,
    dances,
    tags,
    hasTag,
    isThemeSong: (song, dance) => dances.has(dance) || hasTag(song),
  };
}

/**
 * The theme minimum gap: how close two theme songs of the same dance may come (songs with a theme tag,
 * and a theme of one standalone dance). By default the normal gap (minToRepeat) minus 2.
 */
export function themeMinGap(settings) {
  const minGap = settings.theme && settings.theme.minGap;
  return Number.isFinite(minGap) && minGap >= 0 ? minGap : Math.max(0, settings.minToRepeat - 2);
}

/**
 * How the theme's dances are played:
 *   catDances        theme dances in a category
 *   standalone       theme dances in no category and not excursions: the hidden theme category
 *   singleStandalone the theme is one standalone dance and nothing else
 *   minGap           the theme minimum gap (see themeMinGap)
 *   standaloneGap    the hidden category's repeat gap: the theme minimum gap for a single standalone
 *                    dance, otherwise the number of standalone dances
 *   openerDances     the dances that take turns opening a theme with dances
 */
export function themePlan(settings, theme = themeInfo(settings)) {
  const inCategory = new Set(settings.categories.flatMap((category) => category.dances));
  const excursionPool = settings.excursions.pool || {};
  const catDances = [...theme.dances].filter((dance) => inCategory.has(dance));
  const standalone = [...theme.dances].filter((dance) => !inCategory.has(dance) && !(excursionPool[dance] > 0));
  const singleStandalone = !theme.tags.size && theme.dances.size === 1 && standalone.length === 1;
  const minGap = themeMinGap(settings);
  return {
    catDances,
    standalone,
    singleStandalone,
    minGap,
    standaloneGap: singleStandalone ? minGap : standalone.length,
    openerDances: [...catDances, ...standalone],
  };
}

/** The theme minimum gap for these settings (for the generator page). */
export function themeMinGapFor(userSettings) {
  return themeMinGap(mergeSettings(userSettings));
}

/** Whether the theme minimum gap matters: the theme has tags, or is one standalone dance (for the generator page). */
export function themeMinGapApplies(userSettings) {
  const settings = resolveSettings(userSettings);
  if (!settings.theme) return false;
  const theme = themeInfo(settings);
  return theme.tags.size > 0 || themePlan(settings, theme).singleStandalone;
}
