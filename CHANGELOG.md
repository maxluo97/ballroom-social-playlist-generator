# Changelog

Each release lists what changed since the previous one. The log starts at v0.2.4, with a summary of what the app could do at that point; earlier versions are not covered.

## v0.2.5 (October 2026): editing and must-play

**Changing a generated playlist**
- **Move songs:** drag a row onto another, or use ↑ / ↓ on each row. Numbers and start times follow.
- **Move whole blocks:** themed blocks and fixed events with several songs (e.g. the line-dance break) appear as an inset box with a header line. Drag the header, or use Move block up / down, to move the block.
  - A block whose songs are reordered, swapped or removed is marked "(modified)".
  - A block whose songs are scattered is broken up: its songs are labeled by their category, "Excursion" or their dance, and they are locked.
- **Undo** takes back one change at a time, of any kind. **Reset all** takes back every change, locks included.
- **Lock and regenerate:**
  - Lock songs (one by one, or Lock all) and press **Regenerate unlocked songs** to make a new playlist around them. Locked songs keep their places, and the songs-between-repeats rule is kept around them.
  - A block that is partly locked keeps only its locked songs, together, as a "(modified)" block.
  - A broken-up block is not made again.
- Undo, Reset all and the lock buttons are shown above and below the playlist.
- **Generate playlist** and **Generate another** now ask before replacing a playlist.

**Must-play songs**
- New **Must-play songs** setting, using the same song picker as chosen-songs blocks.
- The songs are spread evenly through the night after the opening, in random order. Each plays where it fits the rules, or after a few songs anyway, with a warning.
- They play only if their dance is in a category, an excursion or a theme dance (the settings warn otherwise).
- They may break the song length limits.

## v0.2.4 (October 2026): the starting point

What the app does as of v0.2.4:

**Generator** (online at https://maxluo97.github.io/ballroom-social-playlist-generator/, or locally with `npm start`)
- Generates a dance-social playlist from your song library, following configurable rules:
  - categories take turns in blocks
  - no dance repeats until its category's other dances have played (shuffle-bag), and a minimum number of songs between repeats of a dance
  - excursions on a timer, from a weighted pool
  - fixed events, such as a line-dance break
  - an opening that avoids chosen dances, and an optional last dance
  - song length limits.
- **Associations** treat interchangeable dances as one, e.g. Smooth and Standard Waltz.
- **Themes** by dances and/or song tags, with a target share of theme songs:
  - theme openers
  - theme dances that are in no category, played as a hidden theme category
  - a theme minimum gap for tag themes.
- **Themed blocks:** a run of songs at a chosen or random point in the night. The songs come either from a tag or from songs you choose, in your order. A block can play as a fixed event, you choose what may interrupt it, and blocks can be named.
- **Works and duplicates:** never two copies of the same recording in one night, and by default never two versions of the same song (covers, live versions, remasters).
- When rules cannot all be met, they are relaxed in a fixed order, with warnings.
- Edit the result by hand: swap, insert, remove, restore, reset. Problems caused by an edit are reported.
- While you're logged in, songs are checked on Spotify, and unavailable ones are replaced automatically. The check copes with Spotify's request limits.
- Save the playlist to your Spotify account, copy the song links, or download a CSV.
- Settings can be saved to and loaded from files; the defaults live in `data/default-settings.json`.

**Library builder** (on your computer only)
- Imports your own Spotify playlists, with each playlist's dance guessed from its name, plus individual songs by link or search.
- Keyword rules suggest tags.
- You can define your own dances.
- Review the whole library:
  - filters and sorting
  - remove songs, which are remembered so imports don't bring them back, and restore them
  - Spotify availability
  - duplicates and versions, with corrections (work names, "Not a duplicate", "Same recording as…", "Rename work…")
  - a song preview player.
- Saves `data/songs.csv` and `data/removed-songs.csv` straight into the project's data folder (in Chrome or Edge), or downloads them.

**Limits at this point**
- The app serves only the developer's own Spotify account (Spotify's Development Mode).
- The library builder works only on a computer.
