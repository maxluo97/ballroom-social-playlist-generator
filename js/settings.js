/**
 * settings.js — default settings, settings files, and remembering the last-used settings.
 *
 * The settings object is exactly what generatePlaylist() takes (see js/generator.js).
 *
 * The DEFAULT settings live in data/default-settings.json, in the same format as a user
 * settings file (see settingsFileText). To change the defaults: set things up on the page,
 * "Save user settings…", and replace data/default-settings.json with that file.
 *
 * Settings file format: { app, kind: "settings", name, savedAt, settings: { … } }.
 */

export const DEFAULTS_URL = "data/default-settings.json";

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

/** Read a settings file's text. Returns { name, settings }; throws a readable Error if it is not one. */
export function parseSettingsFile(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch {
    throw new Error("This is not a settings file (it is not valid JSON).");
  }
  if (!data || data.kind !== "settings" || !data.settings || !Array.isArray(data.settings.categories)) {
    throw new Error("This file does not contain playlist settings.");
  }
  return { name: data.name || "", settings: data.settings };
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

/** A working copy of settings to use on the page (the defaults if there are none); never a fixed seed. */
export function workingSettings(settings, defaults) {
  return { ...clone(settings || defaults), seed: null };
}

/* -------------------------------------------------------- browser storage */

const STORAGE_KEY = "dpg.lastSettings.v1";

/**
 * Last-used settings from this browser: { settings, label, modified }, or null. Never throws.
 * `label` names where they came from ("Default settings", a file name); `modified` = edited since.
 */
export function loadLastSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return raw && raw.settings ? raw : null;
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
