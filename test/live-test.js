// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * live-test.js — the live view and the program (the agreed spec, NOTES.md v0.4 "Live view and
 * program"): following what Spotify plays, the Word document, and windows sharing one login.
 * Run with:   npm test
 */

import { crc32 as zlibCrc32 } from "node:zlib";

// A fake browser storage with a login, and a fake Spotify (the token endpoint and "currently playing").
const memory = { "dpg.spotify.tokens.v1": JSON.stringify({ accessToken: "A1", refreshToken: "R1", expiresAt: Date.now() + 3600e3, scope: "user-read-currently-playing" }) };
globalThis.localStorage = {
  getItem: (key) => memory[key] ?? null,
  setItem: (key, value) => (memory[key] = String(value)),
  removeItem: (key) => delete memory[key],
};
const calls = [];
let playingAnswer = null; // null: 204, nothing playing
let tokenAnswer = { ok: true, body: { access_token: "A2", refresh_token: "R2", expires_in: 3600, scope: "user-read-currently-playing" } };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, auth: init.headers && init.headers.Authorization, body: init.body ? String(init.body) : "" });
  if (u.includes("accounts.spotify.com/api/token")) {
    return { ok: tokenAnswer.ok, status: tokenAnswer.ok ? 200 : 400, headers: { get: () => null }, json: async () => tokenAnswer.body };
  }
  if (u.includes("/me/player/currently-playing")) {
    if (!playingAnswer) return { ok: true, status: 204, headers: { get: () => null }, json: async () => null };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => playingAnswer };
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: { message: "not faked" } }) };
};

const live = await import("../site/js/live/live-core.js");
const docx = await import("../site/js/live/docx.js");
const spotify = await import("../site/js/shared/spotify.js");

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

const id = (number) => `s${String(number).padStart(4, "0")}`.padEnd(22, "x");
// A small night: 8 songs; 4-5 a line-dance block; 8 the last dance; one removed song.
const result = {
  playlist: [
    { song: { id: id(1) }, dance: "Waltz", kind: "regular" },
    { song: { id: id(2) }, dance: "Cha-cha", kind: "regular" },
    { song: { id: id(99) }, dance: "Rumba", kind: "regular", removed: true },
    { song: { id: id(3) }, dance: "Tango", kind: "regular" },
    { song: { id: id(4) }, dance: "Line dance", kind: "event", blockId: 0, blockLabel: "Line dance break" },
    { song: { id: id(5) }, dance: "Line dance", kind: "event", blockId: 0, blockLabel: "Line dance break" },
    { song: { id: id(6) }, dance: "Swing", kind: "regular" },
    { song: { id: id(7) }, dance: "Rumba", kind: "regular" },
    { song: { id: id(8) }, dance: "Waltz", kind: "final" },
  ],
};
const rows = [{ id: id(1), dances: ["Waltz"] }, { id: id(50), dances: ["Rumba", "Bolero"] }];
const plan = live.livePlan(result, rows);
const at = (number) => ({ at: Date.now(), isPlaying: true, progressMs: 0, song: { id: id(number), title: `Song ${number}`, artist: "Band", isrc: `I${number}`, durationMs: 180000 } });

console.log("=== The live plan");
{
  check(plan.songs.length === 8 && !plan.songs.some((item) => item.id === id(99)), "removed songs are left out");
  check(plan.songs[3].block === "Line dance break" && plan.songs[3].blockId === 0 && plan.songs[0].blockId === null, "special blocks are marked");
  check(plan.songs[7].last && !plan.songs[6].last, "the last dance is marked");
  check(plan.dances[id(50)] === "Rumba / Bolero", "the library's dances are included, for songs off the plan");
  check(!JSON.stringify(plan).includes("Song "), "no song titles are kept (only IDs and the user's own data)");
}

