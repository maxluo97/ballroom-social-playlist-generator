// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * generator.js — the generator engine's front door: rule-based random playlists for dance events.
 *
 * Everything outside the engine (the generator page, playlist editing, the library builder, the tests)
 * imports from this file. The engine itself is pure logic, with no page, browser or Spotify code, so
 * it runs the same in the browser and in Node (the tests).
 *
 * THE ENGINE'S FILES (all in this folder)
 *   event-settings.js     the defaults; filling in settings; special-block defaults; associations
 *   theme-plan.js         how the theme is played (theme dances in categories, the hidden theme category)
 *   validate-settings.js  the settings check before generating (errors and warnings)
 *   generate-playlist.js  makes a night: the main loop, place by place
 *     night-state.js      the working state of a night: songs, random numbers, the playlist so far
 *     category-turns.js   the categories' turns, shuffle-bags, normal songs, relaxing rules
 *     theme-songs.js      theme openers, theme songs, the hidden theme category
 *     excursions.js       the excursion timer and the reducing-pool die
 *     special-blocks.js   special blocks (from dances, a tag, or chosen songs)
 *     must-play.js        must-play songs
 *   playlist-stats.js     the kinds of playlist rows; the theme share and other figures; formatTime
 *   check-rules.js        checks a playlist against the settings, independently
 *
 * VOCABULARY
 *   Song        { id, title, lengthSec, dances: [...], tags: [...] }   (a song may serve several dances)
 *   Dance       a label such as "Waltz" or "Bachata"
 *   Association a group of dances treated as one, e.g. "Waltz" = Smooth Waltz + Standard Waltz. Applied
 *               first: song dances and every dance named in the settings are renamed to the group's
 *               name, so the rules only ever see the merged dances.
 *   Category    a named group of dances ("Ballroom", "Latin", "Swing", ...). Any number (N >= 1).
 *   Excursion   a dance outside the categories, drawn on a timer from a reducing-weight pool
 *   Special block a run of songs at one point in the night: from dances (line-dance break, Paso Doble, ...),
 *               from a tag, or chosen songs (see 10).
 *   Theme       dances and/or song tags that should appear at an elevated rate. A song is a "theme
 *               song" if it is played as a theme dance OR carries a theme tag ("Hollywood night" = tag;
 *               "Hustle night" = dance; both may be combined).
 *
 * SETTINGS (all optional except `categories`; see DEFAULT_SETTINGS in event-settings.js)
 *   eventLengthMinutes   target length of the night
 *   minSongSec, maxSongSec  songs shorter / longer than this are never played (null = no limit)
 *   associations         [{ name, dances: [...] }, ...]        each dance in at most one association
 *   categories           [{ name, dances: [...] }, ...]        each dance in at most one category
 *   maxInARow            longest turn of one category (turns are 1..maxInARow songs)
 *   minToRepeat          songs that must separate two songs of the same dance
 *   excursions           { intervalMinutes, jitterMinutes, pool: { dance: maxOccurrences } }
 *   theme                { name, dances, tags, fractionMin, fractionMax, minGap } or null
 *   specialBlocks        [{ name, source: "dances"|"tag"|"songs", dances: [...], tag, count, songs: [Spotify IDs],
 *                           inTurns (tag only), keepApart, notAfter: [dances or block names],
 *                           placement: { mode: "at"|"random"|"window", at, from, to },
 *                           interruptBy: { excursions, theme }, afterInterruption: "continue"|"end" }]
 *   opening              { earlyCount, blacklist: [dances] }
 *   closing              { finalDance }   (null = no designated last dance)
 *   noRepeatWorks        no two versions of the same song (work) in one night (default true)
 *   mustPlay             [Spotify IDs]: songs spread evenly through the night (see NOTES.md v0.2.5)
 *   seed                 integer for reproducible output (null = random)
 *
 * RULES (numbers follow the README where possible)
 *   1. Categories take turns of 1..maxInARow songs. One turn length is rolled per cycle, and rerolled
 *      only after every category has had its turn (the cycle order is shuffled, and a cycle never starts
 *      with the category that just ended the previous one).                       [category-turns.js]
 *   2. Excursions fire on a timer (every interval ± jitter, the first one too); each draw is weighted
 *      and removes one entry from the pool. When every counter reaches 0, the pool resets to its
 *      starting weights. The theme does not steer which excursion plays.           [excursions.js]
 *   3/4. (Fixed events are special blocks from dances: see 10.)
 *   5. Theme songs (dance or tag) are steered to make up fractionMin..fractionMax of the regular,
 *      hidden-theme, excursion and block songs after the opening: before each regular song, the share
 *      decides whether a theme song is due. With a theme, the opening songs are theme songs; a theme
 *      with dances opens with its theme dances taking turns, outside the other rules.  [theme-songs.js]
 *   6. (turns, see 1)
 *   7. Within a category, non-theme dances are drawn from a shuffle-bag (Tetris-style): no repeat until
 *      all the category's non-theme dances have occurred. minToRepeat applies to every dance, except the
 *      designated final song (and songs of one block from dances or chosen songs among themselves).
 *   8. Closing: the final song is reserved up front. Songs are added while the shortest song in the
 *      library would still fit, so the night ends within
 *      (target - shortest song, target + longest song - shortest song].            [generate-playlist.js]
 *   9. Opening: the first `earlyCount` songs avoid the blacklist.
 *  9b. Duplicates (same recording under another Spotify ID) never play in one night; with
 *      noRepeatWorks, neither do two versions of the same work (relaxed as a last resort). See
 *      site/js/shared/works.js.                                                    [night-state.js]
 *  10. Special blocks (the agreed spec, NOTES.md v0.4): a run of songs at a fixed point, a random point
 *      or in a window (never inside the opening), from dances (kind "event": outside the turns, never
 *      theme songs, not in the theme share, spacing ignored among themselves), a tag (in the turns as
 *      regular songs, or outside them as kind "block"; shuffle-bag and spacing apply) or chosen songs
 *      (kind "block", exactly in order). Too few fitting songs shrink the block. Blocks never interrupt
 *      each other; excursions and hidden theme songs wait unless a block allows them. "Keep apart"
 *      blocks are never next to each other; `notAfter` names dances or blocks the block may not
 *      directly follow.                                                            [special-blocks.js]
 *  12. Must-play songs are spread evenly after the opening.                        [must-play.js]
 *
 * If a rule set cannot be satisfied (e.g. too few songs), rules are relaxed in a fixed order and a
 * warning is recorded, instead of failing (RELAXATION_LEVELS in category-turns.js).
 */

export { DEFAULT_SETTINGS, BLOCK_DEFAULTS, blockLabel, mergeSettings, associationMap, withinLengthLimits, listDances } from "./event-settings.js";
export { themeMinGapFor, themeMinGapApplies } from "./theme-plan.js";
export { validateSettings } from "./validate-settings.js";
export { mulberry32 } from "./night-state.js";
export { generatePlaylist } from "./generate-playlist.js";
export { computeStats, formatTime } from "./playlist-stats.js";
export { checkRules } from "./check-rules.js";
