// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * special-blocks.js — special blocks (README rules 3, 4 and 10; the agreed spec, docs/history.md, v0.4).
 *
 * Each block gets its start time once per night: a fixed point, a random point (after the opening songs
 * and before the last 15% of the night), or a random point in a window. It starts at the first song
 * after that time, never inside the opening (it then waits until the opening is over). Blocks never
 * interrupt each other: a block that comes due during another one waits.
 *
 *   From dances  Songs of those dances (varied when it can), outside the turns (kind "event"); the
 *                repeat gap is ignored among its own songs but kept from the songs around it.
 *   From a tag   In the turns: the next `count` regular songs, each with the tag. Outside the turns: any
 *                dance the settings use, with the tag. Both keep the shuffle-bag and the repeat gap.
 *   Chosen songs Exactly those songs, in their order, outside the turns; they ignore the shuffle-bag, the
 *                repeat gap among themselves and the length limits. The songs around them keep the
 *                normal gap: the block waits a few songs (at most minToRepeat + 1) until none of its
 *                songs would come too soon after the same dance, and anything that interrupts it
 *                avoids the dances of its next songs.
 * If no song fits, a block shrinks (with a warning, from generate-playlist.js).
 */

import { blockLabel, outsideTurns, LATEST_RANDOM_BLOCK_POINT } from "./event-settings.js";
import { isKeptApartRow } from "./playlist-stats.js";

