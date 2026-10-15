# Dance Playlist Generator: Project Notes

Hand this file to Claude Code at the start of a session. It summarizes the design discussion so far.

## 1. Project goal

A web app that randomly generates a curated playlist for a dance social, subject to a configurable set of rules, then (optionally) saves it as a Spotify playlist. Originally conceived for competitive ballroom socials; now generalized to any dance mix (e.g. ballroom/Latin, salsa/bachata, blues/Lindy).

## 2. About the developer

- Mechanical engineer, comfortable running code in an IDE, no prior web or software-development experience.
- Terms like "token", "API", "build step" should be explained briefly when first used.
- The original generator was prototyped in MATLAB; that code is **lost** (may be found later). The rules below come from the original README, so the JS generator is a fresh implementation, not a line-by-line port.

## 3. Hard constraints

- Do **not** host on the developer's own device; do **not** use a paid host.
- Target hosting: **GitHub Pages** (static files only). Cloudflare Pages / Netlify / Vercel are free fallbacks.
- No backend, no database, no server-held secrets.
- Currently on the free Claude tier; moving to Claude Code in VS Code.

## 4. Architecture decisions

- **Language:** plain HTML/CSS/JavaScript (ES modules, `<script type="module">`). No framework or build step to start. If the UI later gets dynamic (reorderable or lockable results, swap-song buttons), Svelte was the suggested upgrade. The generator is UI-independent, so migrating is a UI-only rewrite.
- **Separation of concerns:** generator (pure logic) / settings UI / Spotify layer are separate. Anyone can use the settings page and generator without Spotify login; Spotify is only needed for the final "Save as playlist" step. Non-Spotify fallbacks: copyable title list, CSV download.
- **Master database:** a spreadsheet exported to CSV or JSON, committed in the repo and loaded at startup. One row per song: Spotify track ID, title, length, dance tags, other tags (e.g. tempo changes). Spotify is the catalog, playback, and playlist layer; this file is the source of truth for tags.
- **Settings:** one settings object; every control reads and writes it; the generator takes it as its only configuration input.
- **Persistence without a backend:** presets in `localStorage`, plus export/import of presets as JSON, plus optional shareable URLs encoding the settings. Per-user tag overrides are stored in the browser as `{ trackId: { tag: value } }` and merged over the base data at load. A backend (Supabase/Firebase/Cloudflare) is a later option only if cross-device sync or shared presets are wanted. Spotify login must not be used as the account system (see section 5).
- **Settings UI idea:** collapsible sections: Event basics, Categories and dances, Excursions (weights table), Fixed events, Repetition, Opening and closing. Controls: sliders, number boxes, checkboxes, dropdowns, `<details>`. Include "Reset to defaults" and input validation.

## 5. Spotify constraints (verified Oct 2026; re-check docs before building)

- Auth: **Authorization Code with PKCE**, no client secret. Client ID is public and fine in the code.
- Redirect URIs must be registered exactly in the Spotify dashboard. Use the GitHub Pages URL for production and `http://127.0.0.1:PORT/` (not `localhost`) for local testing.
- Scopes needed for playlist creation: `playlist-modify-private` and/or `playlist-modify-public`.
- **Development Mode (since Feb 2026):** the app owner needs Spotify Premium; one Client ID per developer; max 5 authorized users per Client ID; a smaller set of supported endpoints; intended for non-commercial/personal use. Extended quota is aimed at large organizations. Consequence: design for the **organizer as the only Spotify user** (they log in, generate, and the playlist is created in their account).
- Playlist creation endpoint is now `POST /me/playlists` (older per-user-ID form is gone). Many online tutorials predate these changes. Verify every endpoint and field against current Spotify docs.
- Playback via the Web Playback SDK requires Premium.
- Spotify's per-track audio-feature endpoints were restricted for new apps in late 2024, so all dance tags come from our own data.
- Plan to test each Spotify call in a throwaway page first: login, token, `GET /me`, create empty playlist, add tracks.

## 6. Vocabulary (generalized from the original ballroom README)

