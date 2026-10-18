// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * generator-page.js — the generator page (index.html): connects its parts and starts it.
 *
 * THE PAGE'S FILES (all in this folder)
 *   page-state.js        the page's state, what happens after a settings change, shared look-ups
 *   form-controls.js     the settings form's building blocks (number, text, length boxes, chips, sections)
 *   settings-form.js     the settings sections and the settings check below them
 *   blocks-form.js       special blocks, must-play songs, and the "find songs" chooser
 *   settings-files.js    the settings bar: defaults, shared presets, your own settings files
 *   library-panel.js     the song library: loading, Refresh from Spotify, Log out, View library
 *   playlist-view.js     generating, the playlist table and its editing, Regenerate unlocked songs
 *   song-picker.js       the Swap and Insert window
 *   save-to-spotify.js   the Save to Spotify box
 * The generator engine is in the folder above (generator.js), the playlist editing in playlist-edit.js.
 */

import { DEFAULT_SETTINGS } from "../generator.js";
import { clone, loadLastSettings, loadDefaultSettings, workingSettings } from "../../shared/settings.js";
import { handleLoginRedirect } from "../../shared/spotify.js";
import { $ } from "../../shared/dom.js";
import { state, redraw, DEFAULTS_LABEL } from "./page-state.js";
import { renderForm, renderValidation } from "./settings-form.js";
import { renderSettingsBar, loadSharedPresets } from "./settings-files.js";
import { renderLibrary, loadStartingLibrary } from "./library-panel.js";
import { renderResults, generate } from "./playlist-view.js";
import { restorePendingResult } from "./save-to-spotify.js";

// The parts redraw each other through these (see page-state.js).
redraw.form = renderForm;
redraw.settingsBar = renderSettingsBar;
redraw.validation = renderValidation;
redraw.results = renderResults;
redraw.library = renderLibrary;

async function start() {
  // Spotify sends the browser back to this page after login; finish it (this may leave the page).
  const login = await handleLoginRedirect();
  if (login.handled && !login.error) return;
  if (login.error) alert(login.error);

  $("generate").addEventListener("click", generate);

  // The defaults come from data/default-settings.json; the page then continues where it left off.
  try {
    state.defaults = (await loadDefaultSettings()).settings;
  } catch (err) {
    alert(`${err.message} Starting with empty settings.`);
    state.defaults = clone(DEFAULT_SETTINGS);
  }
  const last = loadLastSettings();
  state.settings = workingSettings(last && last.settings, state.defaults);
  state.settingsLabel = (last && last.label) || DEFAULTS_LABEL;
  state.settingsModified = !!(last && last.modified);

  renderSettingsBar();
  renderForm();
  loadSharedPresets(); // the list arrives a moment later
  await loadStartingLibrary();
  restorePendingResult();
}

start();
