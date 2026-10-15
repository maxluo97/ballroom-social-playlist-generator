/**
 * library-test.js — checks dance-name guessing, library merging, and the CSV round trip.
 * Run with:   npm test   (runs this after test/test.js)
 */

import { guessDanceInfo, canonicalDance } from "../js/dance-names.js";
import { mergeImport, parseTagRules } from "../js/library-merge.js";
import { songsToCSV, parseSongsText } from "../js/data.js";
import { buildSampleLibrary } from "../tools/sample-library.js";

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("=== Dance guessing from playlist names");
// [playlist name, expected dances, expected ambiguous dances]
const cases = [
  ["Waltz", ["Smooth Waltz", "Standard Waltz"], []],
  ["Smooth Waltz", ["Smooth Waltz"], []],
  ["smooth waltzes", ["Smooth Waltz"], []],
  ["American Waltz", ["Smooth Waltz"], []],
  ["Intl Waltz", ["Standard Waltz"], []],
  ["Smooth & Standard Waltz", ["Smooth Waltz", "Standard Waltz"], []],
  ["My Viennese Waltz favourites", ["Smooth Viennese Waltz", "Standard Viennese Waltz"], []],
  ["Quickstep", ["Standard Quickstep"], []],
  ["Rumba", [], ["Rumba"]],
  ["American Rumba", ["Rhythm Rumba"], []],
  ["Rhythm Rumba", ["Rhythm Rumba"], []],
  ["International Rumba", ["Latin Rumba"], []],
  ["Int'l Rumba", ["Latin Rumba"], []],
  ["Latin Rumba", ["Latin Rumba"], []],
  ["Bolero", ["Rhythm Bolero"], []],
  ["Cha Cha Cha!!", ["Rhythm Cha-cha", "Latin Cha-cha"], []],
  ["Intl Cha Cha", ["Latin Cha-cha"], []],
  ["American Rhythm Cha-cha", ["Rhythm Cha-cha"], []],
  ["Jive", ["Latin Jive"], []],
  ["East Coast Swing", ["Rhythm Swing"], []],
  ["Paso Doble", ["Latin Paso Doble"], []],
  ["Rumba / Bolero", ["Rhythm Bolero"], ["Rumba"]],
  ["WCS 2024", ["West Coast Swing"], []],
  ["West Coast Swing", ["West Coast Swing"], []],
  ["Nightclub 2-Step", ["Night Club Two Step"], []],
  ["Tango Argentino milonga", ["Argentine Tango"], []],
  ["Salsa", ["Salsa"], []],
  ["Road trip mix", [], []],
];
for (const [name, expected, expectedAmbiguous] of cases) {
  const { dances, ambiguous } = guessDanceInfo(name);
  const amb = ambiguous.map((a) => a.dance);
  console.log(`  ${JSON.stringify(name).padEnd(30)} -> ${JSON.stringify(dances)}${amb.length ? `  ask: ${amb.join(", ")}` : ""}`);
  check(same(dances, expected) && same(amb, expectedAmbiguous), `"${name}": expected ${JSON.stringify(expected)} ask ${JSON.stringify(expectedAmbiguous)}`);
}

console.log("=== Standard dance names");
const canon = [
  ["American Rumba", "Rhythm Rumba"],
  ["rhythm rumba", "Rhythm Rumba"],
  ["International Rumba", "Latin Rumba"],
  ["Intl. Cha Cha", "Latin Cha-cha"],
  ["American Waltz", "Smooth Waltz"],
  ["International Standard Quickstep", "Standard Quickstep"],
  ["Smooth Waltz", "Smooth Waltz"],
  ["Waltz", "Waltz"], // bare names are left alone
  ["Rumba", "Rumba"],
  ["Salsa", "Salsa"],
  [" Hustle ", "Hustle"],
];
console.log("=== Tango double-check flag");
const tangoFlag = (name) => guessDanceInfo(name).checks.map((k) => k.dance);
check(same(guessDanceInfo("Tango").dances, ["Smooth Tango", "Standard Tango"]) && same(tangoFlag("Tango"), ["Tango"]), "bare Tango: ballroom guess, flagged");
check(same(tangoFlag("Smooth Tango"), []) && same(tangoFlag("International Tango"), []), "Tango with a style word: not flagged");
check(same(guessDanceInfo("Argentine Tango").dances, ["Argentine Tango"]) && same(tangoFlag("Argentine Tango"), []), "Argentine Tango: not flagged");
check(same(tangoFlag("Milonga night"), []), "milonga: Argentine, not flagged");
check(same(tangoFlag("Waltz"), []), "other bare dances: not flagged");

