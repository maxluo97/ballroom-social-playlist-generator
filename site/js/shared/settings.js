// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * settings.js — default settings, settings files, and remembering the last-used settings.
 *
 * The settings object is exactly what generatePlaylist() takes (see site/js/generator/generator.js).
 *
 * The DEFAULT settings live in data/default-settings.json, in the same format as a user settings file
 * (see settingsFileText). To change the defaults: set things up on the page, "Save user settings…", and
 * replace data/default-settings.json with that file.
 *
 * Settings file format: { app, kind: "settings", name, savedAt, settings: { … } }.
 */

export const DEFAULTS_URL = "data/default-settings.json";

/** The theme used when the user switches a theme on (the broad-theme share by default). */
export const THEME_TEMPLATE = {
  name: "",
  dances: [],
  tags: [],
  fractionMin: 0.5,
  fractionMax: 0.7,
  minGap: null, // theme minimum gap; null = the normal gap minus 2
};

/** A deep copy of plain data (settings, playlists). */
export const clone = (value) => JSON.parse(JSON.stringify(value));

/** A file's text without the invisible "byte order mark" some editors put at the start. */
const withoutByteOrderMark = (text) => String(text).replace(/^\uFEFF/, "");

/* ------------------------------------------------------------ settings files */

/** Read a settings file's text. Returns { name, settings }; throws a readable Error if it is not one. */
export function parseSettingsFile(text) {
  let file;
  try {
    file = JSON.parse(withoutByteOrderMark(text));
  } catch {
    throw new Error("This is not a settings file (it is not valid JSON).");
  }
  if (!file || file.kind !== "settings" || !file.settings || !Array.isArray(file.settings.categories)) {
    throw new Error("This file does not contain playlist settings.");
  }
  return { name: file.name || "", settings: file.settings };
}

/** The text of a settings file (indented JSON, easy to read and edit). */
export function settingsFileText(settings, name) {
  const { seed, ...withoutSeed } = settings; // the seed is not used by the page
  return JSON.stringify(
    { app: "Dance Playlist Generator", kind: "settings", name, savedAt: new Date().toISOString(), settings: { ...withoutSeed, seed: null } },
    null,
    2
  ) + "\n";
}

/** Fetch data/default-settings.json. Returns { name, settings }. */
export async function loadDefaultSettings() {
  const response = await fetch(DEFAULTS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${DEFAULTS_URL} (HTTP ${response.status}).`);
  return parseSettingsFile(await response.text());
}

/** A working copy of settings to use on the page (the defaults if there are none); never a fixed seed. */
export function workingSettings(settings, defaults) {
  return { ...clone(settings || defaults), seed: null };
}

/* -------------------------------------------------------- browser storage */

const STORAGE_KEY = "dpg.lastSettings.v1";

/**
 * The last-used settings in this browser: { settings, label, modified }, or null. Never throws.
 * `label` names where they came from ("Default settings", a file name); `modified`: edited since.
 */
export function loadLastSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && stored.settings ? stored : null;
  } catch {
    return null;
  }
}

/** Keep the settings (and `about`: their label and whether they were modified) in this browser. */
export function saveLastSettings(settings, about = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, ...about }));
  } catch {
    /* storage unavailable (private window etc.): ignore */
  }
}
