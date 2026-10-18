// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * generate-playlist.js — makes one night's playlist: sets up the parts of the generator, then adds songs
 * one place at a time until the night is full, and finishes with the last dance.
 *
 * At each place, in this order of priority:
 *   1. a locked row whose place it is;
 *   2. a special block that is due starts (unless one is playing);
 *   3. a theme opener (in the opening);
 *   4. an excursion, when one is due (and the playing block, if any, allows interruptions);
 *   5. the playing block's next song (a hidden theme song may interrupt it, if allowed);
 *   6. a must-play song that is due;
 *   7. a theme song, if the theme share wants one;
 *   8. otherwise a normal song in the category turns.
 *
 * The random choices are made in a fixed order from the seed, so the same seed gives the same night.
 */

import { createNight } from "./night-state.js";
import { createCategoryTurns } from "./category-turns.js";
import { createThemeSongs } from "./theme-songs.js";
import { createExcursions } from "./excursions.js";
import { createSpecialBlocks } from "./special-blocks.js";
import { createMustPlay } from "./must-play.js";
import { computeStats } from "./playlist-stats.js";

/** A safety limit on the number of songs (a night never comes near it). */
const MAX_SONGS = 5000;

/**
 * @param rawSongs     the library's songs (see generator.js)
 * @param userSettings settings (missing ones are filled in from DEFAULT_SETTINGS)
 * @param options      songFilter(song, { dance, elapsed, index }) => boolean: an optional extra rule for
 *                     whether a song may play at a place (the generator page leaves out songs that
 *                     cannot play on Spotify);
 *                     locked: { keep: [{ position, row }], skipBlocks: [block ids] }: rows kept in their
 *                     places ("Regenerate unlocked songs"; see lockedForRegeneration in playlist-edit.js)
 * @returns { playlist, totalSec, targetSec, overtimeSec, seed, warnings, openingCount, stats }
 */