console.log("=== Following what Spotify plays");
{
  const before = live.liveState(plan, null, -1);
  check(before.index === -1 && !before.offPlan && before.next === plan.songs[0], "before anything plays, the first song is next");
  check(before.nextBlock && before.nextBlock.label === "Line dance break" && before.nextBlock.inSongs === 4, `the line dance break is in 4 songs: ${JSON.stringify(before.nextBlock)}`);

  const s2 = live.liveState(plan, at(2), -1);
  check(s2.index === 1 && s2.current.dance === "Cha-cha" && s2.next.dance === "Tango", "the playing song is found; next is the one after it");
  check(s2.following && s2.following.dance === "Line dance", "and the dance after that (the Dancers screen)");
  check(s2.nextBlock && s2.nextBlock.inSongs === 2 && live.inSongsText(2) === "in 2 songs", "the next block counts down in songs");
  const s3 = live.liveState(plan, at(3), s2.lastIndex);
  check(s3.nextBlock && s3.nextBlock.inSongs === 1 && live.inSongsText(1) === "next song", "the block comes next");
  const s4 = live.liveState(plan, at(4), s3.lastIndex);
  check(s4.current.block === "Line dance break" && s4.nextBlock === null, "during a block, no next block is shown");

  const back = live.liveState(plan, at(1), s4.lastIndex);
  check(back.index === 0 && back.next.dance === "Cha-cha", "going back: it follows (matched by song, not by counting)");
  const jump = live.liveState(plan, at(7), back.lastIndex);
  check(jump.index === 6 && jump.next.dance === "Waltz" && jump.nextBlock === null, "jumping ahead: it follows; no block is left");

  const last = live.liveState(plan, at(8), jump.lastIndex);
  check(last.current.last && last.next === null && last.following === null && last.upcoming.length === 0, "the last song of the night: no next dance");
  check(live.liveState(plan, at(7), 5).following === null, "the second-to-last song: a next dance, nothing after it");

  // Off the plan: a song from the library (its dance is known) and one that is not (no dance).
  const off = live.liveState(plan, { ...at(50), song: { ...at(50).song, isrc: "" } }, 1);
  check(off.offPlan && off.index === -1 && off.offPlanDance === "Rumba / Bolero", "a library song off the plan shows its dance");
  check(off.next.dance === "Tango" && off.lastIndex === 1, "next is worked out from the last planned song played");
  const unknown = live.liveState(plan, at(77), 1);
  check(unknown.offPlan && unknown.offPlanDance === "", "a song not in the library: dance unknown");
  // An off-plan song in the middle of the line dance break: the rest of that block is not "next block".
  const mid = live.liveState(plan, at(77), 3);
  check(mid.next.dance === "Line dance" && mid.nextBlock === null, "an off-plan song mid-block: no next block (none after it)");

  // Relinked songs and other copies of a recording are still found.
  const relinked = live.liveState(plan, { ...at(0), song: { ...at(0).song, id: "other", linkedFromId: id(6) } }, -1);
  check(relinked.index === 5, "a song Spotify relinked is found by the ID it was linked from");
  const sameRecording = live.liveState(plan, { ...at(0), song: { ...at(0).song, id: "copy", isrc: "isrc7" } }, -1, { isrcOf: (item) => (item === id(7) ? "ISRC7" : "") });
  check(sameRecording.index === 6, "another copy of a planned recording is found by its ISRC");

  // Matched by hand ("It's #4"): followed from then on, in every window.
  check(live.liveState(plan, at(77), 2).offPlan, "a song Spotify gives another ID, with no clue: off the plan");
  live.saveMatch(id(77), id(4));
  const matched = live.liveState(plan, at(77), 2, { matches: live.loadMatches() });
  check(!matched.offPlan && matched.index === 3 && matched.next.dance === "Line dance", "once matched by hand, it is that planned song");
  // Added during the night: its dance is shown; the order does not change.
  live.saveAdded(id(88), "Bachata");
  const add = live.liveState(plan, at(88), 2, { added: live.loadAdded() });
  check(add.offPlan && add.added && add.offPlanDance === "Bachata", "an added song shows the dance the organizer gave");
  check(add.next.dance === "Line dance" && add.lastIndex === 2 && add.nextBlock && add.nextBlock.inSongs === 1, "and the order does not change: next is still the next planned song");
  live.saveAdded(id(50), "Bolero");
  check(live.liveState(plan, at(50), 2, { added: live.loadAdded() }).offPlanDance === "Bolero", "the dance given wins over the library's");
  check(!JSON.stringify(live.loadAdded()).includes("Song "), "only the Spotify ID and the dance are kept");
  live.saveLivePlan(null);
  check(Object.keys(live.loadMatches()).length === 0 && Object.keys(live.loadAdded()).length === 0, "matches and added songs are forgotten with the plan (logging out)");

  // A song planned twice: the time after the last planned song played.
  const twice = { ...plan, songs: [...plan.songs.slice(0, 7), { ...plan.songs[0] }, plan.songs[7]] };
  check(live.findInPlan(twice, at(1).song, undefined, 3) === 7 && live.findInPlan(twice, at(1).song, undefined, -1) === 0, "a song planned twice: the next time it comes");

  check(live.liveState(plan, at(1), -1, { upcomingCount: 3 }).upcoming.map((item) => item.index).join() === "1,2,3", "the next few songs are listed");
}

