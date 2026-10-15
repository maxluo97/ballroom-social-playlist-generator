/**
 * library-test.js — checks dance-name guessing, library merging, and the CSV round trip.
 * Run with:   npm test   (runs this after test/test.js)
 */

import { guessDances } from "../js/dance-names.js";
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
const known = ["Smooth Waltz", "Standard Waltz", "Rhythm Cha-cha", "Latin Cha-cha"];
const cases = [
  ["Waltz", [], ["Waltz"]],
  ["My Viennese Waltz favourites", [], ["Viennese Waltz"]],
  ["WCS 2024", [], ["West Coast Swing"]],
  ["West Coast Swing", [], ["West Coast Swing"]],
  ["East Coast Swing", [], ["Swing"]],
  ["Cha Cha Cha!!", [], ["Cha-cha"]],
  ["Rumba / Bolero", [], ["Rumba", "Bolero"]],
  ["Nightclub 2-Step", [], ["Night Club Two Step"]],
  ["Paso Doble", [], ["Paso Doble"]],
  ["Smooth Waltz", known, ["Smooth Waltz"]],
  ["smooth waltzes", known, ["Smooth Waltz"]],
  ["Latin Cha Cha", known, ["Latin Cha-cha"]],
  ["Tango Argentino milonga", [], ["Argentine Tango"]],
  ["Road trip mix", [], []],
];
for (const [name, k, expected] of cases) {
  const got = guessDances(name, k);
  console.log(`  ${JSON.stringify(name).padEnd(34)} -> ${JSON.stringify(got)}`);
  check(same(got, expected), `"${name}": expected ${JSON.stringify(expected)}`);
}

console.log("=== Merging imports into a library");
const existing = [
  { id: "A", title: "Old Waltz", artist: "X", lengthSec: 180, dances: ["Waltz"], tags: ["Favourite"] },
  { id: "B", title: "Untouched", artist: "", lengthSec: 200, dances: ["Tango"], tags: [] },
];
const sp = (id, title, extra = {}) => ({ id, title, artist: "Art", album: "", lengthSec: 190, isrc: "ISRC" + id, ...extra });
const rows = mergeImport(existing, [
  { playlistName: "Waltz list", dances: ["Waltz"], tags: [], songs: [sp("A", "Old Waltz"), sp("C", "New Waltz", { album: "Original Motion Picture Soundtrack" })] },
  { playlistName: "Foxtrot list", dances: ["Foxtrot"], tags: ["Club"], songs: [sp("A", "Old Waltz"), sp("D", "Cha Cha Cha de Amor")] },
], { tagRules: parseTagRules("motion picture => Hollywood\n# comment\n"), guessTitleDances: true, knownDances: [] });

const byId = Object.fromEntries(rows.map((r) => [r.song.id, r]));
check(rows.length === 4, `expected 4 rows, got ${rows.length}`);
check(same(rows.map((r) => r.song.id), ["A", "B", "C", "D"]), "existing songs first, then new in import order");
check(same(byId.A.song.dances, ["Waltz", "Foxtrot"]), `A dances: ${byId.A.song.dances}`);
check(same(byId.A.song.tags, ["Favourite", "Club"]), `A keeps its manual tag and gains Club: ${byId.A.song.tags}`);
check(byId.A.song.artist === "X", "existing artist not overwritten");
check(byId.A.song.isrc === "ISRCA", "blank isrc filled in");
check(byId.A.status === "updated" && same(byId.A.sources, ["Waltz list", "Foxtrot list"]), "A updated from two playlists");
check(byId.B.status === "unchanged" && same(byId.B.song.dances, ["Tango"]), "B untouched");
check(byId.C.status === "new" && same(byId.C.song.tags, ["Hollywood"]) && same(byId.C.guessed.tags, ["Hollywood"]), "C gets guessed Hollywood");
check(same(byId.D.song.dances, ["Foxtrot", "Cha-cha"]) && same(byId.D.guessed.dances, ["Cha-cha"]), `D gets title-guessed Cha-cha: ${byId.D.song.dances}`);
check(existing[0].dances.length === 1, "the existing library objects are not modified");
const noGuess = mergeImport([], [{ playlistName: "F", dances: ["Foxtrot"], tags: [], songs: [sp("D", "Cha Cha Cha de Amor")] }], { guessTitleDances: false });
check(same(noGuess[0].song.dances, ["Foxtrot"]), "title guessing can be switched off");

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
