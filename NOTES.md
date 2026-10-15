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

Folder layout (planned; ✔ = exists):

```
index.html        ✔   app page (GitHub Pages serves the root)
css/style.css     ✔
js/generator.js   ✔   pure rules logic (incl. associations)
js/settings.js    ✔   app defaults (APP_DEFAULTS), last-used settings in localStorage; presets later
js/ui.js          ✔   settings form + results list
js/data.js        ✔   loads songs from JSON/CSV, playlist -> CSV
js/spotify.js         login + playlist creation
data/sample-songs.json ✔  made-up competitive-style library (generated: `npm run sample`)
data/songs.json       real master song database (not yet)
presets/*.json        e.g. ballroom-social.json
tools/serve.js    ✔   local server: `npm start` -> http://127.0.0.1:8000/
tools/sample-library.js, make-sample-songs.js ✔
test/sample-data.js ✔ scenarios;  test/test.js ✔  run with `npm test`
package.json      ✔   {"type": "module"}, scripts start/test/sample
```

**Song CSV format** (js/data.js): header row; columns id (Spotify track ID), title, artist (optional), length (`3:25` or seconds), dances (`;`-separated), tags (optional, `;`-separated). The page can load such a file ("Load CSV / JSON…"); it is remembered in the browser.

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

**v0.2 goals** (agreed Oct 2026):
1. ~~Spotify link export~~ (done): "Copy Spotify links" (one `https://open.spotify.com/track/<id>` per line, playlist order) and a link column in the CSV. Fallback if automatic playlist creation fails: paste the links into an empty playlist in the Spotify desktop app. Song IDs may be bare IDs, `spotify:track:` URIs, or open.spotify.com links; `spotifyTrackId()` in js/data.js normalizes them. Songs without a real ID are left out and listed.
2. ~~Spotify setup~~ (done): developer app exists (owner's account is Premium; Development Mode). Client ID in `js/config.js`. Redirect URI = app root (`http://127.0.0.1:8000/` locally). The app serves only the developer's own account.
3. ~~`js/spotify.js` + `spotify-test.html`~~ (done; all four steps passed with the developer's account, Oct 2026): PKCE login -> `GET /me` -> `GET /me/playlists` -> `GET /playlists/{id}/items`. Login always returns to the root page; `handleLoginRedirect()` (called by every page at startup, incl. js/ui.js) finishes it and goes back to the page that started it. Tokens in localStorage (`dpg.spotify.tokens.v1`); auto-refresh; waits on 429.
4. Library builder (`library.html`, `js/library.js`; built, awaiting the developer's first real import). Pure logic in `js/dance-names.js` (name -> dance guessing with ballroom style rules; spellings editable in `DANCE_ALIASES`, styles in `BALLROOM_STYLES`) and `js/library-merge.js` (imports only add; manual edits never overwritten; a song in several playlists gets all their dances; keyword tag rules recorded for highlighting; no dance guessing from song titles — removed at the developer's request), tested by `test/library-test.js`. CSV columns written: id, title, artist, album, length, dances, tags, isrc. The generator page now loads, in order: a library saved in the browser (file load or "Try it in the generator now"), else `data/songs.csv`, else the sample. Shared DOM helpers in `js/dom.js`. Original plan: pick own single-dance playlists, guess each playlist's dance from its name (user confirms), read tracks, songs in several dance playlists get several dances, suggest tags from editable keyword rules (e.g. album "Soundtrack" -> Hollywood), review table, merge into and download `data/songs.csv`. **`data/songs.csv` in the repo is the master database** (editable as a spreadsheet; the repo may be public, which is acceptable).
5. "Save to Spotify" button: `POST /me/playlists`, then `POST /playlists/{id}/items` (max 100 per call).
6. Optional: availability check of library songs (one `GET /tracks/{id}` per song; batch endpoint removed).
7. Possibly: manual swap of a song in a generated playlist (alternatives of the same dance; re-run `checkRules` and warn).

**v0.3 candidates:**
- **Covers:** a `work` key per song (normalized title, overridable via a `work` CSV column); option "no two versions of the same work in one night". Spotify has no composition ID; MusicBrainz is a later fallback.
- **Themed blocks** (specified by the developer): `{ tag, count, fixedEvent: bool, placement }`.
  - `fixedEvent: true`: behaves like a fixed event (does not take turns between categories; any dance with the tag; counts for the "no two fixed events back to back" rule).
  - `fixedEvent: false`: still obeys category turns; songs come from the category whose turn it is, restricted to the tag.
  - Placement is the user's choice: fixed point (`at`), random point, or random within a window (e.g. 30-60%).
  - Themed blocks **keep the spacing rule** even as fixed events. Only line-dance-style fixed events may break spacing.
  - Block songs that match the overall theme count toward the overall theme share.
  - Not enough tagged songs: the block **shrinks**, with a warning.
- Presets: `localStorage` plus JSON export/import, then URL-encoded settings.
- Deploy to GitHub Pages; add the live URL as a redirect URI in the Spotify dashboard.

**Spotify facts (Feb 2026 Development Mode, checked Oct 2026):** playlist contents can only be read for playlists the user owns or collaborates on (copy others' playlists into your own first). `/playlists/{id}/tracks` is renamed `/items` (response `tracks` -> `items`, `track` -> `item`). Batch `GET /tracks` removed. Search limit max 10. `popularity` removed; `external_ids` (ISRC) removal was reverted. Some developers report 403s on write endpoints in Development Mode.

## 10. Working preferences

- Commit after every working step.
- Keep a short notes file (this one) current so each session starts with context.
- Ask for complete files when replacing; targeted edits otherwise.
- When something fails, use the browser dev tools console and network tab, and paste exact errors.
