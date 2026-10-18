# Changelog

Each release lists what changed since the previous one. The log starts at v0.2.4, with a summary of what the app could do at that point; earlier versions are not covered.

## v0.4 (October 2026): special blocks, the live view and the program

**Special blocks**
- **Fixed events and movable blocks are now one setting, Special blocks:** a run of songs at one point in the night, from **dances** (e.g. a line-dance break, or a single Paso Doble), from **a tag**, or **songs you choose**.
- Every block has a name, a number of songs, a placement (at a point, at a random point, or between two points) and interruption settings.
- **Keep apart from other special blocks:** ticked blocks never play directly next to each other (on by default for blocks of dances). **Never directly after** works on every block, with dances or other blocks.
- Special blocks never interrupt each other; a block that comes due during another waits until it ends.
- A block with too few songs that fit is shorter, with a warning (blocks of dances no longer play a song twice).
- Inside a block of dances, its songs may follow each other closely; the songs around it keep the songs-between-repeats rule.
- A block with a tag takes part in the category turns unless **Takes part in the category turns** is unticked.
- Old settings files lose their fixed events and movable blocks; the default settings and the shared presets were converted.

**Live view** (during the night)
- **Live view** on the generator page follows what Spotify is playing (about every 5 seconds, read only; Spotify asks for permission once). It follows skipping, going back and jumping around.
- **Music runner** screen: the song playing now (number, dance, title, artist, time), the next dance, the next special block ("in 3 songs"), and the next few songs.
- **Dancers** screen, for a projector: the dance playing now with its title and artist, the next dance and the following dance, in large print, full screen.
- A song not in the playlist shows as **Off the plan**: say which planned song it is ("It's #15…"), or **Add to the night** with its dance, without changing the order. **Check Spotify now** asks at once.
- Edits made on the generator page during the night show up on the live view.

**Program**
- **Program** on the generator page: the song order with each song's dance and special blocks, to **print** or **download as a Word document** (with an empty **Song name** column to fill in by hand; song titles are not included, by Spotify's terms).

**Under the hood**
- Several windows of the app share one Spotify login safely (only one renews it at a time).

## v0.3 (October 2026): your own Spotify account, your own library

**Who can use the app**
- **Everyone uses their own Spotify account.** The new **Spotify connection** panel, on both pages, explains the two ways to connect:
  - **The site's key:** up to 5 accounts, added by the site's owner. A free Spotify account is fine.
  - **Your own key, or one shared with you by its owner:** the key's owner needs Spotify Premium, registers a small app in Spotify's developer dashboard (step-by-step instructions in the panel), and can let up to 5 accounts use it.
- An account that Spotify does not allow gets a clear message, saying what to do.
- **Log out** on the generator page.

**Your library**
- **Kept in your browser, for your Spotify account:** Spotify IDs plus your own dances, tags, corrections and removed songs. Two people sharing a computer each have their own library.
- **The library builder works online.** A new library starts from the **shared library** (songs already sorted into dances and tagged) or empty.
- **Download a backup** (three files) and **Load library files…** move a library between browsers or computers. The app reminds you when changes are not in a backup.
- **The library playlist:** a private playlist in your Spotify account, created on your first save (after you confirm) and kept up to date. The app reads the songs' titles, lengths and availability from it.
- The library builder's review table is shown in pages of 200 songs, so large libraries stay quick.

**Following Spotify's rules**
- **No Spotify song details are stored for good** (Spotify's Developer Terms): they are read from your library playlist and kept in the browser for up to 14 days. **Refresh from Spotify** reads them again.
- **Availability** comes from the same refresh, so songs that cannot play are never picked. The song-by-song check after generating is gone.
- **"Download CSV" and "Copy song list"** were removed from the generator, since they made permanent copies of Spotify's details. **Copy Spotify links** and **Save generated playlist to Spotify** remain.
- **Credit:** Spotify's logo credits song details, and a Spotify icon next to each song opens it on Spotify.
- **Permissions:** each page asks Spotify only for the permissions it needs.
- **Rate limits:** the app waits longer and longer when Spotify limits requests, and stops at once when the limit is long.
- **Security:** a security policy on both pages allows only the site's own scripts.

**Settings**
- **Shared presets:** settings files shared on the site, offered under **Shared presets…** on the generator page.
- **"Themed blocks" are now called movable blocks.**

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