| Original | Now |
|---|---|
| Style (smoothStandard / rhythmLatin) | **Category** (any number N >= 1) |
| social dances (`social`, `timeToSocial`) | **Excursion** (`timeToExcursion` / `excursions.intervalMinutes`) |
| Line dance break | **Fixed event** (`dance`, `count`, `at`) |
| Paso Doble (`pasoLocation`) | **Fixed event** with `notAfter` restriction |
| `themeDances`, `fractionThemeMin/Max` | `theme.dances`, `theme.fractionMin/Max` |
| `earlyCount`, `earlyBlacklist` | `opening.earlyCount`, `opening.blacklist` |
| (new) collapsing similar dances | **Association** (`associations: [{ name, dances }]`) |

**Associations:** dances treated as one, e.g. "Waltz" = Smooth Waltz + Standard Waltz (9 Smooth/Standard dances become 5; Standard Quickstep stays unassociated). Applied before everything else: song tags and every dance named in the settings are renamed to the group name, so all rules see the merged dance. A one-member group is a rename. Each dance may be in only one association. The song database can therefore keep style-specific tags. **An association includes its own name by default** (e.g. "Waltz" = Waltz + Smooth Waltz + Standard Waltz); the UI adds it when an association is named, and old saved settings are upgraded once (settings `version: 2`).

**Competitive ballroom naming (from the developer, Oct 2026):** 19 dances in four styles (= categories): American Rhythm (Cha-cha, Rumba, Swing, Bolero, Mambo), American Smooth (Waltz, Tango, Foxtrot, Viennese Waltz), International Standard (Waltz, Tango, Viennese Waltz, Foxtrot, Quickstep), International Latin (Cha-cha, Samba, Rumba, Paso Doble, Jive). Standard form in the database: `<Smooth|Standard|Rhythm|Latin> <Dance>`. "American X" / "International X" / "Intl X" are translated (`canonicalDance` in js/dance-names.js; applied when loading CSVs and in the library builder). Same-named dances are associated by default, **except** American (Rhythm) Rumba and International (Latin) Rumba, which stay separate; **American Bolero is associated with International Rumba**. A bare "Rumba" is ambiguous: the library builder asks which style. A bare "Tango" (no Argentine spelling such as "argentine", "tango argentino", "milonga") is guessed as ballroom Smooth + Standard Tango **but flagged for double-checking** (`DOUBLE_CHECK` in js/dance-names.js); the builder offers "It's Argentine Tango" / "Ballroom is right" and warns before importing unconfirmed guesses. A bare "Waltz" (etc.) maps to both styles; a dance in only one style takes that style ("Quickstep" -> "Standard Quickstep").

Definitions: a **song** is a piece of music irrespective of dance; a **dance** is a categorical identity for bodily motions done to a song; a song may support several dances ("Oye Como Va is a cha-cha" is shorthand).

## 7. The rules (README.md is authoritative; summary here)

1. **Blocks:** categories alternate in blocks of 1..`maxInARow` songs (default 3). Block length is rerolled only after every category has had a turn. Interrupts (excursions, fixed events) do not reset the block.
2. **Shuffle-bag repetition:** within a category, no dance repeats until all of that category's dances have occurred; order is re-randomized each round (like Tetris bags).
3. **Spacing:** `minToRepeat` (default 4) songs must separate two songs of the same dance. Applies to theme dances too. The last song and fixed events are exempt.
4. **Excursions:** fire on a timer (~every 25 min). Weighted reducing pool: each draw removes one occurrence of that dance. When every counter reaches 0, the pool **resets** to its starting weights.
5. **Fixed events:** e.g. a line-dance break at the halfway mark (3 songs), Paso Doble once at `at` 0.7. Two different fixed events are **never back to back** (general rule); `notAfter` adds extra per-event restrictions.
6. **Theme:** a theme is a set of dances and/or song tags (`theme.dances`, `theme.tags`, e.g. "Hollywood"); a song is a theme song if either matches ("song" and "dance" are interchangeable here). Theme songs should make up `fractionMin`..`fractionMax` of regular + excursion songs (default **50-70% for broad themes** (changed by the developer Oct 2026; README still says 25-40%); 20-25% for dance-focused themes). Theme songs can come from categories or excursions. Theme dances are exempt from the shuffle-bag but not from spacing (tag-only theme songs still obey the bag). First `guaranteedOpeners` (default 2) songs are theme songs.
7. **Opening:** the first `earlyCount` (default 6) songs avoid `blacklist` (default Mambo, Quickstep).
8. **Closing:** an optional designated final dance. The night ends no later than `longest song - shortest song` past the target (and no earlier than one shortest song before it).

