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

## 7. The rules (from the original README)

1. **Blocks:** categories alternate in blocks of 1..`maxInARow` songs (default 3). Block length is rerolled only after every category has had a turn. Interrupts (excursions, fixed events) do not reset the block.
2. **Shuffle-bag repetition:** within a category, no dance repeats until all of that category's dances have occurred; order is re-randomized each round (like Tetris bags).
3. **Spacing:** `minToRepeat` (default 4) songs must separate two songs of the same dance. Applies to theme dances too. The last song is exempt.
4. **Excursions:** fire on a timer (~every 25 min). Weighted reducing pool: each draw removes one occurrence of that dance, so weights are also maximum counts (Polka 1, Hustle 1, Bachata 3, etc.).
5. **Fixed events:** a line-dance break at the halfway mark (3 songs); Paso Doble exactly once at `at` (e.g. 0.7), never directly after the line-dance break.
6. **Theme:** theme dances should make up `fractionMin`..`fractionMax` of regular songs (default 25-40%; 20-25% when the theme focuses on specific dances). Theme dances are exempt from the shuffle-bag but not from spacing. First two songs are guaranteed theme dances if a theme exists.
7. **Opening:** the first `earlyCount` (default 6) songs avoid `blacklist` (default Mambo, Quickstep).
8. **Closing:** an optional designated final dance; the night is budgeted to end close to the target length.

Original README "future work": scrape Spotify playlists, create Spotify playlists directly, in-place song replacement, a preferred-songs list spread evenly through the night, themed blocks of songs.

## 8. Current state of the code

**Exists:** `generator.js` (ES module, ~600 lines), a pure-logic implementation of rules 1-8 with N categories:

- `generatePlaylist(songs, settings, options)` returns `{ playlist, totalSec, targetSec, overtimeSec, seed, warnings, stats }`.
- `validateSettings(songs, settings)` returns `{ errors, warnings }` (e.g. dance in two categories, missing songs, infeasible theme fraction).
- `checkRules(result, settings)` independently verifies a result against the rules (returns violations).
- Seedable PRNG (`settings.seed`) for reproducible runs.
- Simulation approach: it walks forward song by song with a clock, because the excursion timer, fixed events, and final-song budget depend on elapsed time. Each song needs `lengthSec`.
- If rules cannot all be met, it relaxes them in a fixed order (`LEVELS`) and records a warning rather than failing.
- Optional `options.songFilter(song, ctx)` hook for tag-based rules (e.g. no tempo-change songs in the opening).

Song format: `{ id, title, lengthSec, dances: ["Waltz", ...] }`.

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
  theme: { name: "...", dances: [...], fractionMin: 0.25, fractionMax: 0.40, guaranteedOpeners: 2 },
  opening: { earlyCount: 6, blacklist: ["Mambo", "Quickstep"] },
  closing: { finalDance: "Waltz" },
  seed: null
}
```

**Not yet done / not yet verified:**

- `generator.js` has **never been run or tested**. It was written but not executed.
- No sample data, test script, or `package.json` exist yet. Needed: `package.json` with `{"type":"module"}` so Node can import it.
- Design assumptions made without the lost MATLAB code (confirm with the developer):
  - Excursion timer fires at `nextExcAt += interval`.
  - Theme share is steered by feedback (force theme below `fractionMin`, forbid above `fractionMax`, otherwise a coin flip at the midpoint). Theme dances only in some categories cap the achievable share.
  - Overtime is bounded by the longest song, not by the original `maxSongLength - minSongLength` rule.
  - Fixed-event songs skip spacing rules.

## 9. Suggested next steps

1. Create `package.json` (`"type": "module"`), a sample song set (about 8 songs per dance, a few multi-dance songs, 2-3 categories), and `test.js` that runs `generatePlaylist` over many seeds and prints any `checkRules` violations that occur with no relaxation warnings. Test N=1, 2, and 3 categories, with and without a theme.
2. Fix any bugs the tests expose; check determinism (same seed gives same output).
3. Build the settings UI page (plain JS) bound to the settings object, with a results list.
4. Add presets: `localStorage` plus JSON export/import, then URL-encoded settings, then per-user tag overrides.
5. Add Spotify: PKCE login, then profile, then create playlist, then add tracks. Verify against current docs at each step.
6. Deploy to GitHub Pages and add the live URL as a redirect URI in the Spotify dashboard.

## 10. Working preferences

- Commit after every working step.
- Keep a short notes file (this one) current so each session starts with context.
- Ask for complete files when replacing; targeted edits otherwise.
- When something fails, use the browser dev tools console and network tab, and paste exact errors.
