# Dance Playlist Generator: Project Notes

Hand this file to Claude Code at the start of a session. It describes the app as it is now, what is
open, and how we work. The finished specs and decisions of each version are in docs/history.md;
CHANGELOG.md summarizes each release; README.md is for the site's users; docs/README-local.md is for
the site's owner.

## 0. Where we left off (updated 2026-10-18)

- **Released and tagged:** v0.1 … v0.4 (package.json 0.4.0). The site: https://maxluo97.github.io/dance-social-playlist-generator/ (repository github.com/maxluo97/dance-social-playlist-generator, renamed Oct 2026; **mention the new address in the next CHANGELOG entry**, and that anyone with their own Spotify key must add it as a redirect address).
- **The road to 1.0** (agreed with the developer, Oct 2026), in this order (details of the finished steps in docs/history.md):
  1. ~~Default settings and three shared presets~~ (done): Short social (2 hours), Latin night, Roarin' Twenties. The developer will add presets for **non-ballroom socials** later (maybe after 1.0).
  2. ~~Licenses~~ (done): code AGPL 3.0 or later; shared library, default settings and presets CC BY 4.0; Spotify's logos not covered.
  3. ~~Code cleanup and documentation~~ (done, Oct 2026; waiting for the developer's check of part 7): folder layout, line endings, the generator engine, the generator page, the library builder, the smaller files (each proved unchanged with snapshots, now `npm run snapshots:save` / `:check`), and the documentation (these notes split from docs/history.md; README rule 5's theme-share limit and the new defaults; README-local; header comments).
  4. **Onboarding guide** (the developer writes it, Claude checks it: accuracy against the app, clarity, gaps).
  5. **A final Spotify compliance re-check**: re-read Spotify's Developer Terms, Developer Policy, design guidelines and the Web API reference just before 1.0 (the rules changed several times in 2026): Development Mode limits, no permanent storage, attribution, the scopes used (incl. user-read-currently-playing). If the Terms require an end-user **privacy policy**, Claude drafts one (the developer agreed), as a short page linked from both pages and the README.
  6. **A full manual test pass on the online site**: phone width, both live screens (projector), and a first-time user from scratch (e.g. an allowlisted account).
- **After 1.0 (developer, Oct 2026): fork off vA0.1**, a separate line (a git branch, created by the developer) for **MusicBrainz integration**, in reserve in case Spotify ever challenges the current approach (song details from the library playlist). Administration only at first.
- **Releases:** before each tag, check README.md and add a CHANGELOG.md entry (section 8).
- **How we work on a new feature:** agree a plain-language spec with the developer first (numbered rules, questions for anything unclear), write it into this file, then code it, with tests for each rule (`npm test` must pass), then list manual tests for the developer; once released, the spec moves to docs/history.md.
- **Git:** Claude never runs git commands (not even `git status`); it gives the developer the commands (section 8).

## 1. Project goal

A web app that randomly generates a curated playlist for a dance social, subject to a configurable set
of rules, saves it as a Spotify playlist, and helps run the night (live view, printed program).
Originally conceived for competitive ballroom socials; generalized to any dance mix.

## 2. About the developer

- Mechanical engineer, comfortable running code in an IDE, no prior web or software-development experience.
- Terms like "token", "API", "build step" should be explained briefly when first used.
- The original generator was prototyped in MATLAB (that code is lost); the rules come from the original README.

## 3. Hard constraints

- Do **not** host on the developer's own device; do **not** use a paid host. Hosting: **GitHub Pages** (static files only).
- No backend, no database, no server-held secrets.
- Developed with Claude Code in VS Code (the developer may switch computers; this file carries the context).

## 4. How the app is built (as of the pre-1.0 cleanup)

- **A static website** in `site/`, plain HTML / CSS / JavaScript modules, no framework, no build step, no outside libraries. Published by `.github/workflows/pages.yml` (GitHub Actions) after `npm test` passes. `npm start` serves it locally at http://127.0.0.1:8000/.
- **Four pages:** the generator (`index.html`), the library builder (`library.html`), the live view (`live.html`, `?screen=dancers` for the projector), the program (`program.html`).
- **Code** in `site/js/`:
  - `generator/` — the engine (pure logic; `generator.js` is its front door and lists its files and rules), `playlist-edit.js` (editing a generated playlist), `page/` (the generator page; `generator-page.js` lists its files).
  - `library/` — `library-merge.js` (imports only add; removed songs), `folders.js` (publishing into the data folder), `page/` (the library builder; `library-page.js` lists its files).
  - `live/` — the live view and program (`live-core.js` logic, `live-page.js`, `program-page.js`, `docx.js` the Word file maker).
  - `shared/` — Spotify login and calls (`spotify.js`; windows share one login safely), the Spotify connection panel, settings files, the library file format (`data.js`), dance names and guessing, works and duplicates, song details, each account's browser library, page helpers (`dom.js`), `config.js` (Client ID, scopes).