Original README "future work": scrape Spotify playlists, create Spotify playlists directly, in-place song replacement, a preferred-songs list spread evenly through the night, themed blocks of songs.

## 8. Current state of the code

Folder layout (✔ = exists):

```
index.html        ✔   generator page (GitHub Pages serves the root)
library.html      ✔   library builder page
css/style.css     ✔
js/generator.js   ✔   pure rules logic (incl. associations, song length limits)
js/playlist-edit.js ✔ editing a generated playlist (swap/insert/remove/restore/reset all), rule re-check
js/playlist-check.js ✔ checking a playlist on Spotify and replacing unavailable songs
js/availability.js ✔  Spotify availability results (shared by both pages, kept in the browser)
js/settings.js    ✔   settings files (parse/write), defaults, last-used settings in localStorage
js/ui.js          ✔   generator page (settings form, results, View library, song picker, Save to Spotify)
js/library.js     ✔   library builder page
js/library-merge.js ✔ merging imports into the library, blacklist (removed songs)
js/dance-names.js ✔   dance name guessing, ballroom styles, your own dances
js/data.js        ✔   song CSV read/write, removed-songs.csv, Spotify links
js/spotify.js     ✔   login (PKCE) + Web API calls
js/folders.js     ✔   saving files straight into the data folder (Chrome/Edge)
js/dom.js         ✔   page helpers: el/fill, chip editor, combo box dropdown, sortable tables
js/config.js      ✔   Spotify Client ID, redirect URI, scopes
data/songs.csv    ✔   the song library (made with the library builder)
data/removed-songs.csv ✔ removed songs (whole songs + date removed)
data/default-settings.json ✔ THE default settings (same format as a user settings file)
presets/          ✔   saved settings files
tools/serve.js    ✔   local server: `npm start` -> http://127.0.0.1:8000/
tools/sample-library.js ✔ made-up library for the tests
test/*.js         ✔   `npm test`: test.js (generator), library-test.js, availability-test.js, playlist-test.js
package.json      ✔   {"type": "module"}, scripts start/test, version 0.2.2
```

**Song CSV format** (js/data.js): header row; columns id (Spotify track ID), title, artist, album, length (`3:25` or seconds), dances (`;`-separated), tags (`;`-separated), isrc. Written and read by the library builder; the generator only reads data/songs.csv.

**Settings page (step 3, built Oct 2026, not yet checked in a browser by the developer):** collapsible sections for event basics, dance associations, categories, repetition, excursions, fixed events, theme, opening/closing. Live validation; Generate is disabled while there are errors. Results: summary, warnings, table, copy song list, download CSV. The UI always generates a fresh random playlist (no seed control; the developer does not need repeatability). The generator still accepts `seed`, which the tests use. Results mark theme songs in a "Theme?" column ("Yes"). Every chip field has its own suggestion dropdown that hides items already added. The last dance is a dropdown only. Category dance pickers are exclusive: a dance already in any category is not suggested and is refused if typed. The CSV format guide was removed from the page; the developer will write their own user guide. Renaming an association updates every reference to it.

Language: JavaScript only (runs in the browser and in Node). The old Python files were deleted; Python is not required.

**Exists:** `js/generator.js` (ES module), a pure-logic implementation of the rules with N categories:

- `generatePlaylist(songs, settings, options)` returns `{ playlist, totalSec, targetSec, overtimeSec, seed, warnings, stats }`.
- `validateSettings(songs, settings)` returns `{ errors, warnings }` (e.g. dance in two categories, missing songs, infeasible theme fraction).
- `checkRules(result, settings)` independently verifies a result against the rules (returns violations).
- Seedable PRNG (`settings.seed`) for reproducible runs.
- Simulation approach: it walks forward song by song with a clock, because the excursion timer, fixed events, and final-song budget depend on elapsed time. Each song needs `lengthSec`.
- If rules cannot all be met, it relaxes them in a fixed order (`LEVELS`) and records a warning rather than failing.
- Optional `options.songFilter(song, ctx)` hook for tag-based rules (e.g. no tempo-change songs in the opening).

