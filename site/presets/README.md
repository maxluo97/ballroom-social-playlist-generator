# Shared presets

Settings files in this folder are offered on the site as **shared presets** ("Shared presets…" on the
generator page), next to each user's own settings files.

To add one: set up a night on the generator page, use **Save user settings…** and save the file here.
Then run `npm run presets` (it rewrites `index.json`, the list the site reads, because GitHub Pages
cannot list a folder), and commit and push this folder.

Presets contain only settings, nothing from Spotify. A preset that names specific songs (chosen-songs
blocks, must-play songs) works for everyone; songs missing from someone's library are left out with a warning.
