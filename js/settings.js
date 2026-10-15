/**
 * settings.js — default settings for the app, plus saving the last-used settings in the browser.
 *
 * The settings object here is exactly what generatePlaylist() takes (see js/generator.js).
 * Presets and import/export will be added here later.
 */

/** Defaults matching the sample library (competitive-ballroom dance names). */
export const APP_DEFAULTS = {
  eventLengthMinutes: 180,
  associations: [
    { name: "Waltz", dances: ["Smooth Waltz", "Standard Waltz"] },
    { name: "Tango", dances: ["Smooth Tango", "Standard Tango"] },
    { name: "Foxtrot", dances: ["Smooth Foxtrot", "Standard Foxtrot"] },
    { name: "Viennese Waltz", dances: ["Smooth Viennese Waltz", "Standard Viennese Waltz"] },
    { name: "Quickstep", dances: ["Standard Quickstep"] },
    { name: "Cha-cha", dances: ["Rhythm Cha-cha", "Latin Cha-cha"] },
    { name: "Swing", dances: ["Rhythm Swing", "Latin Jive"] },
    { name: "Bolero / Rumba", dances: ["Rhythm Bolero", "Latin Rumba"] },
    { name: "Mambo / Salsa", dances: ["Rhythm Mambo", "Salsa"] },
    { name: "Samba", dances: ["Latin Samba"] },
    { name: "Paso Doble", dances: ["Latin Paso Doble"] },
  ],
  categories: [
    { name: "Ballroom", dances: ["Waltz", "Tango", "Foxtrot", "Viennese Waltz", "Quickstep"] },
    { name: "Latin", dances: ["Cha-cha", "Rhythm Rumba", "Swing", "Bolero / Rumba", "Mambo / Salsa", "Samba"] },
  ],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: {
    intervalMinutes: 25,
    jitterMinutes: 0,
    pool: { Polka: 1, Hustle: 1, Bachata: 3, "West Coast Swing": 2, "Night Club Two Step": 1 },
  },
  fixedEvents: [
    { name: "Line dance break", dance: "Line dance", count: 3, at: 0.5, notAfter: [] },
    { name: "Paso Doble", dance: "Paso Doble", count: 1, at: 0.7, notAfter: [] },
  ],
  theme: null,
  opening: { earlyCount: 6, blacklist: ["Mambo / Salsa", "Quickstep"] },
  closing: { finalDance: "Waltz" },
  seed: null,
};

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

const STORAGE_KEY = "dpg.lastSettings.v1";

/** Last-used settings from this browser, or null. Never throws. */
export function loadLastSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLastSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private window etc.): ignore */
  }
}
