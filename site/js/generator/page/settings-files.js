// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * settings-files.js — the settings bar above the form: which settings are loaded, Load default settings,
 * the shared presets, and saving / loading your own settings files.
 */

import { workingSettings, parseSettingsFile, settingsFileText } from "../../shared/settings.js";
import { el, fill, $ } from "../../shared/dom.js";
import { state, DEFAULTS_LABEL, rememberSettings, refresh } from "./page-state.js";

/** Offer `text` as a file download named `filename`. */
function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Options shared by the "Save user settings" and "Load user settings" file windows (Chrome / Edge).
 * Web pages may not open a file window in a particular folder (such as the project's data folder),
 * but the same `id` makes the browser reopen whichever folder was used last for settings files.
 * `startIn` only applies the very first time, before any folder has been remembered.
 */
const SETTINGS_PICKER = {
  id: "dpg-settings",
  startIn: "documents",
  types: [{ description: "Playlist settings", accept: { "application/json": [".json"] } }],
};

/** Replace the current settings (from the defaults, a shared preset or a user file). */
function applySettings(settings, label) {
  state.settings = workingSettings(settings, state.defaults);
  state.settingsLabel = label;
  state.settingsModified = false;
  state.themeStash = null;
  rememberSettings();
  renderSettingsBar();
  refresh(true);
}

function loadDefaults() {
  if (state.settingsModified && !confirm("Load the default settings? Changes you have not saved to a file will be lost.")) return;
  applySettings(state.defaults, DEFAULTS_LABEL);
}

/** Save the current settings to a file the user names (never touches the default settings). */
async function saveUserSettings() {
  const suggested = state.settingsLabel !== DEFAULTS_LABEL ? state.settingsLabel : "My settings";
  const saved = (name) => {
    state.settingsLabel = name;
    state.settingsModified = false;
    rememberSettings();
    renderSettingsBar();
  };
  if (window.showSaveFilePicker) {
    // Chrome / Edge: a real "Save as" window (choose the name and the folder).
    try {
      const handle = await window.showSaveFilePicker({
        ...SETTINGS_PICKER,
        suggestedName: `${suggested}.json`,
      });
      const name = handle.name.replace(/\.json$/i, "");
      const file = await handle.createWritable();
      await file.write(settingsFileText(state.settings, name));
      await file.close();
      saved(name);
    } catch (err) {
      if (err.name !== "AbortError") alert(`Could not save the settings: ${err.message}`);
    }
    return;
  }
  // Other browsers: ask for a name, then download (it goes to the Downloads folder).
  const name = (prompt("Name for this settings file:", suggested) || "").trim();
  if (!name) return;
  downloadFile(`${name.replace(/[\\/:*?"<>|]+/g, "-")}.json`, settingsFileText(state.settings, name), "application/json");
  saved(name);
}

async function loadUserSettings() {
  const use = async (file) => {
    if (state.settingsModified && !confirm(`Load “${file.name}”? Changes you have not saved to a file will be lost.`)) return;
    try {
      const { name, settings } = parseSettingsFile(await file.text());
      applySettings(settings, name || file.name.replace(/\.json$/i, ""));
    } catch (err) {
      alert(`Could not load ${file.name}: ${err.message}`);
    }
  };
  if (window.showOpenFilePicker) {
    // Chrome / Edge: opens in the folder last used for settings files (see SETTINGS_PICKER).
    try {
      const [handle] = await window.showOpenFilePicker({ ...SETTINGS_PICKER, multiple: false });
      await use(await handle.getFile());
    } catch (err) {
      if (err.name !== "AbortError") alert(`Could not open the file: ${err.message}`);
    }
    return;
  }
  // Other browsers: the standard file box (the browser decides where it opens).
  const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.remove();
    if (file) await use(file);
  });
  document.body.append(input);
  input.click();
}

/** The shared presets the site offers (presets/index.json, written by `npm run presets`). */
export async function loadSharedPresets() {
  try {
    const response = await fetch("presets/index.json", { cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    state.sharedPresets = data && Array.isArray(data.presets) ? data.presets.filter((preset) => preset && preset.file && preset.name) : [];
  } catch {
    state.sharedPresets = [];
  }
  renderSettingsBar();
}

/** Load one of the shared presets. */
async function useSharedPreset(preset) {
  if (state.settingsModified && !confirm(`Load “${preset.name}”? Changes you have not saved to a file will be lost.`)) return renderSettingsBar();
  try {
    const response = await fetch(`presets/${encodeURIComponent(preset.file)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`it could not be read (HTTP ${response.status})`);
    const { name, settings } = parseSettingsFile(await response.text());
    applySettings(settings, `${name || preset.name} (shared preset)`);
  } catch (err) {
    alert(`Could not load the shared preset “${preset.name}”: ${err.message}`);
    renderSettingsBar();
  }
}

export function renderSettingsBar() {
  const presets = state.sharedPresets || [];
  const presetPicker = presets.length > 0 && el("select", { "aria-label": "Load a shared preset", onchange: (event) => {
    const preset = presets[Number(event.target.value)];
    if (preset) useSharedPreset(preset);
  } }, el("option", { value: "" }, "Shared presets…"), presets.map((preset, iPreset) => el("option", { value: String(iPreset) }, preset.name)));
  fill($("settings-bar"),
    el("div", { class: "library-line" },
      el("span", {}, "Current settings: ", el("strong", {}, state.settingsLabel),
        state.settingsModified && el("span", { class: "muted" }, " (changed, not saved to a file)")),
      el("button", { type: "button", class: "small", onclick: loadDefaults }, "Load default settings"),
      presetPicker,
      el("button", { type: "button", class: "small", onclick: saveUserSettings }, "Save user settings…"),
      el("button", { type: "button", class: "small", onclick: loadUserSettings }, "Load user settings…")));
}
