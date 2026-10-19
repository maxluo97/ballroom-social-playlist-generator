# Release test: the full manual test of the online site

A checklist for the site's owner, before 1.0 (and before later releases). It covers what the automatic
checks cannot: the real Spotify, real devices, a projector, and someone using the site for the first
time. `npm test` and `npm run snapshots:check` cover the rest.

Test on **the online site** (https://maxluo97.github.io/dance-social-playlist-generator/) after pushing,
unless a step says otherwise. Note anything odd, with the page, the step and what you saw (a screenshot of
the browser's console, F12 → Console, helps with errors).

## A. A first-time user, from scratch

Use a **private window** (no saved data), ideally with **a second Spotify account** that is on the site
key's list (Spotify developer dashboard → your app → Settings → User Management).

- [ ] The generator page opens; the footer shows Source code · AGPL 3.0 · Privacy and terms.
- [ ] **Privacy and terms** opens and reads correctly.
- [ ] **Log in with Spotify**: the agreement window appears. **Cancel** does nothing.
- [ ] **I agree, log in**: Spotify's login and permission page, then back on the generator page, logged in.
- [ ] The page says there is no library yet and points to the library builder.
- [ ] Library builder: **Start from the shared library** loads its songs (titles show as "Unknown song" until the first save).
- [ ] **Save**: asks before creating the library playlist; then "Saved … The library playlist on Spotify is up to date".
- [ ] In Spotify: a private playlist "Dance library (managed by the playlist generator)" with the songs.
- [ ] Back on the generator: the library shows with its song count; **View library** lists the songs with their details.
- [ ] **Generate playlist** with the default settings: a full night, the line-dance break between 50% and 60%, the last dance a Waltz.

## B. Building a library

- [ ] **Load my playlists**: your playlists, each with a guessed dance; a bare "Rumba" asks which style; a bare "Tango" asks to double-check.
- [ ] Import one or two playlists; the review shows them as New / Updated.
- [ ] Change a dance and a tag; **Remove** a song and **Restore** it.
- [ ] The **Duplicates** and **Versions** filters; **Not a duplicate**; a **Work** box change.
- [ ] **▶** plays a song in the player at the bottom of the page.
- [ ] Step 4a: paste a song link; search for a song; load a playlist song by song; give dances; add the ticked songs to the review.
- [ ] **Define a new dance…**: add one, and see it offered in the dance boxes.
- [ ] **Save**, then **Download a backup** (three files).
- [ ] Back to the generator: the changes are there.

## C. Setting up and generating a night

- [ ] **Shared presets…**: load each of the three; generate each; the Latin night is mostly Latin and ends on a Bolero / Rumba; Roarin' Twenties opens with Foxtrot, Quickstep or Swing.
- [ ] Change a few settings (a theme, a special block of chosen songs, a must-play song); the warnings under the settings make sense.
- [ ] **Save user settings…** and **Load user settings…** with a file.
- [ ] Edit the playlist: swap, insert, remove, undo, drag a row and a block, lock some songs and **Regenerate unlocked songs**.
- [ ] **Play on Spotify** links open the right songs.
- [ ] **Save to Spotify**: the playlist appears in Spotify, in order.
- [ ] **Program**: print preview (no buttons, no footer), and **Download program (Word)** opens in Word or Google Docs with an empty Song name column.

## D. During the night (real playback)

Play the saved playlist in Spotify (on any device of the same account).

- [ ] **Live view**: asks once for the "what is playing" permission (on the site, not Spotify's page: "Allow"), then follows Spotify within a few seconds.
- [ ] Skip ahead, go back, jump to another song: the live view follows; the numbers match the generator and the program.
- [ ] A song not in the playlist: **Off the plan**; **It's #…** matches it; **Add to the night** with a dance shows **Added**.
- [ ] Pause: "Paused", the timer stops; resume.
- [ ] **Open the Dancers screen** on a projector or TV (as a second screen), **Full screen**: readable from across the room; Now, Next dance, Following dance.
- [ ] Edit the playlist in the generator during playback: both live screens follow.
- [ ] Leave it running for more than an hour: it keeps working (the login renews itself).

## E. Phone width

Use a phone, or the browser's device mode (F12, then Ctrl+Shift+M) on a narrow phone size.

- [ ] Generator page: the settings sections, the playlist table (scrolls sideways), the windows (View library, Swap) fit.
- [ ] Library builder: the steps and the review table are usable.
- [ ] Live view and Dancers screen: readable.
- [ ] On a real phone, once: log in and save a playlist to Spotify.

## F. Accounts and keys

- [ ] An account **not** on the key's list: a clear message saying to ask the site's owner (or use your own key).
- [ ] **Log out** on the generator page: the library's details are cleared; logging in again brings everything back.
- [ ] (Optional) Your own key: paste a Client ID in the Spotify connection panel; logging in uses it; **Use the site's key instead** goes back.
- [ ] **Delete everything this site keeps in this browser…** (in the private window, or after downloading a backup): logged out, the library gone; **Load library files…** brings it back.

## G. Before tagging

- [ ] `npm test` passes; `npm run snapshots:check` shows only intended differences.
- [ ] README.md matches the app; CHANGELOG.md has the release's entry; package.json has the version.
