# A playlist generator for social dance events

## Definitions

For the purposes of this readme, please note the following dance-related definitions:

* **Song:** an individual piece of music, irrespective of whatever dance(s) may be associated with it.
* **Dance** (n): a categorical identity for a collection of bodily motions that may be done in rhythm or in time with a **song**.
* **Category:** a categorical identity for a collection of **dances**.

"Oye Como Va" is a song. The cha-cha is a dance. International Latin is a category containing five dances, of which one is the cha-cha.

Please note that colloquial language will often blur the lines between hard definitions, often used as lexical shorthand to more quickly get a point across. For example, the phrase "'Oye Como Va' is a cha-cha" is shorthand for "'Oye Como Va' is a song to which you can dance the cha-cha".

Please also note the following other definitions:

* **Association:** a group of dances treated as one, because their music is interchangeable. For example, "Waltz" associates Smooth Waltz and Standard Waltz.
* **Excursion:** a song or dance that is outside of the defined categories for a single particular playlist.
* **Fixed event:** an occurrence that is designed to take place at a specific point in the playlist.
* **Theme** (n): what a particular event is about (e.g. Hollywood, Roarin' Twenties, Hustle night), expressed as a set of dances and/or song tags. A song that is played as a theme dance, or that carries a theme tag, is a **theme song**.

---

## Introduction

Creating a playlist for a dance social takes a certain artistry to ensure that said playlist meets a large number of criteria, many of which are unwritten. The efforts required to meet these criteria can be extensive. Furthermore, because different social events may have different themes, necessitating slightly different song choices between different playlists, it is often not feasible to reuse any one playlist for a different social event without completely redoing the entire song order. This app is designed to randomly generate a playlist subject to a number of rules, and to save it straight to Spotify.

Our conception of a dance playlist is as follows:

1. All dances in question are condensed wherever stylistic similarities are possible, using **associations**: e.g., from competitive ballroom, Standard Waltz and Smooth Waltz are simply "Waltz". In competitive ballroom there are 19 dances in four styles: American Rhythm (Cha-cha, Rumba, Swing, Bolero, Mambo), American Smooth (Waltz, Tango, Foxtrot, Viennese Waltz), International Standard (Waltz, Tango, Viennese Waltz, Foxtrot, Quickstep), and International Latin (Cha-cha, Samba, Rumba, Paso Doble, Jive). Dances that share a name are associated by default, with two exceptions: American and International Rumba are *not* associated, while American Bolero *is* associated with International Rumba. Similarly, Swing / Jive and Salsa / Mambo may have similar enough music to be considered the same. All dances are then organized into the minimum number of categories required to maintain distinct identities. For example, the four styles in competitive ballroom condense to two categories: Smooth / Standard and Rhythm / Latin. For categories with highly unique dances (e.g. Paso Doble), the user has the option of excluding these dances from the overall pool, to be handled separately (e.g. as a fixed event).
2. Outside of the dances within the primary categories, there is also a small percentage of excursion dances (e.g. West Coast Swing, Hustle, Bachata, etc. are NOT normally danced in competitive ballroom). These occur on a timer: **Every** *x* minutes (by default 25), with an optional **Random variation** of ± a few minutes, so that they do not come like clockwork. These dances work on a sort of reducing-pool die. The user is responsible for weighting each dance (its **Max count**) to their desired odds, based on the maximum number of times they wish to have that dance occur. Every time one of these excursions is called for, the app will roll for a dance based on these weights. Once a dance is selected, a single occurrence of that dance is removed from the pool. For instance, if Polka, Hustle, and Bachata are weighted 1, 1, and 3, respectively, this indicates that this particular event will have, at maximum, one Polka, one Hustle, and three Bachatas, with the chance of rolling a Bachata naturally higher than the other two at start. If the first excursion is a Bachata, then the odds become 1, 1, and 2, respectively; if the second excursion is another Bachata, then the odds become 1, 1, and 1, respectively; if the third excursion is yet another Bachata, then the odds become 1, 1, and 0, respectively, and no more Bachatas will play until the other two counters reach 0. If the counters reach 0, 0, and 0, then they reset to their initial values.
3. There is the option to include line dancing. These may be handled like excursions, wherein they will appear occasionally throughout the night; or like fixed events, wherein they will appear as a single block at a single fixed time (e.g. three line dances halfway through the night). A fixed event may list several dances; each of its songs is then one of them.
4. If there are multiple fixed events (e.g. a line dancing break and a single instance of the Paso Doble), they will not appear consecutively.
5. Many social events have a theme: e.g. Hollywood, Roarin' Twenties, etc. Furthermore, some social events have themed dances: e.g. Roarin' Twenties may lean towards using American swing dances (Foxtrot, Quickstep, Swing, Jive). It can be difficult to ensure that a playlist is populated with enough songs that match the theme, without feeling repetitive and boring. A theme lists **theme dances** and/or **theme song tags** (e.g. songs tagged "Hollywood"), and the **theme share** is the part of the night's songs that are theme songs. Consider that by default, the 19 competitive dances collapse into about 11 social dances; thus, a single dance will occur slightly less than 10% of the time. Therefore, even increasing the occurrence of a single dance to 25% will make it feel as if it occurs twice as much as other dances. As such, the limits on the occurrence of thematic dances may be lower than expected. For **broad** themes that do not focus on particular dances (e.g. Hollywood, whose songs can be any dance), theme songs make up between the **theme share at least** and **at most** values; by default, 50% to 70% of the time. Event themes that do focus on particular dances (e.g. "Hustle night") are, by default, weighted 20% to 25% of the time; these theme dances are also exempt from the shuffle-bag rule (explained in rule 7). Lastly, if a social event has a theme, the first several songs will always be guaranteed to match that theme (**Guaranteed theme openers**, default 2). When the theme has theme dances, the openers are theme dances, and the other rules do not apply to them: a Foxtrot night may open with several Foxtrots in a row, and a theme dance may open even if it is not allowed in the opening. With several theme dances, they take turns equally and the same dance never opens twice in a row: with theme dances A and B and four openers, the night opens ABAB or BABA. If there are more theme dances than openers, the ones left over do not open. A theme dance should be in a category, not an excursion: the app warns if a theme dance is still listed as an excursion. For a theme of song tags, excursion songs with the tag may also open the night. After the openers, the normal rules apply again. Theme songs can occur both within the primary dance categories OR in excursions.
6. Categories are interspersed; dancers should never feel that they are subject to a specific, known order of dances. However, we also believe that playlists should not exclusively alternate between categories, as categorical momentum (i.e. having multiple Ballroom or Latin dances in a row) can be a strongly positive feeling, plus gives a sense of having blocks of similar dances. The maximum number of same-category dances in a row is **Max in a row**; the default is 3. The app will locally randomize a block length up to this maximum; i.e., there will be blocks of the same category between 1 and 3 songs long. This block length will only be rerolled after ALL categories have had their turn. I.e., for an event where the two categories are Ballroom and Latin, if the app rolls two Ballroom songs in a row, it will be followed by two Latin songs in a row before rerolling the block length. This pattern will be interrupted by placement of excursions or fixed events.
7. Separately from interspersion is the topic of repetition. By default, no dance will be repeated until every dance in its category has played (the **shuffle-bag** rule); e.g., if the first Ballroom dance played is a Waltz, then another Waltz will not play until the Tango, Viennese Waltz, Foxtrot, and Quickstep have all occurred. Furthermore, dances will not repeat in a fixed order within a category. E.g., if you were to write down just the Ballroom dances of the night, you will NOT see a regularly patterned WTVFQ-WTVFQ-WTVFQ; rather, each group of five dances will be randomized, much like the block order in the game *Tetris*. There is further consideration for proximity of identical dances within the overall song order. Generally, it is not a good idea to have one song too close to another song of the same dance, even if both occurrences are interspersed by a different category. This behavior is handled by **Songs between repeats**, the minimum number of songs between two songs of the same dance (the default is 4). Lastly, theme dances (rule 5) are NOT prevented from repeating until all of the other dances within their category have occurred (i.e. they are excluded from the *Tetris* handling rules); however, they are still subject to the songs-between-repeats rule.
8. It may be desired to have a specific **last dance of the night**. If this is the case, the app will leave enough time such that the event will end no later than (longest allowed song − shortest allowed song) past the target length. Note that the last song is also excluded from repetition rules (e.g. it is possible for both the penultimate and ultimate songs to be of the same dance). Songs that are too short or too long for the event can be excluded with **Shortest song allowed** and **Longest song allowed**.
9. The beginning of a social should be accessible. As such, the first few songs should not be songs that are too difficult and/or too fast. The **Opening length** defines how many songs should be played before the event is considered to have passed the beginning of the night, and the dances listed under **Not allowed in the opening** are always excluded from those songs. By default, Mambo / Salsa and Quickstep are excluded, and the beginning of a social is defined as 6 songs long.

---

## Using the app

The app is online at **https://maxluo97.github.io/ballroom-social-playlist-generator/** (generating and saving playlists, from any device). The **library builder** runs on your computer, because it saves the library into the project's files.

You need a Spotify Premium account and a Spotify developer app (its Client ID goes in `js/config.js`; register both `https://maxluo97.github.io/ballroom-social-playlist-generator/` and `http://127.0.0.1:8000/` as redirect URIs). To run it on your computer you also need [Node.js](https://nodejs.org/).

1. On your computer, run `npm start` and open **http://127.0.0.1:8000/**.
2. **Build your song library** in the **Library builder** (from the generator page): log in to Spotify, import your single-dance playlists (each playlist's dance is guessed from its name), add individual songs if needed, review the dances and tags, and **save** the library to the project's `data` folder. You must do this at least once; the generator only uses a saved library. To use a new or changed library online, commit and push `data/songs.csv` and `data/removed-songs.csv` (the online site picks them up a few minutes later).
3. **Set up the night** on the generator page. Settings can be saved to and loaded from files (keep them in `presets/`); **Load default settings** restores `data/default-settings.json`.
4. **Generate** a playlist. While you are logged in, its songs are checked on Spotify, and any that cannot be played are replaced automatically. You can swap, insert and remove songs by hand; every change can be undone.
5. **Save to Spotify** creates the playlist in your account, or **Copy Spotify links** lets you paste the songs into a playlist yourself.

Run `npm test` to check the generator and the library logic.

### Files

| File | What it is |
|---|---|
| `data/songs.csv` | Your song library: id, title, artist, album, length, dances, tags, isrc. |
| `data/removed-songs.csv` | Songs you removed from the library (same columns, plus the date removed), so imports do not bring them back and you can restore them. |
| `data/default-settings.json` | The default settings, in the same format as a saved settings file. |
| `presets/` | Your saved settings files. |
| `index.html`, `library.html`, `js/`, `css/` | The app. |
| `test/`, `tools/` | Tests, and the local web server. |

---

## Roadmap

* **v0.2.4:** themed blocks (a block of songs with a given tag, either as a fixed event or within the normal category turns) and covers (avoiding several versions of the same song in one night).
* **v0.3:** let individual users log in with their own Spotify accounts.
* **Later:** export a playlist to slides.
