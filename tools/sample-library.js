// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sample-library.js — a made-up song library tagged the way a competitive-ballroom
 * database might be: style-specific dance names ("Smooth Waltz", "Standard Waltz", ...).
 *
 * Used by the tests (the app itself uses your own library, or the shared library in site/data/).
 * Titles and IDs are fake; output is the same every run.
 */

export const SAMPLE_DANCES = {
  Smooth: ["Smooth Waltz", "Smooth Tango", "Smooth Foxtrot", "Smooth Viennese Waltz"],
  Standard: ["Standard Waltz", "Standard Tango", "Standard Viennese Waltz", "Standard Foxtrot", "Standard Quickstep"],
  Rhythm: ["Rhythm Cha-cha", "Rhythm Rumba", "Rhythm Swing", "Rhythm Bolero", "Rhythm Mambo"],
  Latin: ["Latin Cha-cha", "Latin Samba", "Latin Rumba", "Latin Paso Doble", "Latin Jive"],
  Other: ["Salsa", "Bachata", "Hustle", "West Coast Swing", "Night Club Two Step", "Polka", "Line dance"],
};

/** Groups of style-specific dances whose music is usually interchangeable. */
const SHARED = [
  ["Smooth Waltz", "Standard Waltz"],
  ["Smooth Tango", "Standard Tango"],
  ["Smooth Foxtrot", "Standard Foxtrot"],
  ["Smooth Viennese Waltz", "Standard Viennese Waltz"],
  ["Rhythm Cha-cha", "Latin Cha-cha"],
  ["Rhythm Swing", "Latin Jive"],
  ["Rhythm Bolero", "Latin Rumba"],
  ["Rhythm Mambo", "Salsa"],
];

/**
 * @param perDance songs tagged with only one dance, per dance
 * @param perShared songs tagged with both dances of each SHARED pair
 */
export function buildSampleLibrary(perDance = 5, perShared = 3) {
  const songs = [];
  let songNumber = 0;
  // Lengths and tags follow from the song's number, so the library is the same every run.
  const lengthFor = (number) => 150 + ((number * 37) % 100); // 2:30 .. 4:09
  const tagsFor = (number) => (number % 4 === 0 ? ["Hollywood"] : []);
  const add = (title, dances) => {
    songNumber++;
    songs.push({ id: `sample${songNumber}`, title, artist: "Sample Artist", lengthSec: lengthFor(songNumber), dances, tags: tagsFor(songNumber) });
  };
  for (const dance of Object.values(SAMPLE_DANCES).flat()) {
    for (let iSong = 1; iSong <= perDance; iSong++) add(`${dance} song ${iSong}`, [dance]);
  }
  for (const pair of SHARED) {
    for (let iSong = 1; iSong <= perShared; iSong++) add(`${pair.join(" / ")} song ${iSong}`, pair);
  }
  return songs;
}