- **The library** lives in each user's browser, per Spotify account (`dpg.library.v1:<userId>`): Spotify IDs and the user's own data only (dances, tags, work / recording corrections, removed songs). Spotify's details are read from the user's private **library playlist** and kept in the browser for at most 14 days. Backups are three files (songs.csv, removed-songs.csv, library.json). The site owner's `site/data/` is the **shared library** new users can start from.
- **Settings:** one settings object (the shape `generatePlaylist` takes); every control reads and writes it. Defaults in `site/data/default-settings.json`; shared presets in `site/presets/` (listed by `npm run presets`).
- **Spotify keys:** the site's key (at most 5 accounts, added by the owner) or a user's own key (pasted, kept in the browser). Known grey area, accepted by the developer (see docs/history.md, v0.3).
- **Tests:** `npm test` (test/: the engine with 500 seeds per scenario, the library logic, song details with a fake Spotify, playlist editing, the live view and program). **Snapshots:** `npm run snapshots:save` / `snapshots:check` (tools/snapshots/).
- **v0 = pre-production: no backward compatibility.** When a format changes, change it outright (developer's instruction). The developer keeps no settings files worth keeping until 1.0 is imminent.

## 5. Spotify constraints (verified Oct 2026; re-check before 1.0)

- Auth: **Authorization Code with PKCE**, no client secret. Client ID is public and fine in the code.
- Redirect URIs must be registered exactly in the Spotify dashboard. Use the GitHub Pages URL for production and `http://127.0.0.1:PORT/` (not `localhost`) for local testing.
- Scopes needed for playlist creation: `playlist-modify-private` and/or `playlist-modify-public`.
- **Development Mode (since Feb 2026):** the app owner needs Spotify Premium; one Client ID per developer; max 5 authorized users per Client ID; a smaller set of supported endpoints; intended for non-commercial/personal use. Extended quota is aimed at large organizations. Consequence: design for the **organizer as the only Spotify user** (they log in, generate, and the playlist is created in their account).
- Playlist creation endpoint is now `POST /me/playlists` (older per-user-ID form is gone). Many online tutorials predate these changes. Verify every endpoint and field against current Spotify docs.
- Playback via the Web Playback SDK requires Premium.
- Spotify's per-track audio-feature endpoints were restricted for new apps in late 2024, so all dance tags come from our own data.
- Plan to test each Spotify call in a throwaway page first: login, token, `GET /me`, create empty playlist, add tracks.

**Spotify's guidance for apps (given by the developer from Spotify's documentation, Oct 2026; follow it in all work):**
- Use the OpenAPI spec (https://developer.spotify.com/reference/web-api/open-api-schema.yaml) for endpoint paths, parameters and response fields; do not guess.
- Authorization Code with **PKCE** for user data (no secret; never the Implicit Grant). Redirect URIs: HTTPS, except http://127.0.0.1 for local development; never http://localhost or wildcards.
- Request only the **minimum scopes** needed for the feature.
- Store tokens securely; never a Client Secret in client code; refresh tokens, and send the user through login again when refreshing fails.
- On 429: exponential backoff, respect Retry-After; never retry immediately or in tight loops.
- No deprecated endpoints (`/playlists/{id}/items`, not `/tracks`; `/me/library` over type-specific library endpoints).
- Handle the documented error codes and pass Spotify's error message on meaningfully.
- Comply with the Developer Terms: no caching of Spotify content beyond immediate use, attribute content to Spotify, no ML training on Spotify data.

**What the Developer Terms and Policy actually say (read Oct 2026; not legal advice):**
- *Spotify Content* = "any content, data, information or material made available through the Spotify Platform", **including metadata** (Terms II.8). What counts is where the data came from: title / artist / album / length / ISRC / release year fetched from Spotify are Spotify Content; the developer's dances, tags, work and recording corrections and settings are **not** (the Terms recognise the developer's own content, VIII.1.d).
- *Storing* (IV.3.a): no "databases of Spotify Content, other than as strictly necessary to operate your" app; "Do not store Spotify Content indefinitely". *Local caching* (IV.3.b): only "temporary caching" of metadata / cover art, as strictly necessary for performance.
- No exception by number of users: the Terms explicitly cover apps "for private personal use" (III.1.a).
- Policy II.4: attribute content "as being supplied and made available by Spotify, by using the Spotify Marks", with a link back to the content on Spotify; metadata must not be offered as a standalone product.
- Policy III.10: "Spotify is for personal, non-commercial use which means it can't be broadcast or played publicly from a business" — relevant background for organisers playing playlists at public socials (a matter for the organiser / venue licence, not the generator).
- **How the app complies (since v0.3):** the library files and browser storage hold only Spotify IDs and the user's own data; Spotify's details are read from each user's library playlist and kept in the browser for at most 14 days; the program never includes song titles; Spotify's logo credits song details, with links back to Spotify.

