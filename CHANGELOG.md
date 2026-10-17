# Changelog

Each release lists what changed since the previous one. The log starts at v0.2.4, with a summary of what the app could do at that point; earlier versions are not covered.

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