console.log("=== The timer");
{
  const playing = { at: 1000, isPlaying: true, progressMs: 60000, song: { durationMs: 180000 } };
  check(live.progressNow(playing, 16000) === 75000 && live.clock(75000) === "1:15", "it counts on from Spotify's answer, every second");
  check(live.progressNow({ ...playing, isPlaying: false }, 16000) === 60000, "paused: it stands still");
  check(live.progressNow(playing, 999999) === 180000 && live.clock(180000) === "3:00", "it never runs past the end of the song");
}

console.log("=== The program");
{
  const programTable = live.programRows(plan);
  check(programTable.length === 8 && programTable[0].join("|") === "1|Waltz|" && programTable[3].join("|") === "4|Line dance|Line dance break", "the song order with dances and special blocks");
  check(programTable[7][1] === "Waltz (last dance)", "the last dance says so");

  const bytes = docx.tableDocx({ title: "Fall social & <friends>", headers: ["#", "Dance", "Special block", "Song"], rows: programTable.map((item) => [...item, ""]), widths: [700, 2700, 2300, 3660] });
  // Read the zip back: every file's checksum and size must be right, or Word refuses the document.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let pos = 0;
  let ok = true;
  while (view.getUint32(pos, true) === 0x04034b50) {
    const crc = view.getUint32(pos + 14, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const data = bytes.subarray(pos + 30 + nameLen, pos + 30 + nameLen + size);
    if (crc !== zlibCrc32(data) || crc !== docx.crc32(data)) ok = false;
    files[name] = new TextDecoder().decode(data);
    pos += 30 + nameLen + size;
  }
  check(ok, "every file's checksum is right");
  check(Object.keys(files).join() === "[Content_Types].xml,_rels/.rels,word/document.xml", `the three parts of a Word document: ${Object.keys(files)}`);
  check(view.getUint32(bytes.length - 22, true) === 0x06054b50 && view.getUint16(bytes.length - 12, true) === 3, "the zip's directory lists the three files");
  const doc = files["word/document.xml"] || "";
  check(doc.includes("Fall social &amp; &lt;friends&gt;") && !doc.includes("<friends>"), "text is escaped");
  check((doc.match(/<w:tr>/g) || []).length === 9 && doc.includes("<w:tblHeader/>"), "a header row (repeated on each page) and one row per song");
  check(doc.includes(">Line dance break<") && doc.includes(">Song<"), "special blocks, and the empty Song column");
}

console.log("=== Windows sharing one login");
{
  // Another window renewed the tokens: this one uses them, without renewing again.
  memory["dpg.spotify.tokens.v1"] = JSON.stringify({ accessToken: "B1", refreshToken: "RB", expiresAt: Date.now() + 3600e3, scope: "user-read-currently-playing" });
  calls.length = 0;
  await spotify.getCurrentlyPlaying();
  check(calls.length === 1 && calls[0].auth === "Bearer B1", `the newest tokens in storage are used: ${calls.map((call) => call.auth)}`);

  // Expired: renewed once, and the new tokens are kept for every window.
  memory["dpg.spotify.tokens.v1"] = JSON.stringify({ accessToken: "B1", refreshToken: "RB", expiresAt: Date.now() - 1, scope: "user-read-currently-playing" });
  calls.length = 0;
  await spotify.getCurrentlyPlaying();
  check(calls.length === 2 && calls[0].body.includes("refresh_token=RB") && calls[1].auth === "Bearer A2", "an expired token is renewed, then used");
  check(JSON.parse(memory["dpg.spotify.tokens.v1"]).refreshToken === "R2", "the renewed tokens are kept in storage");

  // A renewal refused because another window had just renewed (and replaced the refresh token): still logged in.
  memory["dpg.spotify.tokens.v1"] = JSON.stringify({ accessToken: "C1", refreshToken: "RC", expiresAt: Date.now() - 1, scope: "user-read-currently-playing" });
  tokenAnswer = { ok: false, body: { error: "invalid_grant" } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api/token")) memory["dpg.spotify.tokens.v1"] = JSON.stringify({ accessToken: "D1", refreshToken: "RD", expiresAt: Date.now() + 3600e3, scope: "user-read-currently-playing" });
    return realFetch(url, init);
  };
  calls.length = 0;
  let error = null;
  try {
    await spotify.getCurrentlyPlaying();
  } catch (err) {
    error = err;
  }
  globalThis.fetch = realFetch;
  check(!error && spotify.isLoggedIn() && calls.at(-1).auth === "Bearer D1", `the other window's tokens are used, not a logout: ${error && error.message}`);
  tokenAnswer = { ok: true, body: { access_token: "A3", refresh_token: "R3", expires_in: 3600 } };

  // Logged out in another window: this one is logged out too.
  delete memory["dpg.spotify.tokens.v1"];
  spotify.syncLogin();
  check(!spotify.isLoggedIn(), "logging out in one window logs out every window");
}

console.log("=== Asking Spotify what is playing");
{
  memory["dpg.spotify.tokens.v1"] = JSON.stringify({ accessToken: "E1", refreshToken: "RE", expiresAt: Date.now() + 3600e3, scope: "user-read-currently-playing" });
  playingAnswer = null;
  const none = await spotify.getCurrentlyPlaying();
  check(none.song === null && !none.isPlaying, "nothing playing (204): no song");
  playingAnswer = { is_playing: true, progress_ms: 61000, item: { type: "track", id: id(3), name: "Tango song", duration_ms: 200000,
    artists: [{ name: "A" }, { name: "B" }], external_ids: { isrc: "XYZ" }, linked_from: { id: id(30) } } };
  const playing = await spotify.getCurrentlyPlaying();
  check(playing.isPlaying && playing.progressMs === 61000 && playing.song.id === id(3) && playing.song.linkedFromId === id(30) && playing.song.artist === "A, B" && playing.song.durationMs === 200000,
    `a playing song: ${JSON.stringify(playing.song)}`);
  check(calls.at(-1).url.endsWith("/me/player/currently-playing?additional_types=track&market=from_token"),
    "asked with the user's country, so a relinked song says which song it stands in for");
  playingAnswer = { is_playing: true, progress_ms: 1000, currently_playing_type: "ad", item: null };
  check((await spotify.getCurrentlyPlaying()).song === null, "an ad: no song");
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: live view checks.");
if (failures) process.exit(1);
