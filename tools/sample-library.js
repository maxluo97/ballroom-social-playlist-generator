/**
 * sample-library.js — a made-up song library tagged the way a competitive-ballroom
 * database might be: style-specific dance names ("Smooth Waltz", "Standard Waltz", ...).
 *
 * Used by the tests (the app itself only uses your real library, data/songs.csv).
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
  let n = 0;
  const lengthFor = (i) => 150 + ((i * 37) % 100); // 2:30 .. 4:09
  const tagsFor = (i) => (i % 4 === 0 ? ["Hollywood"] : []);
  const add = (title, dances) => {
    n++;
    songs.push({ id: `sample${n}`, title, artist: "Sample Artist", lengthSec: lengthFor(n), dances, tags: tagsFor(n) });
  };
  for (const dance of Object.values(SAMPLE_DANCES).flat()) {
    for (let k = 1; k <= perDance; k++) add(`${dance} song ${k}`, [dance]);
  }
  for (const pair of SHARED) {
    for (let k = 1; k <= perShared; k++) add(`${pair.join(" / ")} song ${k}`, pair);
  }
  return songs;
}
