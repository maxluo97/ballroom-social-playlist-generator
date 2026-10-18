// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * defaults.js — the app's default settings (data/default-settings.json), for the tests.
 * The page loads the same file, so the tests check exactly what users get by default.
 */
import { readFileSync } from "node:fs";
import { parseSettingsFile } from "../js/settings.js";

export const APP_DEFAULTS = parseSettingsFile(
  readFileSync(new URL("../data/default-settings.json", import.meta.url), "utf8")
).settings;