Song format: `{ id, title, lengthSec, dances: ["Waltz", ...], tags: ["Hollywood", ...] }`.

Settings shape (see header comment in `generator.js` for details):

```js
{
  eventLengthMinutes: 180,
  categories: [{ name: "Ballroom", dances: [...] }, { name: "Latin", dances: [...] }],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: { intervalMinutes: 25, jitterMinutes: 0, pool: { Polka: 1, Hustle: 1, Bachata: 3 } },
  fixedEvents: [
    { name: "Line dance", dance: "Line dance", count: 3, at: 0.5 },
    { name: "Paso Doble", dance: "Paso Doble", count: 1, at: 0.7, notAfter: ["Line dance"] }
  ],
  theme: { name: "...", dances: [...], tags: [...], fractionMin: 0.25, fractionMax: 0.40, guaranteedOpeners: 2 },
  opening: { earlyCount: 6, blacklist: ["Mambo", "Quickstep"] },
  closing: { finalDance: "Waltz" },
  seed: null
}
```

**Tested (Oct 2026):** `npm test` runs 8 scenarios x 500 seeds (N=1/2/3 categories; no theme, dance theme, focused theme, song-tag theme, excursion theme). It checks for silent rule violations, determinism, song reuse, and night length. All pass. `validateSettings` warns about infeasible settings (e.g. too few dances for `minToRepeat`, a theme minimum above what spacing allows, one theme dance but two guaranteed openers).

Remaining design assumptions (not specified by the README):
- Excursion timer fires at `nextExcAt += interval`; the first excursion is at one interval in.
- Theme share is steered by feedback (force theme below `fractionMin`, avoid above `fractionMax`, otherwise a coin flip at the midpoint). Share can end slightly below the minimum (~5-15% of runs land at 24%).
- Fixed-event songs skip spacing rules (intended for line dances; themed blocks will not, see roadmap). A fixed event may directly follow an excursion.
- Openers come from categories only (excursions do not fire in the first songs).

## 9. Roadmap

**v0.1 (released, tagged by the developer):** generator, tests, settings page, associations, CSV/JSON song loading.

