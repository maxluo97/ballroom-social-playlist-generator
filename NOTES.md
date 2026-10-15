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

Definitions: a **song** is a piece of music irrespective of dance; a **dance** is a categorical identity for bodily motions done to a song; a song may support several dances ("Oye Como Va is a cha-cha" is shorthand).

## 7. The rules (README.md is authoritative; summary here)

1. **Blocks:** categories alternate in blocks of 1..`maxInARow` songs (default 3). Block length is rerolled only after every category has had a turn. Interrupts (excursions, fixed events) do not reset the block.
2. **Shuffle-bag repetition:** within a category, no dance repeats until all of that category's dances have occurred; order is re-randomized each round (like Tetris bags).
3. **Spacing:** `minToRepeat` (default 4) songs must separate two songs of the same dance. Applies to theme dances too. The last song and fixed events are exempt.
4. **Excursions:** fire on a timer (~every 25 min). Weighted reducing pool: each draw removes one occurrence of that dance. When every counter reaches 0, the pool **resets** to its starting weights.
5. **Fixed events:** e.g. a line-dance break at the halfway mark (3 songs), Paso Doble once at `at` 0.7. Two different fixed events are **never back to back** (general rule); `notAfter` adds extra per-event restrictions.
6. **Theme:** a theme is a set of dances and/or song tags (`theme.dances`, `theme.tags`, e.g. "Hollywood"); a song is a theme song if either matches ("song" and "dance" are interchangeable here). Theme songs should make up `fractionMin`..`fractionMax` of regular + excursion songs (default 25-40%; 20-25% for dance-focused themes). Theme songs can come from categories or excursions. Theme dances are exempt from the shuffle-bag but not from spacing (tag-only theme songs still obey the bag). First `guaranteedOpeners` (default 2) songs are theme songs.
7. **Opening:** the first `earlyCount` (default 6) songs avoid `blacklist` (default Mambo, Quickstep).
8. **Closing:** an optional designated final dance. The night ends no later than `longest song - shortest song` past the target (and no earlier than one shortest song before it).

Original README "future work": scrape Spotify playlists, create Spotify playlists directly, in-place song replacement, a preferred-songs list spread evenly through the night, themed blocks of songs.

## 8. Current state of the code

Folder layout (planned; ✔ = exists):

```
index.html            app page (GitHub Pages serves the root)
css/style.css
js/generator.js  ✔    pure rules logic
js/settings.js        defaults, presets, localStorage, import/export
js/ui.js              settings form + results list
js/data.js            loads the song database
js/spotify.js         login + playlist creation
data/songs.json       master song database
presets/*.json        e.g. ballroom-social.json
tools/                Node helper scripts (e.g. CSV -> JSON)
test/sample-data.js ✔ fake songs + 8 scenarios
test/test.js  ✔       run with `npm test`
package.json  ✔       {"type": "module"}
```

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
- Fixed-event songs skip spacing rules. A fixed event may directly follow an excursion.
- Openers come from categories only (excursions do not fire in the first songs).

## 9. Suggested next steps

1. ~~package.json, sample data, test harness~~ (done)
2. ~~Fix bugs the tests expose; check determinism~~ (done)
3. Build the settings UI page (plain JS) bound to the settings object, with a results list.
4. Add presets: `localStorage` plus JSON export/import, then URL-encoded settings, then per-user tag overrides.
5. Add Spotify: PKCE login, then profile, then create playlist, then add tracks. Verify against current docs at each step.
6. Deploy to GitHub Pages and add the live URL as a redirect URI in the Spotify dashboard.

## 10. Working preferences

- Commit after every working step.
- Keep a short notes file (this one) current so each session starts with context.
- Ask for complete files when replacing; targeted edits otherwise.
- When something fails, use the browser dev tools console and network tab, and paste exact errors.
