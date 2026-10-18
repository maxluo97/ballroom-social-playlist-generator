// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * page-state.js — the generator page's state, shared by all its parts, and what happens after any change
 * to the settings.
 *
 * One settings object (state.settings, the exact shape generatePlaylist() takes) is the single source of
 * truth: every control reads from it and writes to it. Controls only redraw the form when its structure
 * changes (a row added or removed); typing just updates the object, and the texts that depend on it
 * ("live" texts) are recomputed.
 *
 * The parts of the page redraw each other (a settings change marks the playlist out of date; loading a
 * library redraws the playlist). They do it through `redraw`, which generator-page.js fills in, so the
 * parts do not need to import each other.
 */

import { listDances, associationMap } from "../generator.js";
import { saveLastSettings } from "../../shared/settings.js";
import { login as loginWithScopes } from "../../shared/spotify.js";
import { SPOTIFY_SCOPES } from "../../shared/config.js";
import { el, $ } from "../../shared/dom.js";
import { DANCE_ALIASES, BALLROOM_DANCE_NAMES, canonicalDance, unknownDanceMessage } from "../../shared/dance-names.js";

export const DEFAULTS_LABEL = "Default settings";

export const state = {
  drag: null, // the row or block being dragged in the playlist
  defaults: null, // from data/default-settings.json
  settings: null,
  settingsLabel: DEFAULTS_LABEL, // where the current settings came from
  settingsModified: false, // edited since they were loaded
  rows: [], // the library's rows (IDs and your own data)
  songs: [], // the library's songs with Spotify's details (the ones that can be generated)
  library: { name: "", problems: [] },
  sharedPresets: null, // the site's shared presets (presets/index.json)
  result: null, // the playlist shown (generated, then maybe edited)
  stale: false, // the settings changed since the playlist was generated
  errors: [], // the settings check's errors (generating is off while there are any)
  themeStash: null, // a theme switched off, kept in case it is switched on again
  openSections: new Set(["Event basics", "Categories and dances"]),
};

/** The page's drawing functions, filled in by generator-page.js. */
export const redraw = {
  form: null,
  settingsBar: null,
  validation: null,
  results: null,
  library: null,
};

/** Log in with this page's permissions (see SPOTIFY_SCOPES in site/js/shared/config.js). */
export const spotifyLogin = () => loginWithScopes(SPOTIFY_SCOPES.generator);

/* ------------------------------------------------------------ formatting */

/** Seconds as h:mm:ss or m:ss (e.g. 3725 -> "1:02:05", 185 -> "3:05"). */
export function formatDuration(totalSec) {
  const negative = totalSec < 0;
  const roundedSec = Math.round(Math.abs(totalSec));
  const hours = Math.floor(roundedSec / 3600);
  const minutes = Math.floor((roundedSec % 3600) / 60);
  const seconds = roundedSec % 60;
  const minutesText = hours ? String(minutes).padStart(2, "0") : String(minutes);
  return `${negative ? "-" : ""}${hours ? hours + ":" : ""}${minutesText}:${String(seconds).padStart(2, "0")}`;
}

/** A fraction as a whole percentage ("35%"). */
export const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/* ------------------------------------------------------- texts that follow the settings */

/** Functions that recompute the texts that follow the settings (emptied when the form is redrawn). */
let liveUpdaters = [];

/** A text element whose text is `getText()`, recomputed after every settings change. */
export function live(getText, tag = "p", className = "help") {
  const node = el(tag, { class: className });
  const update = () => (node.textContent = getText());
  liveUpdaters.push(update);
  update();
  return node;
}

/** Add a function to run after every settings change (until the form is redrawn). */
export const addLiveUpdater = (update) => liveUpdaters.push(update);

/** Forget the live texts (the form is about to be redrawn, with new ones). */
export const resetLiveUpdaters = () => {
  liveUpdaters = [];
};

/* ------------------------------------------------------- change handling */

let validationTimer;

/** Do not run the settings check that was about to run (it is run at once instead). */
export const cancelPendingValidation = () => clearTimeout(validationTimer);

/** Call after any settings change. `structural`: rows were added or removed, so the form is redrawn. */
export function changed(structural = false) {
  if (!state.settingsModified) {
    state.settingsModified = true;
    redraw.settingsBar();
  }
  rememberSettings();
  refresh(structural);
}

/** Keep the current settings in this browser, so a reload does not lose them. */
export function rememberSettings() {
  saveLastSettings(state.settings, { label: state.settingsLabel, modified: state.settingsModified });
}