**v0.2 (released and tagged by the developer, Oct 2026; all items tested):**
1. ~~Spotify link export~~ (done): "Copy Spotify links" (one `https://open.spotify.com/track/<id>` per line, playlist order) and a link column in the CSV. Fallback if automatic playlist creation fails: paste the links into an empty playlist in the Spotify desktop app. Song IDs may be bare IDs, `spotify:track:` URIs, or open.spotify.com links; `spotifyTrackId()` in js/data.js normalizes them. Songs without a real ID are left out and listed.
2. ~~Spotify setup~~ (done): developer app exists (owner's account is Premium; Development Mode). Client ID in `js/config.js`. Redirect URI = app root (`http://127.0.0.1:8000/` locally). The app serves only the developer's own account.
3. ~~`js/spotify.js` + a throwaway test page~~ (done; all four steps passed with the developer's account, Oct 2026; the test page `spotify-test.html` was deleted before the v0.2 release): PKCE login -> `GET /me` -> `GET /me/playlists` -> `GET /playlists/{id}/items`. Login always returns to the root page; `handleLoginRedirect()` (called by every page at startup, incl. js/ui.js) finishes it and goes back to the page that started it. Tokens in localStorage (`dpg.spotify.tokens.v1`); auto-refresh; waits on 429.
4. ~~Library builder~~ (done; used for real imports by the developer) (`library.html`, `js/library.js`). Pure logic in `js/dance-names.js` (name -> dance guessing with ballroom style rules; spellings editable in `DANCE_ALIASES`, styles in `BALLROOM_STYLES`) and `js/library-merge.js` (imports only add; manual edits never overwritten; a song in several playlists gets all their dances; keyword tag rules recorded for highlighting; no dance guessing from song titles — removed at the developer's request), tested by `test/library-test.js`. CSV columns written: id, title, artist, album, length, dances, tags, isrc. The generator page now loads, in order: a library saved in the browser (file load or "Try it in the generator now"), else `data/songs.csv`, else the sample. Shared DOM helpers in `js/dom.js`. Original plan: pick own single-dance playlists, guess each playlist's dance from its name (user confirms), read tracks, songs in several dance playlists get several dances, suggest tags from editable keyword rules (e.g. album "Soundtrack" -> Hollywood), review table, merge into and download `data/songs.csv`. **`data/songs.csv` in the repo is the master database** (editable as a spreadsheet; the repo may be public, which is acceptable).
4a. ~~Library builder step 4a, songs one by one~~ (done, tested by the developer): add single songs by pasting Spotify song links (`GET /tracks/{id}` each) or searching (`GET /search`, max 10 per page, "More results"); or load ONE playlist (own/collaborative; chooser or pasted link) into the worklist unticked, to tag song by song. Worklist: tick/untick, per-song dances/tags (typing a dance ticks the song), bulk "add dance/tag to all ticked", hide songs already in the library. Ticked songs become one-song imports merged with step 4's playlists (same add-only merge). All dance/tag fields in the library builder (step 4 rows, 4a worklist, step 5 review) are chip editors with autocompleting dropdowns (shared `chipEditor` in js/dom.js, also used by the generator page).
4b. ~~Settings files~~ (done, added to v0.2 by the developer): main page has "Load default settings", "Save user settings…" (user names the file; Chrome/Edge show a Save-as dialog, other browsers prompt for a name and download), "Load user settings…". Defaults live in `data/default-settings.json` (proposed by Claude, then edited and approved by the developer Oct 2026: Swing association also includes plain "Jive"; excursions only Hustle 2, Bachata 3, West Coast Swing 2). Fixed events now take several dances (`dances: [...]`; old `dance` is converted on load); each song of the event is one of them, varied when possible. Exclusive suggestion lists: categories (a dance in one category only), associations (a dance in one association only), excursions (not already an excursion or in a category). To change the defaults: save user settings and replace that file (or hand the file to Claude). Current defaults (developer, Oct 2026) also set song length limits 2:00–4:30. In Chrome/Edge the save and load windows share a remembered folder (`SETTINGS_PICKER` id "dpg-settings" in js/ui.js; first time: Documents) — a web page cannot open them in a specific project folder. File format: `{ app, kind: "settings", name, savedAt, settings }`; bare settings objects are also accepted; `upgradeSettings()` fills gaps from the defaults and applies version upgrades. Tests read the same defaults file (`test/defaults.js`).
5. ~~"Save to Spotify" box~~ (done; the developer's first real save created the playlist successfully, Oct 2026) on the results panel: name (default "Dance social YYYY-MM-DD"), Public tick box (default private), creates the playlist and adds the songs in order. If not logged in it offers login and keeps the generated playlist across the login trip (sessionStorage `dpg.pendingResult.v1`). On failure it says what failed (incl. a 403 hint) and points to "Copy Spotify links". Original plan: `POST /me/playlists`, then `POST /playlists/{id}/items` (max 100 per call).
Also in v0.2 (done): every "add a dance" box accepts only known dances (library dances, association names, built-in names from js/dance-names.js; typed text matched ignoring capitals, "American Rumba" -> "Rhythm Rumba"); unknown names are refused with `unknownDanceMessage`. Tags can be typed freely, and in the library builder a new tag is offered in every later tag box. All dropdowns use the app's own combo box (`attachCombo`/`comboInput` in js/dom.js), not the browser's `<datalist>`, which did not show reliably. Excursions panel shows "Every x to y minutes" and groups the dance list in a `.subbox`.

**v0.2.1 (released and tagged by the developer, Oct 2026; all items below done and tested):**
- ~~"Define a new dance" button~~ (built, awaiting the developer's test): in the library builder (steps 4 and 4a toolbars), opens a dialog: name, optional ballroom style (stored as "<Style> <name>", e.g. "Smooth Peabody"), optional extra spellings for guessing. Kept in this browser (`dpg.customDances.v1`); permanent once songs carry it in songs.csv. `setCustomDances` / `customDanceNames` / `newDanceProblem` in js/dance-names.js: own dances take part in guessing (longest match wins, style/family words apply) and in `canonicalDance`; names that already mean a dance, contain a style word, or contain ; | , are refused. Library builder only (on the generator page a dance with no songs could not play anyway). Tested in test/library-test.js.
- ~~Availability check~~ (built, awaiting the developer's test; moved from v0.2; redesigned at the developer's request to check the **playlist**, not the whole library): after generating (when logged in), the generator checks the playlist's songs on Spotify (~50 lookups; `checkTrackAvailability` in js/spotify.js = `GET /tracks/{id}?market=from_token`, 4 at a time) and **replaces unavailable songs automatically** with another song of the same dance that fits the settings and is itself checked (`checkPlaylistOnSpotify` / `availableReplacement` in js/ui.js). Replacements count as the generator's choices (row note "Replaced “X” (reason)"); songs with no replacement keep a warning. Songs known to be unavailable are never picked by the generator (`songFilter`), are marked in the swap/insert picker and View library, and songs the user swaps/inserts are checked. Not logged in: "Log in and check on Spotify" (playlist kept across the login). Statuses: ok / relinked (Spotify plays another version itself; keep the original ID) / unplayable / missing / error. Results shared by both pages in this browser via js/availability.js (`dpg.availability.v1`); the library builder shows them (notes, "Not available on Spotify" filter, count) so dead songs can be removed, and offers "Recheck checked songs (N)" after a confirm warning about time and Spotify request limits (progress + Stop). "Create playlist" (Save to Spotify) is disabled while the playlist's check is running. Tested in test/availability-test.js with a fake Spotify.
- ~~**"View library" button**~~ (built, awaiting the developer's test): generator page, next to the library line. Read-only dialog (`openLibraryView` in js/ui.js): title, artist, length, dances, tags; search; dance filter with counts; "Songs per dance" chips (playable songs, after associations; click to filter); songs that cannot play are greyed with the reason (outside length limits, or none of their dances used by the settings); "Only songs that can play" / "Only songs that cannot play" filters (mutually exclusive). Editing/removing stay in the library builder.
- ~~**Edit the generated playlist by hand**~~ (requested Oct 2026; built, awaiting the developer's test): every row has Swap, Insert before…, Insert after…, Remove; buttons that undo a manual change (Reset, Restore, Remove on an inserted song, and "Reset all" above the table once anything was changed) use the `.undo` style; swapped rows also Reset (back to the generator's song, kept in `item.original` across repeated swaps). Inserted rows (`kind: "inserted"`, "Added by you") are deleted by Remove; generator rows are only marked `removed`, shown small and faded with Restore. Swap and Insert share one picker (`openSongPicker` in js/ui.js; Insert has an "Any dance" filter). `recompute()` renumbers/retimes only non-removed rows; stats, `checkRules`, links, CSV and Save to Spotify use `activeResult(r)`. Rule breaks are keyed by song (`violationKey`), so only problems introduced by edits are shown ("After your changes: …"); generator warnings are re-mapped to current numbers via `genIndex`. "Generate another" asks before discarding edits. `presets/` folder created for saved settings files.
- ~~**Manual swap**~~ (built and tested by the developer; moved from v0.2; now part of the item above): a Swap button on every row of the generated playlist opens a dialog listing first the songs that follow the settings (same dance after associations, not in the playlist, inside the length limits; closest length first), then every other library song marked "Warning: <reason>" (a different dance / already in this playlist / outside the song length limits) — the developer wants these pickable. Picking another dance changes the slot's dance. "Pick one for me" picks only from the songs that follow the settings. Duplicates created by swaps are reported too. `swapSong` recalculates start times, totals, theme mark and stats, marks the row "(swapped)", and re-runs `checkRules`, showing only violations not present right after generation (`baselineViolations`). Links, CSV and Save to Spotify use the edited playlist.
- ~~**Min / max song length**~~ (done): settings `minSongSec` / `maxSongSec` (null = no limit), set on the page under Event basics as m:ss. Songs outside the limits are removed before generation (`withinLengthLimits` in js/generator.js), so the end-of-night timing uses the shortest/longest *allowed* song. Validation reports how many songs are excluded, and names dances whose songs are all outside the limits; `checkRules` checks every played song. Test scenario: limits 2:45–3:45 on the sample library.
- ~~**Remove songs from the library, with a blacklist**~~ (built, awaiting the developer's test): the library builder's step 5 now lists the whole library at once (before any import). Each row: Remove (row stays, small and faded, with Restore). Removed songs are remembered in `data/removed-songs.csv` (id, title, artist, removed date; loaded at start). An import of a previously removed song is left out and flagged "Warning: you removed this song from the library on <date>…" with Re-import (and "Undo re-import"); re-importing takes it off the list. Step 6 offers "Download removed-songs.csv" whenever the list changed. 4a shows "removed from the library on <date>" for such songs. Logic in js/library-merge.js (`markPreviouslyRemoved`, `keptSongs`, `updatedBlacklist`, `blacklistChanged`) and js/data.js (`parseRemovedSongs`, `removedSongsToCSV`); tested.

**v0.2.2 (done Oct 2026, awaiting the developer's final check; upkeep and usability):**
- ~~Save straight into the data folder~~ (built, awaiting test): library builder step 6 "Save to the data folder" (Chrome/Edge; js/folders.js: folder picked once and remembered in IndexedDB, permission re-asked when needed; warns if the folder has no default-settings.json); writes songs.csv (+ removed-songs.csv when changed), then reloads from them. Downloads remain under "Or download the files instead" (and are the only option in other browsers).
- ~~"Which library am I using?"~~ (resolved by the developer's decision, Oct 2026): **the library is only ever the two files in data/** — `songs.csv` and `removed-songs.csv` — made and saved with the library builder. The generator always reads data/songs.csv (no browser copy, no "Load CSV / JSON…", no "Try it in the generator now"; an old browser copy is deleted on startup). Without data/songs.csv it points to the library builder (the sample songs were removed from the app at the developer's request; `data/sample-songs.json` and `tools/make-sample-songs.js` deleted; `tools/sample-library.js` remains for the tests). **Restoring from the blacklist:** removed-songs.csv stores the whole song (columns id, title, artist, removed, album, length, dances, tags, isrc; no support for the earlier 4-column format). In the library builder every blacklisted song gets a row (`blacklistRows` in js/library-merge.js), shown only under the "Removed earlier" filter, with Restore (and "Undo restore"); restored songs are saved with their dances and come off the blacklist. Restore uses the stored song as it was (no Spotify lookup). The library builder always saves BOTH files (removed-songs.csv may be empty). Its "Back to the generator" buttons (both) refuse to leave until both files exist in data/, and warn (confirm) if the library on the page differs from the saved files (compared by re-writing both in the same format); closing the tab with unsaved changes triggers the browser's warning.
- ~~Sort the library on screen~~ (built, awaiting test; added to v0.2.2 by the developer): click a column heading to sort (again to reverse; ▲/▼ shown), in the library builder's review table and the generator's View library window. On-screen only; songs.csv order is unchanged. `sortRows` / `sortHeader` in js/dom.js (text case-insensitive with natural numbers, lengths numeric, empty values last); tested.
- ~~Remove all backwards-compatibility code~~ (done): fixed events must use `dances`; settings files must have the wrapper format (`kind: "settings"`; no `version` field, no upgrades — `workingSettings` just copies); no tag-rule text format (`parseTagRules` removed); no old browser-library cleanup; no older availability/last-settings shapes. The current formats are the specification.
- ~~Update README.md, remove TODO.md~~ (done): README keeps the developer's rules text, corrected to the page's setting names, adds Association/Theme definitions, "Using the app", files, roadmap. TODO.md deleted. package.json version 0.2.2.
- ~~Split js/ui.js and test playlist editing~~ (done): pure logic moved to js/playlist-edit.js and js/playlist-check.js (ui.js ~1,500 → ~1,260 lines; it keeps thin wrappers doSwap/doInsert/… that call them and redraw). test/playlist-test.js covers swap/reset, insert/remove/restore, problems caused by edits, Reset all, and automatic replacement against a fake Spotify.

**v0.2.3 (agreed Oct 2026; built, awaiting the developer's online test):**
- Online with GitHub Pages at **https://maxluo97.github.io/ballroom-social-playlist-generator/** (repo public; Pages: deploy from branch main, root; that address registered as a Spotify redirect URI, alongside http://127.0.0.1:8000/ — all done by the developer). `.nojekyll` added (serve files as-is).
- **The library builder is computer-only (option A, the developer's choice):** online (`RUNNING_LOCALLY` false, js/config.js) library.html shows only how to use it locally (`npm start`, save, then commit and push data/songs.csv and data/removed-songs.csv). The online site is for generating and saving playlists. To be rethought in v0.3 (other users have no data folder).
- **Fix found in the online test (Oct 2026): Spotify's request limit.** The developer hit "quota exceeded"; a song whose lookup failed was stored as status "error" and the summary still said "All of them can be played" (the song was in fact unavailable). Now: songs Spotify did not answer for are **unchecked, never assumed playable** (`isChecked` / `checkFailed` in js/availability.js); the summary reports them as a warning ("… could not be checked because Spotify is limiting requests … Try Check again in about N minutes"), rows are marked, and nothing is replaced on their account. A long `Retry-After` (>30 s) makes `api()` fail at once and the check stops instead of retrying; a reply without a track counts as "error". To spare the limit: lookups go 2 at a time, and after Generate songs checked in the last `RECHECK_AFTER_DAYS` (7) days are not looked up again ("Check again" and the library builder's Recheck still check all); a failed lookup never overwrites an earlier real answer. Tested (availability-test, playlist-test).
- Browser storage is per address: settings, Spotify login, availability results etc. are separate between http://127.0.0.1:8000 and the online site. GitHub Pages caches files for up to ~10 minutes, so a push may take a few minutes to show.

**Known concern (not planned work):** with very large libraries (thousands of songs) the library builder redraws the whole review table on every Remove/Restore, which may become sluggish. Revisit only if it is noticeable.

**v0.2.4 (agreed Oct 2026):**
- **Themed blocks** (specified by the developer): `{ tag, count, fixedEvent: bool, placement }`.
  - `fixedEvent: true`: behaves like a fixed event (does not take turns between categories; any dance with the tag; counts for the "no two fixed events back to back" rule).
  - `fixedEvent: false`: still obeys category turns; songs come from the category whose turn it is, restricted to the tag.
  - Placement is the user's choice: fixed point (`at`), random point, or random within a window (e.g. 30-60%).
  - Themed blocks **keep the spacing rule** even as fixed events. Only line-dance-style fixed events may break spacing.
  - Block songs that match the overall theme count toward the overall theme share.
  - Not enough tagged songs: the block **shrinks**, with a warning.
- **Covers:** a `work` key per song (normalized title, overridable via a `work` CSV column); option "no two versions of the same work in one night". Spotify has no composition ID; MusicBrainz is a later fallback.
- (Proposed alongside covers; developer to confirm) **Literal duplicates:** the same recording under different track IDs (single vs album, re-releases). Detect by matching ISRC (stored in songs.csv), flag in the library builder, and never play two of them in one night. (Exact same track ID is already handled: the library merges by ID and the generator never repeats a song.)

**v0.3 (agreed Oct 2026; expected to be a major, challenging milestone — investigate in depth when we get there):**
- Let individual users log in with their own Spotify accounts (today the app serves only the developer's account). Known constraint to research then: Spotify Development Mode allows at most 5 authorized users per Client ID, and Extended Quota is aimed at large organizations.

**Later (not yet scheduled):**
- **Export the playlist to slides** (details to come from the developer). PDF is the safest cross-platform format for showing (opens identically everywhere) and the simplest to make (one page per slide, saved from the browser); PPTX only if the slides must be editable afterwards. Decide when the details are known (shown on a screen during the event? edited afterwards?).

**Spotify facts (Feb 2026 Development Mode, checked Oct 2026):** playlist contents can only be read for playlists the user owns or collaborates on (copy others' playlists into your own first). `/playlists/{id}/tracks` is renamed `/items` (response `tracks` -> `items`, `track` -> `item`). Batch `GET /tracks` removed. Search limit max 10. `popularity` removed; `external_ids` (ISRC) removal was reverted. Some developers report 403s on write endpoints in Development Mode.

## 10. Working preferences

- **v0 = pre-production: no backwards compatibility.** File and settings formats are ours to specify; when a format changes, change it outright instead of keeping code that reads older versions (the developer's instruction, Oct 2026).
- Commit after every working step.
- Keep a short notes file (this one) current so each session starts with context.
- Ask for complete files when replacing; targeted edits otherwise.
- When something fails, use the browser dev tools console and network tab, and paste exact errors.