for (const [input, expected] of canon) check(canonicalDance(input) === expected, `canonicalDance("${input}") = "${canonicalDance(input)}", expected "${expected}"`);
const csv = parseSongsText("id,title,length,dances\nx,Song,3:00,American Rumba; Rhythm Rumba; Intl Cha Cha\n", "t.csv");
check(same(csv.songs[0].dances, ["Rhythm Rumba", "Latin Cha-cha"]), `CSV dances standardized and de-duplicated: ${csv.songs[0].dances}`);

console.log("=== Merging imports into a library");
const existing = [
  { id: "A", title: "Old Waltz", artist: "X", lengthSec: 180, dances: ["Waltz"], tags: ["Favourite"] },
  { id: "B", title: "Untouched", artist: "", lengthSec: 200, dances: ["Tango"], tags: [] },
];
const sp = (id, title, extra = {}) => ({ id, title, artist: "Art", album: "", lengthSec: 190, isrc: "ISRC" + id, ...extra });
const rows = mergeImport(existing, [
  { playlistName: "Waltz list", dances: ["Waltz"], tags: [], songs: [sp("A", "Old Waltz"), sp("C", "New Waltz", { album: "Original Motion Picture Soundtrack" })] },
  { playlistName: "Foxtrot list", dances: ["Foxtrot"], tags: ["Club"], songs: [sp("A", "Old Waltz"), sp("D", "Cha Cha Cha de Amor")] },
  { playlistName: "Rumba list", dances: ["American Rumba"], tags: [], songs: [sp("E", "Both")] },
  { playlistName: "Cha-cha list", dances: ["Rhythm Cha-cha"], tags: [], songs: [sp("E", "Both")] },
], { tagRules: parseTagRules("motion picture => Hollywood\n# comment\n") });

const byIdOf = (list) => Object.fromEntries(list.map((r) => [r.song.id, r]));
const byId = byIdOf(rows);
check(rows.length === 5, `expected 5 rows, got ${rows.length}`);
check(same(rows.map((r) => r.song.id), ["A", "B", "C", "D", "E"]), "existing songs first, then new in import order");
check(same(byIdOf(rows).E.song.dances, ["Rhythm Rumba", "Rhythm Cha-cha"]), `song in a Rumba and a Cha-cha playlist gets both: ${byIdOf(rows).E.song.dances}`);
check(same(byIdOf(rows).E.sources, ["Rumba list", "Cha-cha list"]), "both playlists listed as sources");
check(same(byId.A.song.dances, ["Waltz", "Foxtrot"]), `A dances: ${byId.A.song.dances}`);
check(same(byId.A.song.tags, ["Favourite", "Club"]), `A keeps its manual tag and gains Club: ${byId.A.song.tags}`);
check(byId.A.song.artist === "X", "existing artist not overwritten");
check(byId.A.song.isrc === "ISRCA", "blank isrc filled in");
check(byId.A.status === "updated" && same(byId.A.sources, ["Waltz list", "Foxtrot list"]), "A updated from two playlists");
check(byId.B.status === "unchanged" && same(byId.B.song.dances, ["Tango"]), "B untouched");
check(byId.C.status === "new" && same(byId.C.song.tags, ["Hollywood"]) && same(byId.C.guessed.tags, ["Hollywood"]), "C gets guessed Hollywood");
check(same(byId.D.song.dances, ["Foxtrot"]), `D's title ("Cha Cha Cha…") does not add a dance: ${byId.D.song.dances}`);
check(existing[0].dances.length === 1, "the existing library objects are not modified");

console.log("=== CSV round trip (songsToCSV -> parseSongsText)");
const lib = buildSampleLibrary();
lib[0].title = 'Tricky, "quoted" title';
lib[0].album = "Album, with comma";
lib[0].isrc = "USABC1234567";
const back = parseSongsText(songsToCSV(lib), "songs.csv");
check(back.problems.length === 0, `problems: ${back.problems.join("; ")}`);
check(back.songs.length === lib.length, `count ${back.songs.length} vs ${lib.length}`);
const firstDiff = lib.findIndex((s, i) => !same(s.dances, back.songs[i].dances) || !same(s.tags, back.songs[i].tags) ||
  s.title !== back.songs[i].title || s.lengthSec !== back.songs[i].lengthSec || (s.album ?? "") !== (back.songs[i].album ?? ""));
check(firstDiff === -1, `song ${firstDiff} differs after the round trip`);
check(back.songs[0].isrc === "USABC1234567", "isrc survives");

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: library checks.");
process.exitCode = failures ? 1 : 0;
