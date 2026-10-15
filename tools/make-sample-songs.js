/**
 * Writes data/sample-songs.json from tools/sample-library.js.
 * Run with:   npm run sample
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildSampleLibrary } from "./sample-library.js";

const songs = buildSampleLibrary();
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/sample-songs.json", import.meta.url), JSON.stringify(songs, null, 1) + "\n");
console.log(`Wrote ${songs.length} songs to data/sample-songs.json`);