/** Redraw everything that depends on the settings or the song library. */
export function refresh(structural = false) {
  if (structural) redraw.form();
  updateDatalists();
  liveUpdaters.forEach((update) => update());
  if (state.result && !state.stale) {
    state.stale = true;
    const banner = $("stale");
    if (banner) banner.hidden = false;
  }
  // The settings check runs a moment after typing stops.
  clearTimeout(validationTimer);
  validationTimer = setTimeout(redraw.validation, 150);
}

/* ------------------------------------------------------- dances and tags */

/** The library's dances as tagged (before associations). */
export const rawDances = () => listDances(state.songs, {});
/** The library's dances after associations. */
export const resolvedDances = () => listDances(state.songs, state.settings);
/** The library's tags, sorted. */
export const allTags = () => [...new Set(state.songs.flatMap((song) => song.tags || []))].sort();

/** The suggestion lists the page's dance and tag boxes use. */
export function updateDatalists() {
  const setOptions = (id, values) => $(id).replaceChildren(...values.map((value) => el("option", { value })));
  setOptions("dl-raw", rawDances());
  setOptions("dl-dances", resolvedDances());
  setOptions("dl-tags", allTags());
}

/** Dances named anywhere in the settings (after associations). */
export function referencedDances() {
  const settings = state.settings;
  const toGroup = associationMap(settings.associations);
  const dances = new Set();
  settings.categories.forEach((category) => category.dances.forEach((dance) => dances.add(toGroup(dance))));
  Object.keys(settings.excursions.pool).forEach((dance) => dances.add(toGroup(dance)));
  (settings.specialBlocks || []).forEach((block) => block.source === "dances" && (block.dances || []).forEach((dance) => dances.add(toGroup(dance))));
  if (settings.closing.finalDance) dances.add(toGroup(settings.closing.finalDance));
  return dances;
}

/** The association already holding this (library) dance, or null. */
export const associationOf = (dance) => state.settings.associations.find((association) => association.dances.includes(dance)) ?? null;

/** Suggestions for association boxes: each dance can be in only one association. */
export const dancesNotInAnAssociation = () => rawDances().filter((dance) => !associationOf(dance));

/** The category already holding this dance (compared after associations), or null. */
export function categoryOf(dance) {
  const toGroup = associationMap(state.settings.associations);
  return state.settings.categories.find((category) => category.dances.some((member) => toGroup(member) === toGroup(dance))) ?? null;
}

/** Suggestions for category boxes: each dance can be in only one category. */
export const dancesNotInACategory = () => resolvedDances().filter((dance) => !categoryOf(dance));

/** Suggestions for the excursion pool: dances not already excursions, nor in a category. */
export const dancesForExcursions = () =>
  resolvedDances().filter((dance) => !(dance in state.settings.excursions.pool) && !categoryOf(dance));

/** Suggested association names: common dance names not yet used as an association name. */
export const associationNameIdeas = () => {
  const usedNames = new Set(state.settings.associations.map((association) => association.name));
  return Object.keys(DANCE_ALIASES).filter((dance) => !usedNames.has(dance));
};

/** When an association is renamed, update every place in the settings that used the old name. */
export function renameEverywhere(oldName, newName) {
  const settings = state.settings;
  const renameIn = (list) => list && list.forEach((dance, iDance) => dance === oldName && (list[iDance] = newName));
  settings.categories.forEach((category) => renameIn(category.dances));
  if (oldName in settings.excursions.pool) {
    settings.excursions.pool = Object.fromEntries(Object.entries(settings.excursions.pool).map(([dance, weight]) => [dance === oldName ? newName : dance, weight]));
  }
  (settings.specialBlocks || []).forEach((block) => {
    renameIn(block.dances);
    renameIn(block.notAfter);
  });
  if (settings.theme) renameIn(settings.theme.dances);
  renameIn(settings.opening.blacklist);
  if (settings.closing.finalDance === oldName) settings.closing.finalDance = newName;
}

/*
 * Dance boxes accept known dances only (no free typing of new dances; new dances are defined in the
 * library builder). Known = the library's dances, association names, and the app's built-in names.
 */
const builtInDances = () => [...BALLROOM_DANCE_NAMES, ...Object.keys(DANCE_ALIASES)];
/** Dances usable in the settings (after associations). */
export const settingDances = () =>
  [...new Set([...resolvedDances(), ...state.settings.associations.map((association) => association.name).filter(Boolean), ...builtInDances()])];
/** Dances usable inside associations (the library's own dance names, before associations). */
export const libraryDanceNames = () => [...new Set([...rawDances(), ...builtInDances()])];
/** Options for a dance chip box that only accepts the names in `allowedNames()`. */
export const onlyDances = (allowedNames) => ({ allowed: allowedNames, notAllowed: unknownDanceMessage, normalize: canonicalDance });
