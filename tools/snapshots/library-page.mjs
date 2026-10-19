// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * library-page.mjs — the library builder's snapshot: a browser goes through a fixed sequence of steps
 * with a fake Spotify (your playlists, search, a library playlist that changes when the library is
 * saved), fixed random numbers and a fixed clock (the page shows save times), and the page is recorded
 * after each step.
 */

import { launchBrowser, PAGE_HELPERS } from "./browser.mjs";
import { ALL_SCOPES, fakeTrack, sharedLibraryRows, fakeSpotifyScript, agreedScript } from "./fake-spotify.mjs";

export async function recordLibraryPage(root, baseUrl) {
  const rows = await sharedLibraryRows(root, 300); // a smaller library, so the steps are quick
  const libraryTracks = rows.map((row, number) => fakeTrack(row.id, number, number % 50 === 0 ? "Moon River" : `Song ${number} (${row.dances[0]})`));
  const newId = (number) => `new${String(number).padStart(19, "0")}`;
  // New song 3 is another version of Moon River; new song 4 is the same recording as library song 1.
  const newTracks = Array.from({ length: 30 }, (_, iTrack) => fakeTrack(newId(iTrack), 1000 + iTrack, iTrack === 3 ? "Moon River (Live)" : `New song ${iTrack}`,
    iTrack === 4 ? { external_ids: { isrc: "ISRC1" } } : {}));
  // Playlist names test the dance guessing: a plain dance, an ambiguous Rumba, a Tango to double-check, no dance, collaborative, followed.
  const playlists = [
    { id: "plWaltz", name: "Waltz", owner: "tester", items: [...libraryTracks.slice(0, 5), ...newTracks.slice(0, 5)] },
    { id: "plRumba", name: "Rumba favorites", owner: "tester", items: newTracks.slice(5, 11) },
    { id: "plTango", name: "Tango night", owner: "tester", items: newTracks.slice(11, 15) },
    { id: "plMixed", name: "Mixed bag", owner: "tester", items: [...newTracks.slice(15, 18), ...libraryTracks.slice(10, 12)] },
    { id: "plWcs", name: "West Coast Swing", owner: "friend", collaborative: true, items: newTracks.slice(18, 22) },
    { id: "plFollowed", name: "Someone's Hustle", owner: "friend", items: newTracks.slice(22, 26) },
    { id: "PLAYLISTLIB", name: "Dance library (managed by the playlist generator)", owner: "tester", items: libraryTracks },
  ];
  const library = {
    rows,
    removed: [{ id: newId(29), dances: ["Rhythm Swing"], tags: [], removed: "2026-09-01" }],
    playlistId: "PLAYLISTLIB", savedAt: "2026-10-01T00:00:00.000Z", downloadedAt: "2026-10-02T00:00:00.000Z",
  };
  const injected = `(() => {
    // The login and the library are put in once per browser tab, so saving and reloading keep the changes.
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("dpg.spotify.tokens.v1", JSON.stringify({ accessToken: "fake", refreshToken: "fake", expiresAt: 4102444800000, scope: ${JSON.stringify(ALL_SCOPES)} }));
      localStorage.setItem("dpg.library.v1:tester", ${JSON.stringify(JSON.stringify(library))});
      ${agreedScript(root)}
    }
    // A fixed clock: the page shows when the library was saved.
    const FIXED_TIME = Date.parse("2026-10-18T12:00:00Z");
    const RealDate = Date;
    window.Date = class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [FIXED_TIME])); } static now() { return FIXED_TIME; } };
    ${PAGE_HELPERS}
    ${fakeSpotifyScript({ playlists, extraTracks: newTracks })}
    window.__snap = () => ({
      html: [...document.querySelectorAll("main, dialog[open], #preview-dock")].map((node) => node.outerHTML).join("\\n<!--split-->\\n"),
      values: [...document.querySelectorAll("input, select, textarea")].map((node) => (node.type === "checkbox" ? node.checked : node.value)),
      alerts: window.__alerts.splice(0),
      requests: window.__requests.splice(0),
      stored: Object.keys(localStorage).sort().map((key) => key + "=" + (key.startsWith("dpg.songDetails") ? "(details)" : localStorage.getItem(key))).join("\\n"),
    });
  })();`;

  const browser = await launchBrowser({ injected, baseUrl });
  const { step, goto, waitFor } = browser;
  try {
    await goto("library.html");
    await waitFor(`/Your library \\(this browser\\)/.test(document.querySelector("#existing").textContent) && document.querySelector("#review table")`);
    await step("loaded");
    await step("load playlists", `__click("Load my playlists")`, 1200);
    await step("rumba style", `__click("Rhythm Rumba (", 0, true)`);
    await step("tango check", `__click("It's Argentine Tango")`);
    await step("tick mixed", `document.querySelector('input[aria-label="Import Mixed bag"]').click()`);
    await step("filter playlists", `__type('input[aria-label="Filter playlists"]', "w")`);
    await step("unfilter playlists", `__type('input[aria-label="Filter playlists"]', "")`);
    await step("import", `__click("Import selected playlists")`, 2500);
    for (const label of ["New", "Updated", "In several playlists", "Keyword tags", "No dance", "Unchanged", "Not available on Spotify", "Duplicates", "Versions", "Removed", "Removed earlier", "All"]) {
      await step(`filter ${label}`, `__click("${label} (", 0, true)`);
    }
    await step("search moon", `__type('#review input[aria-label="Search songs"]', "moon")`);
    await step("search clear", `__type('#review input[aria-label="Search songs"]', "")`);
    await step("sort title", `[...document.querySelectorAll("#review th button")].find((button) => button.textContent.startsWith("Title")).click()`);
    await step("sort title again", `[...document.querySelectorAll("#review th button")].find((button) => button.textContent.startsWith("Title")).click()`);
    await step("remove", `__click("Remove", 0)`);
    await step("filter removed", `__click("Removed (", 0, true)`);
    await step("restore", `__click("Restore", 0)`);
    await step("filter removed earlier", `__click("Removed earlier (", 0, true)`);
    await step("restore earlier", `if (__buttons("Restore").length) __click("Restore", 0)`, 1000);
    await step("filter duplicates", `__click("Duplicates (", 0, true)`);
    await step("not a duplicate", `if (__buttons("Not a duplicate").length) __click("Not a duplicate", 0)`);
    await step("undo correction", `if (__buttons("Undo").length) __click("Undo", 0)`);
    await step("same recording open", `__click("Same recording as…", 0)`);
    await step("same recording cancel", `__click("Cancel", 0)`);
    await step("filter versions", `__click("Versions (", 0, true)`);
    await step("rename work", `if (__buttons("Rename work…").length) __click("Rename work…", 0)`);
    await step("back to all", `__click("All (", 0, true)`);
    await step("preview", `__click("▶", 0)`);
    await step("preview close", `document.querySelector("#preview-dock button").click()`);
    await step("add rule", `__click("+ Add rule")`);
    await step("type rule", `const boxes = document.querySelectorAll('#rules input[aria-label="Words to look for"]'); boxes[boxes.length - 1].value = "great film"; boxes[boxes.length - 1].dispatchEvent(new Event("input"));`);
    await step("try rule", `__type('#rules input[aria-label="Try a title or album"]', "Great Film (Original Motion Picture Soundtrack)")`);
    await step("reapply rules", `__click("Re-apply tag rules")`, 800);
    await step("paste links", `__type('#manual textarea', "https://open.spotify.com/track/${newId(26)}\\nnot a link\\nhttps://open.spotify.com/track/${newId(27)}"); __click("Add these songs")`, 1200);
    await step("search spotify", `__type('#manual input[aria-label="Search Spotify"]', "new song"); __click("Search")`, 1000);
    await step("more results", `__click("More results")`, 1000);
    await step("add from search", `__click("Add", 0)`);
    await step("song by song", `__type('#manual select[aria-label="Playlist to go through"]', "plWcs", 0, "change"); __click("Load its songs")`, 1200);
    await step("bulk dance", `__type('#manual input[aria-label="Dance to add to ticked songs"]', "Merengue"); __click("Add dance")`);
    await step("tick all", `__click("Tick all shown")`);
    await step("hide known", `[...document.querySelectorAll("#manual label")].find((label) => /Hide songs already/.test(label.textContent)).querySelector("input").click()`);
    await step("worklist to review", `__click("Add ticked songs to the review (step 5)")`, 1000);
    await step("dance window", `__click("Define a new dance…", 0)`);
    await step("dance typed", `__type('dialog input[aria-label="Dance name"]', "Peabody"); __type('dialog select[aria-label="Ballroom style"]', "Smooth", 0, "change")`);
    await step("dance added", `__click("Add this dance")`);
    await step("dance closed", `__click("Close")`);
    await step("save", `__click("Save")`, 3000);
    await step("backup", `__click("Download a backup")`);
    await step("start shared", `__click("Start from the shared library")`, 3000);
    await step("start empty", `__click("Start empty")`, 800);
    await step("back to saved", `__click("Back to your saved library")`, 2000);
    await goto("library.html");
    await waitFor(`document.querySelector("#review table")`);
    await step("reloaded");
    await step("log out", `__click("Log out")`, 2000);
  } finally {
    await browser.close();
  }
  return browser.records;
}