export function createSpecialBlocks(night, turns) {
  const { settings, categories, categoryOfDance, theme, targetSec, lockedPlan, songById, songFilter } = night;

  /* ---- the night's blocks, with their start times (random ones rolled now, in settings order) ---- */
  const blocks = settings.specialBlocks
    .map((blockSettings, blockId) => {
      const placement = blockSettings.placement;
      const startShare = placement.mode === "random" ? night.openingShare + night.random() * (LATEST_RANDOM_BLOCK_POINT - night.openingShare)
        : placement.mode === "window" ? placement.from + night.random() * Math.max(0, placement.to - placement.from)
          : placement.at;
      const keptLocked = !!lockedPlan && lockedPlan.skipBlocks.includes(blockId); // already in the playlist (locked)
      const block = {
        ...blockSettings,
        id: blockId,
        label: blockLabel(blockSettings),
        atSec: startShare * targetSec,
        started: keptLocked,
        placed: 0, // songs of it played so far
      };
      if (blockSettings.source === "songs") {
        block.list = []; // the chosen songs that can play, in order
        for (const id of blockSettings.songs) {
          const song = songById.get(id);
          if (!song) night.warn(-1, `${block.label}: a chosen song (${id}) is not in the library, so it was left out.`);
          else if (songFilter && !songFilter(song, { dance: null, elapsed: 0, index: -1 })) {
            night.warn(-1, `${block.label}: "${song.title}" cannot be played, so it was left out.`);
          } else block.list.push(song);
        }
        block.count = block.list.length;
        // Chosen songs, and their duplicates, are kept for the block.
        for (const song of block.list) {
          night.reservedIds.add(song.id);
          night.reservedRecordings.add(night.recordingOf.get(song.id));
        }
      }
      return block;
    })
    .filter((block) => (block.source === "songs" ? block.list.length > 0
      : block.source === "dances" ? block.dances.length > 0 && block.count > 0
        : block.tag && block.count > 0))
    .sort((first, second) => first.atSec - second.atSec);

  const specialBlocks = {
    blocks,
    active: null, // the block being played
  };

  /** The dance a chosen song is played as: the first of its dances the settings use. */
  const chosenDance = (song) => song.dances.find((dance) => night.dancesTheSettingsUse.includes(dance)) || song.dances[0] || "";
  specialBlocks.chosenDance = chosenDance;

  /** Whether a chosen-songs block could start now without any of its songs coming too soon after the same dance. */
  function chosenFit(block) {
    return block.list.slice(0, settings.minToRepeat).every((song, iSong) => night.gapAllowed(chosenDance(song), settings.minToRepeat - iSong));
  }

  /**
   * The dances other songs should avoid now: while a chosen-songs block plays, those of its next songs
   * (for interruptions); while one waits to start, those of its first songs (so the wait ends soon).
   */
  night.upcomingDances = () => {
    const active = specialBlocks.active;
    if (active && active.source === "songs") {
      return new Set(active.list.slice(active.placed, active.placed + settings.minToRepeat).map(chosenDance));
    }
    const waiting = !active && blocks.find((block) => block.source === "songs" && !block.started && block.dueSince !== undefined);
    return waiting ? new Set(waiting.list.slice(0, settings.minToRepeat).map(chosenDance)) : null;
  };

  /** The block that should start now, or null. */
  specialBlocks.dueBlock = () => {
    if (specialBlocks.active || night.playlist.length < settings.opening.earlyCount) return null;
    const lastRow = night.lastRow();
    return blocks.find((block) => {
      if (block.started || night.elapsedSec < block.atSec || (block.keepApart && isKeptApartRow(lastRow))) return false;
      // "Never directly after": a dance, or another block's name.
      if (lastRow && block.notAfter.some((name) => name === lastRow.dance || name === lastRow.blockLabel)) return false;
      if (block.source !== "songs") return true;
      // A chosen-songs block waits (a few songs at most) until its songs keep the normal gap.
      block.dueSince ??= night.playlist.length;
      if (chosenFit(block)) return true;
      if (night.playlist.length - block.dueSince <= settings.minToRepeat) return false;
      night.warn(night.playlist.length, `Rule relaxed (spacing) to start "${block.label}": a dance in it played too recently.`);
      return true;
    }) || null;
  };

  /** Something interrupted the active block: it goes on afterwards, or ends, as the block says. */
  specialBlocks.interrupted = () => {
    if (specialBlocks.active && specialBlocks.active.afterInterruption === "end") specialBlocks.active = null;
  };

  /** Play the next song of a block. Returns false if no song fits (the block then shrinks). */
  specialBlocks.placeBlockSong = (block) => {
    const markBlock = () => Object.assign(night.lastRow(), { blockId: block.id, blockLabel: block.label, keepApart: !!block.keepApart });

    if (block.source === "dances") {
      // Any of the block's dances; varied within the block when there is a choice. The repeat gap is kept
      // from songs outside the block (not among the block's own songs).
      const dancesWithSongs = block.dances.filter((dance) => night.hasSong(dance, false));
      if (!dancesWithSongs.length) return false;
      const keepsGapFromOutside = (dance) => {
        for (let placesBack = 1; placesBack <= settings.minToRepeat && placesBack <= night.playlist.length; placesBack++) {
          const row = night.playlist[night.playlist.length - placesBack];
          if (row.blockId !== block.id && row.dance === dance) return false;
        }
        return !night.lockedAhead(dance, settings.minToRepeat, night.playlist.length);
      };
      let options = dancesWithSongs.filter(keepsGapFromOutside);
      if (!options.length) {
        night.warn(night.playlist.length, `Rule relaxed (spacing) in "${block.label}": its dances played too recently.`);
        options = dancesWithSongs;
      }
      const previousRow = night.lastRow();
      if (previousRow && previousRow.blockId === block.id && options.length > 1) options = options.filter((dance) => dance !== previousRow.dance);
      const dance = night.pickRandom(options);
      night.addSong(dance, night.pickSong(dance, false), "event", null, block.label);
      markBlock();
      night.lastRow().fromDances = true;
      return true;
    }

    if (block.source === "songs") {
      const song = block.list[block.placed];
      const dance = chosenDance(song);
      const iCategory = categoryOfDance.get(dance);
      night.placingChosen = true;
      night.addSong(dance, song, "block", iCategory === undefined ? null : categories[iCategory].name, block.label);
      night.placingChosen = false;
      markBlock();
      night.lastRow().chosen = true;
      return true;
    }

    // A block from a tag.
    const withTag = (song) => (song.tags || []).includes(block.tag);
    const fits = (dance) => night.gapAllowed(dance, settings.minToRepeat) && night.hasSong(dance, false, withTag);
    const markTagBlock = () => {
      markBlock();
      night.lastRow().blockTag = block.tag;
    };
    if (!outsideTurns(block)) {
      // The category whose turn it is; another one only if the turn's category has no tagged song.
      for (const iCategory of turns.categoriesFromCurrent()) {
        if (turns.runTooLong(iCategory)) continue;
        const options = turns.bagAndThemeDances(iCategory).filter(fits);
        if (!options.length) continue;
        const dance = night.pickRandom(options);
        turns.commitRegular(iCategory, dance, night.pickSong(dance, false, { require: withTag }));
        markTagBlock();
        return true;
      }
      return false;
    }
    // Outside the turns: category dances from their shuffle-bags, other dances the settings use as they are.
    const inBags = new Set(categories.flatMap((_, iCategory) => turns.bagAndThemeDances(iCategory)));
    const options = night.dancesTheSettingsUse.filter((dance) => (!categoryOfDance.has(dance) || inBags.has(dance)) && fits(dance));
    if (!options.length) return false;
    const dance = night.pickRandom(options);
    const iCategory = categoryOfDance.get(dance);
    night.addSong(dance, night.pickSong(dance, false, { require: withTag }), "block", iCategory === undefined ? null : categories[iCategory].name, block.label);
    if (iCategory !== undefined && !theme.dances.has(dance)) turns.bags[iCategory] = turns.bags[iCategory].filter((inBag) => inBag !== dance);
    markTagBlock();
    return true;
  };

  return specialBlocks;
}
