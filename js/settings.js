/**
 * settings.js — default settings, settings files, and remembering the last-used settings.
 *
 * The settings object is exactly what generatePlaylist() takes (see js/generator.js).
 *
 * The DEFAULT settings live in data/default-settings.json, in the same format as a user
 * settings file (see settingsFileText). To change the defaults: set things up on the page,
 * "Save user settings…", and replace data/default-settings.json with that file.
 */

export const DEFAULTS_URL = "data/default-settings.json";

/** Current settings format. Bump when saved settings need upgrading (see upgradeSettings). */
export const SETTINGS_VERSION = 2;

/** Theme used when the user switches a theme on (broad-theme share by default). */
export const THEME_TEMPLATE = {
  name: "",
  dances: [],
  tags: [],
  fractionMin: 0.5,
  fractionMax: 0.7,
  guaranteedOpeners: 2,
};

export const clone = (obj) => JSON.parse(JSON.stringify(obj));

/* ------------------------------------------------------------ settings files */

/**
 * Read a settings file's text. Accepts the app's file format ({ app, kind, name, settings })
 * or a bare settings object. Returns { name, settings }; throws a readable Error otherwise.
 */
export function parseSettingsFile(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch {
    throw new Error("This is not a settings file (it is not valid JSON).");
  }
  const settings = data && data.settings && typeof data.settings === "object" ? data.settings : data;
  if (!settings || !Array.isArray(settings.categories)) {
    throw new Error("This file does not contain playlist settings (no categories found).");
  }
  return { name: (data && data.name) || "", settings };
}

/** The text of a settings file (pretty-printed JSON, easy to read and edit). */
export function settingsFileText(settings, name) {
  const { seed, ...rest } = settings; // the seed is not used by the page
  return JSON.stringify(
    { app: "Dance Playlist Generator", kind: "settings", name, savedAt: new Date().toISOString(), settings: { ...rest, seed: null } },
    null,
    2
  ) + "\n";
}

/** Fetch data/default-settings.json. Returns { name, settings }. */
export async function loadDefaultSettings() {
  const res = await fetch(DEFAULTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${DEFAULTS_URL} (HTTP ${res.status}).`);
  return parseSettingsFile(await res.text());
}

/**
 * Bring settings from any source (a file, this browser, an older version) up to date:
 * fills in missing sections from `defaults` and applies format upgrades.
 */
export function upgradeSettings(saved, defaults) {
  const d = clone(defaults);
  if (!saved) return d;
  const s = {
    ...d,
    ...clone(saved),
    excursions: { ...d.excursions, ...saved.excursions },
    opening: { ...d.opening, ...saved.opening },
    closing: { ...d.closing, ...saved.closing },
    seed: null,
  };
  // Version 2: associations include their own name by default.
  if (!(saved.version >= 2)) {
    for (const a of s.associations || []) {
      if (a.name && !a.dances.includes(a.name) && !a.name.includes("/")) a.dances.unshift(a.name);
    }
  }
  s.version = SETTINGS_VERSION;
  return s;
}

/* -------------------------------------------------------- browser storage */

const STORAGE_KEY = "dpg.lastSettings.v1";

/** Browser storage key for a song library loaded from a file (or sent over by the library builder). */
export const LIBRARY_KEY = "dpg.library.v1";

/**
 * Last-used settings from this browser: { settings, label, modified }, or null. Never throws.
 * `label` names where they came from ("Default settings", a file name); `modified` = edited since.
 */
export function loadLastSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw) return null;
    return raw.settings ? raw : { settings: raw, label: "", modified: true }; // older format: bare settings
  } catch {
    return null;
  }
}

export function saveLastSettings(settings, meta = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, ...meta }));
  } catch {
    /* storage unavailable (private window etc.): ignore */
  }
}