export function generatePlaylist(rawSongs, userSettings = {}, options = {}) {
  // The parts are set up in this order because some of them make random choices when they start
  // (the first excursion's time, random block points, the must-play order): keep it.
  const night = createNight(rawSongs, userSettings, options);
  const { settings, playlist, plan } = night;
  const turns = createCategoryTurns(night);
  const themeSongs = createThemeSongs(night, turns);
  const excursions = createExcursions(night);
  const specialBlocks = createSpecialBlocks(night, turns);
  const mustPlay = createMustPlay(night, turns, specialBlocks);

  /* ---- the last song is chosen first, so nothing else takes it ---- */
  let finalSong = night.lockedFinal ? night.lockedFinal.song : null;
  if (!night.lockedFinal && settings.closing.finalDance) {
    finalSong = night.pickSong(settings.closing.finalDance, false) ?? night.pickSong(settings.closing.finalDance, true);
    if (finalSong) night.markUsed(finalSong);
    else night.warn(-1, `No song available for final dance "${settings.closing.finalDance}".`);
  }
  night.finalReserveSec = finalSong ? finalSong.lengthSec : 0;

  /* ---- the main loop: keep adding songs while even the shortest song would still fit ---- */
  turns.newCycle();
  while (playlist.length < MAX_SONGS && night.elapsedSec + night.finalReserveSec + night.shortestSongSec <= night.targetSec) {
    const place = playlist.length;
    if (night.lockedAt.has(place)) {
      const row = night.lockedAt.get(place);
      night.lockedAt.delete(place);
      night.placeLocked(row);
      continue;
    }
    // A special block that is due starts (unless one is playing: blocks never interrupt each other).
    // A block that would land on a locked place waits for the next free place.
    if (!specialBlocks.active) {
      const dueBlock = specialBlocks.dueBlock();
      if (dueBlock && night.freeFor(dueBlock.count)) {
        dueBlock.started = true;
        specialBlocks.active = dueBlock;
      }
    }
    if (place < themeSongs.danceOpenerCount) {
      if (themeSongs.placeOpener()) continue;
      night.warn(place, "No theme dance song was left for the theme openers.");
    }
    if (place < themeSongs.tagOpenerCount && themeSongs.tryTagOpenerExcursion()) continue;
    // A block starts with one of its own songs; interruptions can only come after that.
    const active = specialBlocks.active;
    const mayInterrupt = (what) => !active || (active.placed > 0 && active.interruptBy[what]);
    if (excursions.isDue() && mayInterrupt("excursions") && excursions.tryExcursion()) {
      specialBlocks.interrupted();
      continue;
    }
    if (active) {
      // A hidden theme song may interrupt (if the block allows it) when a theme song is due and the
      // theme's roll picks its dance group and the hidden category.
      if (mayInterrupt("theme") && plan.standalone.length && night.themeMood() === "want" &&
          !themeSongs.tagGroupFirst() && themeSongs.hiddenChosen() && themeSongs.placeHidden()) {
        specialBlocks.interrupted();
        continue;
      }
      if (specialBlocks.placeBlockSong(active)) {
        if (++active.placed >= active.count) specialBlocks.active = null;
        continue;
      }
      const which = active.source === "dances" ? `of ${active.dances.map((dance) => `"${dance}"`).join(" or ")}` : `with the tag "${active.tag}"`;
      night.warn(place, active.placed
        ? `Special block "${active.label}" shrank to ${active.placed} of ${active.count} songs: no other song ${which} fits the rules.`
        : `Special block "${active.label}" could not play: no song ${which} fits the rules at that point.`);
      specialBlocks.active = null;
    }
    if (mustPlay.placeMustPlay()) continue;
    // Tag-only openers (and dance openers that ran out of songs) are forced inside placeRegular.
    const openerPlace = night.theme.active && place < settings.opening.earlyCount;
    const mood = night.themeMood();
    if (mood === "want" && !openerPlace && themeSongs.placeThemeSong()) continue;
    if (!turns.placeRegular(mood === "want" && !openerPlace ? "neutral" : mood)) {
      night.warn(place, "No playable song remained; the night was ended early.");
      break;
    }
  }

  /* ---- the end of the night ---- */
  // Locked songs that no longer fit before the end of the night are kept anyway, at the end.
  const lockedLeft = night.lockedAt;
  if (lockedLeft.size) {
    night.warn(playlist.length, `${lockedLeft.size} locked song(s) no longer fitted in their places before the end of the night, so they were kept at the end.`);
  }
  for (const position of [...lockedLeft.keys()].sort((first, second) => first - second)) night.placeLocked(lockedLeft.get(position));
  lockedLeft.clear();
  for (const mustPlaySong of mustPlay.notPlayed()) night.warn(-1, `Must-play song "${mustPlaySong.song.title}" did not play: the night ended first.`);
  const stillActive = specialBlocks.active;
  if (stillActive) night.warn(-1, `Special block "${stillActive.label}" was cut short by the end of the night (${stillActive.placed} of ${stillActive.count} songs).`);
  for (const block of specialBlocks.blocks) {
    if (!block.started) night.warn(-1, `Special block "${block.label}" never started (the night ended first).`);
  }

  if (night.lockedFinal) {
    night.addSong(night.lockedFinal.dance, night.lockedFinal.song, "final", night.lockedFinal.category ?? null, null);
    night.lastRow().locked = true;
  } else if (finalSong) {
    const finalDance = settings.closing.finalDance;
    const iCategory = night.categoryOfDance.get(finalDance);
    night.addSong(finalDance, finalSong, "final", iCategory === undefined ? null : night.categories[iCategory].name, null);
  }

  const result = {
    playlist,
    totalSec: night.elapsedSec,
    targetSec: night.targetSec,
    overtimeSec: night.elapsedSec - night.targetSec,
    seed: night.seed,
    warnings: night.warnings,
    openingCount: night.openingCount,
  };
  result.stats = computeStats(result);
  return result;
}