## 6. Vocabulary

The README's Definitions are the reference. In short: a **song** is a piece of music; a **dance** what is
danced to it (a song may serve several); a **category** a group of dances that takes turns (Smooth /
Standard, Rhythm / Latin); an **association** a group of dances treated as one ("Waltz" = Smooth Waltz +
Standard Waltz); an **excursion** a dance outside the categories, on a timer; a **special block** a run of
songs at one point in the night (from dances, a tag, or chosen songs); a **theme** dances and / or tags
played at an elevated share; **must-play songs**; **duplicates** (same recording) and **versions** (same
work). Competitive ballroom names are "<Smooth|Standard|Rhythm|Latin> <Dance>"; American and International
Rumba stay separate, American Bolero goes with International Rumba (site/js/shared/dance-names.js).

## 7. Open items and known concerns

- **Known concern (not planned work):** with very large libraries (thousands of songs) the library builder's review redraws its rows on every change; it shows 200 at a time, so it stays quick, but revisit if it is ever noticeable.
- **Backlog:** none (MusicBrainz moves to the vA0.1 line after 1.0; remembering past nights dropped; tempo / BPM rules declined).

## 8. Working preferences

- **Git (the developer's standing instruction):** Claude NEVER executes git commands without explicit authorization — not even read-only ones like `git status`. For basic commands (add, commit, push, pull, tag) Claude tells the developer the exact commands to run.
- **No access above the project folder.** Use the session's scratchpad for temporary files, never /tmp or other folders.
- **Never put the Spotify Client *secret* in the project** (PKCE needs none).
- **Editing files:** use the Edit tool, or small Node scripts for bulk edits. Never PowerShell 5.1 Get-Content/Set-Content rewrites (they garbled UTF-8 once). Every text file uses LF line endings (.gitattributes). Long Node scripts are safer written to a scratchpad file than passed inline in the shell (quotes and apostrophes break inline commands).
- **Explain technical terms briefly**; the developer is a mechanical engineer, new to web development.
- **Messages in the app:** warnings read "Warning: [reason]"; help lines are short; undo buttons use the `.undo` style; page-link buttons are purple-filled.

- **Names in code (developer, Oct 2026):** every name meaningful, loop counters too (`iSong`, `nSong`); camelCase with a lower-case first letter; a capital first only for classes; ALL_CAPS for fixed values. More comments, at Claude's discretion (erring toward verbose: the why and the tricky parts). **American spelling** throughout. Every code file starts with the two SPDX lines (copyright, AGPL-3.0-or-later).
- **Proving a change changes nothing:** `npm run snapshots:save` before, `npm run snapshots:check` after (tools/snapshots/): the engine and both pages recorded with fixed random numbers and a fake Spotify. Used for every step of the cleanup.
- **Two READMEs (developer, Oct 2026):** README.md is for **users of the site** only — every term the app uses defined, thorough, nothing for the owner (keep the developer's tone where it is already right; correct information matters more than sounding like them). Everything for the **site's owner** (running locally, publishing the shared library and presets, the default settings, Spotify dashboard and allowlist, files) is in **docs/README-local.md**, which is kept out of git (`.gitignore`). Diagrams in the README: **Mermaid** (rendered by GitHub), shown to the developer in the chat for approval before they are inserted.
- **Releases (developer, Oct 2026):** immediately before the last commit of each version (once per tag), check that **README.md** is up to date, and add that version's entry to **CHANGELOG.md**: only the changes since the previous version, summarized (not commit by commit). The changelog starts at v0.2.4 (a summary of the app at that point); no entries for earlier versions.
- **v0 = pre-production: no backwards compatibility.** File and settings formats are ours to specify; when a format changes, change it outright instead of keeping code that reads older versions (the developer's instruction, Oct 2026).
- Commit after every working step.
- Keep a short notes file (this one) current so each session starts with context.
- Ask for complete files when replacing; targeted edits otherwise.
- When something fails, use the browser dev tools console and network tab, and paste exact errors.
