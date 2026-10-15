/**
 * sample-data.js — made-up songs and settings scenarios for testing the generator.
 *
 * Songs are built programmatically so the set is easy to resize. Titles and IDs are
 * fake; lengths are deterministic (same every run) and range from 2:30 to 4:10.
 */

import { buildSampleLibrary, SAMPLE_DANCES } from "../tools/sample-library.js";
import { APP_DEFAULTS } from "../js/settings.js";

export const BALLROOM =["Waltz", "Tango", "Foxtrot", "Viennese Waltz", "Quickstep"];
export const LATIN = ["Cha-cha", "Rumba", "Swing", "Samba", "Mambo"];
export const CLUB = ["Bachata", "Hustle", "West Coast Swing", "Night Club Two Step"];
export const EXTRAS = ["Polka", "Line dance", "Paso Doble"];

/**
 * Build `perDance` single-dance songs for each dance, plus a few multi-dance songs.
 * Every 4th song is tagged "Hollywood" (for testing song-tag themes).
 */
export function buildSongs(perDance = 8) {
  const songs = [];
  let n = 0;
  const lengthFor = (i) => 150 + ((i * 37) % 100); // 150..249 s
  const tagsFor = (i) => (i % 4 === 0 ? ["Hollywood"] : []);
  for (const dance of [...BALLROOM, ...LATIN, ...CLUB, ...EXTRAS]) {
    for (let k = 1; k <= perDance; k++) {
      n++;
      songs.push({ id: `t${n}`, title: `${dance} song ${k}`, lengthSec: lengthFor(n), dances: [dance], tags: tagsFor(n) });
    }
  }
  const multi = [
    ["Foxtrot", "Swing"],
    ["Rumba", "Bachata"],
    ["Cha-cha", "Hustle"],
    ["Waltz", "Viennese Waltz"],
    ["Swing", "West Coast Swing"],
    ["Samba", "Polka"],
  ];
  for (const dances of multi) {
    songs.push({ id: `t${++n}`, title: `${dances.join("/")} song`, lengthSec: lengthFor(n), dances });
  }
  return songs;
}

const ballroomLatinBase = {
  eventLengthMinutes: 180,
  categories: [
    { name: "Ballroom", dances: BALLROOM },
    { name: "Latin", dances: LATIN },
  ],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: {
    intervalMinutes: 25,
    jitterMinutes: 0,
    pool: { Polka: 1, Hustle: 1, Bachata: 3, "West Coast Swing": 2, "Night Club Two Step": 1 },
  },
  fixedEvents: [
    { name: "Line dance", dance: "Line dance", count: 3, at: 0.5 },
    { name: "Paso Doble", dance: "Paso Doble", count: 1, at: 0.7, notAfter: ["Line dance"] },
  ],
  theme: null,
  opening: { earlyCount: 6, blacklist: ["Mambo", "Quickstep"] },
  closing: { finalDance: "Waltz" },
};

/** Each scenario: { name, settings, perDance } or { name, settings, songs } */
export const SCENARIOS = [
  {
    name: "App defaults: sample library, associations (Smooth+Standard, Rhythm+Latin)",
    songs: buildSampleLibrary(),
    settings: APP_DEFAULTS,
  },
  {
    name: "Sample library, NO associations: Smooth and Standard as separate categories",
    songs: buildSampleLibrary(),
    settings: {
      eventLengthMinutes: 180,
      categories: [
        { name: "Smooth", dances: SAMPLE_DANCES.Smooth },
        { name: "Standard", dances: SAMPLE_DANCES.Standard },
      ],
      minToRepeat: 3,
      excursions: { intervalMinutes: 25, pool: { Hustle: 1, "West Coast Swing": 1 } },
      opening: { earlyCount: 6, blacklist: ["Standard Quickstep"] },
      closing: { finalDance: "Standard Waltz" },
    },
  },
  {
    name: "N=1 (Ballroom only), 2 h, no theme",
    perDance: 8,
    settings: {
      ...ballroomLatinBase,
      eventLengthMinutes: 120,
      categories: [{ name: "Ballroom", dances: BALLROOM }],
      excursions: { intervalMinutes: 25, pool: { Polka: 1, Hustle: 1 } },
      fixedEvents: [],
      opening: { earlyCount: 6, blacklist: ["Quickstep"] },
    },
  },
  {
    name: "N=2 (Ballroom/Latin), 3 h, no theme",
    perDance: 8,
    settings: ballroomLatinBase,
  },
  {
    name: "N=2, 3 h, broad theme (Roarin' Twenties: Foxtrot, Quickstep, Swing)",
    perDance: 8,
    settings: {
      ...ballroomLatinBase,
      theme: { name: "Roarin' Twenties", dances: ["Foxtrot", "Quickstep", "Swing"], fractionMin: 0.25, fractionMax: 0.4 },
      // Quickstep is a theme dance but also blacklisted early; theme openers must use Foxtrot/Swing.
    },
  },
  {
    name: "N=2, 3 h, focused theme (Rumba night, 20-25%)",
    perDance: 12,
    settings: {
      ...ballroomLatinBase,
      theme: { name: "Rumba night", dances: ["Rumba"], fractionMin: 0.2, fractionMax: 0.25 },
    },
  },
  {
    name: "N=2, 3 h, song-tag theme (Hollywood songs, any dance)",
    perDance: 8,
    settings: {
      ...ballroomLatinBase,
      theme: { name: "Hollywood", tags: ["Hollywood"], fractionMin: 0.25, fractionMax: 0.4 },
    },
  },
  {
    name: "N=2, 3 h, theme in excursions (Hustle night, every 10 min)",
    perDance: 12,
    settings: {
      ...ballroomLatinBase,
      excursions: { intervalMinutes: 10, pool: { Hustle: 6, Polka: 1, Bachata: 2 } },
      theme: { name: "Hustle night", dances: ["Hustle"], fractionMin: 0.1, fractionMax: 0.2, guaranteedOpeners: 0 },
    },
  },
  {
    name: "N=3 (Ballroom/Latin/Club), 3 h, no theme",
    perDance: 8,
    settings: {
      ...ballroomLatinBase,
      categories: [
        { name: "Ballroom", dances: BALLROOM },
        { name: "Latin", dances: LATIN },
        { name: "Club", dances: CLUB },
      ],
      excursions: { intervalMinutes: 25, pool: { Polka: 2 } },
    },
  },
  {
    name: "N=3, 3 h, theme across categories (Waltz, Rumba, Bachata)",
    perDance: 8,
    settings: {
      ...ballroomLatinBase,
      categories: [
        { name: "Ballroom", dances: BALLROOM },
        { name: "Latin", dances: LATIN },
        { name: "Club", dances: CLUB },
      ],
      excursions: { intervalMinutes: 25, pool: { Polka: 2 } },
      theme: { name: "Romance", dances: ["Waltz", "Rumba", "Bachata"], fractionMin: 0.25, fractionMax: 0.4 },
    },
  },
];
