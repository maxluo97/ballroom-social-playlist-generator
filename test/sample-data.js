/**
 * sample-data.js — made-up songs and settings scenarios for testing the generator.
 *
 * Songs are built programmatically so the set is easy to resize. Titles and IDs are
 * fake; lengths are deterministic (same every run) and range from 2:30 to 4:10.
 */

import { buildSampleLibrary, SAMPLE_DANCES } from "../tools/sample-library.js";
import { APP_DEFAULTS } from "./defaults.js";

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
  specialBlocks: [
    { name: "Line dance", source: "dances", dances: ["Line dance"], count: 3, keepApart: true, placement: { mode: "at", at: 0.5 } },
    { name: "Paso Doble", source: "dances", dances: ["Paso Doble"], count: 1, keepApart: true, placement: { mode: "at", at: 0.7 }, notAfter: ["Line dance"] },
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
    name: "App defaults + song length limits 2:45 to 3:45",
    songs: buildSampleLibrary(),
    settings: { ...APP_DEFAULTS, minSongSec: 165, maxSongSec: 225 },
  },
  {
    name: "App defaults + a special block with several dances (Latin showcase)",
    songs: buildSampleLibrary(),
    settings: {
      ...APP_DEFAULTS,
      specialBlocks: [
        ...APP_DEFAULTS.specialBlocks,
        { name: "Latin showcase", source: "dances", dances: ["Latin Samba", "Latin Jive", "Latin Paso Doble"], count: 3, keepApart: true, placement: { mode: "at", at: 0.3 } },
      ],
    },
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
      specialBlocks: [],
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
      // Quickstep is a theme dance but also blacklisted early; as a theme opener it is allowed anyway.
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
      theme: { name: "Hustle night", dances: ["Hustle"], fractionMin: 0.1, fractionMax: 0.2 },
    },
  },
  {
    name: "N=2, 3 h, standalone theme dance (Hustle night, Hustle in no category and not an excursion)",
    perDance: 20,
    settings: {
      ...ballroomLatinBase,
      excursions: { intervalMinutes: 25, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2, "Night Club Two Step": 1 } },
      theme: { name: "Hustle night", dances: ["Hustle"], fractionMin: 0.15, fractionMax: 0.25 },
    },
  },
  {
    name: "N=2, 3 h, standalone + category theme dances (Foxtrot, Hustle, Night Club Two Step)",
    perDance: 15,
    settings: {
      ...ballroomLatinBase,
      excursions: { intervalMinutes: 25, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } },
      theme: { name: "Club night", dances: ["Foxtrot", "Hustle", "Night Club Two Step"], fractionMin: 0.25, fractionMax: 0.4 },
    },
  },
  {
    name: "N=2, 3 h, mixed theme (Hollywood songs + Waltz, counted independently)",
    perDance: 10,
    settings: {
      ...ballroomLatinBase,
      theme: { name: "Hollywood waltzes", dances: ["Waltz"], tags: ["Hollywood"], fractionMin: 0.3, fractionMax: 0.45 },
    },
  },
  {
    name: "N=2, 3 h, special blocks: turn-taking at 40%, kept-apart tag block in a 45-55% window (clashes with the line dance)",
    perDance: 10,
    settings: {
      ...ballroomLatinBase,
      specialBlocks: [
        ...ballroomLatinBase.specialBlocks,
        { tag: "Hollywood", count: 4, placement: { mode: "at", at: 0.4 } },
        { tag: "Hollywood", count: 3, keepApart: true, placement: { mode: "window", from: 0.45, to: 0.55 } },
      ],
    },
  },
  {
    name: "N=2, 3 h, special blocks that may be interrupted (excursions every 5 min), random placement",
    perDance: 10,
    settings: {
      ...ballroomLatinBase,
      excursions: { ...ballroomLatinBase.excursions, intervalMinutes: 5 },
      specialBlocks: [
        ...ballroomLatinBase.specialBlocks,
        { tag: "Hollywood", count: 5, placement: { mode: "random" }, interruptBy: { excursions: true } },
        { tag: "Hollywood", count: 4, keepApart: true, placement: { mode: "random" }, interruptBy: { excursions: true }, afterInterruption: "end" },
      ],
    },
  },
  {
    name: "N=2, 3 h, tag block + Hollywood theme + standalone theme dance that may interrupt it",
    perDance: 12,
    settings: {
      ...ballroomLatinBase,
      excursions: { intervalMinutes: 25, pool: { Polka: 1, Bachata: 3, "West Coast Swing": 2 } },
      theme: { name: "Movie night", dances: ["Hustle"], tags: ["Hollywood"], fractionMin: 0.3, fractionMax: 0.45 },
      specialBlocks: [...ballroomLatinBase.specialBlocks, { tag: "Hollywood", count: 4, placement: { mode: "window", from: 0.3, to: 0.6 }, interruptBy: { theme: true } }],
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
