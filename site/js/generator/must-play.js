// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * must-play.js — must-play songs (README rule 12; the agreed spec, docs/history.md, v0.2.5).
 *
 * They are spread evenly after the opening, in random order: of k songs, the i-th (from 1) is due at
 * i / (k + 1) of the night. When one is due, it plays where it fits the rules (its category's turn,
 * shuffle-bag and gap; an excursion or standalone theme dance: the gap only); after a few songs it plays
 * anyway, with a warning. Each is kept for its moment, like a chosen song: it never plays elsewhere,
 * nor do its duplicates (other versions may).
 */

export function createMustPlay(night, turns, specialBlocks) {
  const { settings, categories, categoryOfDance, theme, plan, targetSec, songById, songFilter } = night;

  // A must-play song that is also a chosen song plays in its chosen-songs block, which counts for both.
  const inChosenBlocks = new Set(specialBlocks.blocks.flatMap((block) => (block.list || []).map((song) => song.id)));
  const pending = [];
  for (const id of settings.mustPlay) {
    const song = songById.get(id);
    if (!song) {
      night.warn(-1, `A must-play song (${id}) is not in the library, so it was left out.`);
      continue;
    }
    if (inChosenBlocks.has(song.id)) continue;
    if (night.usedIds.has(song.id)) continue; // a locked row already plays it
    const dance = song.dances.find((candidate) => night.dancesTheSettingsUse.includes(candidate));
    if (!dance) {
      night.warn(-1, `Must-play song "${song.title}" never plays: none of its dances is in a category, an excursion or a theme dance.`);
      continue;
    }
    if (songFilter && !songFilter(song, { dance, elapsed: 0, index: -1 })) {
      night.warn(-1, `Must-play song "${song.title}" cannot be played, so it was left out.`);
      continue;
    }
    pending.push({ song, dance, placed: false });
    night.reservedIds.add(song.id);
    night.reservedRecordings.add(night.recordingOf.get(song.id));
  }
  const inOrder = night.shuffled(pending);
  inOrder.forEach((mustPlaySong, iSong) => (mustPlaySong.dueAtSec = Math.max(night.openingShare, (iSong + 1) / (inOrder.length + 1)) * targetSec));
  /** How many songs a due must-play song waits for a place that fits the rules, before it plays anyway. */
  const MAX_WAIT_SONGS = settings.minToRepeat + settings.maxInARow * Math.max(1, categories.length);

  /** Play a must-play song that is due, if it fits now (or has waited long enough). Returns whether one played. */
  function placeMustPlay() {
    if (night.playlist.length < settings.opening.earlyCount) return false;
    const due = inOrder.find((mustPlaySong) => !mustPlaySong.placed && night.elapsedSec >= mustPlaySong.dueAtSec);
    if (!due) return false;
    due.dueSinceIndex ??= night.playlist.length;
    const iCategory = categoryOfDance.get(due.dance);
    let fits = night.gapAllowed(due.dance, settings.minToRepeat);
    if (fits && iCategory !== undefined) {
      turns.refillBagIfEmpty(iCategory, turns.nonThemeDances(iCategory));
      fits = turns.currentCategory() === iCategory && (theme.dances.has(due.dance) || turns.bags[iCategory].includes(due.dance));
    }
    // It plays anyway after a few songs, or when the night is nearly over (so it is never left out).
    const nearlyOver = targetSec - night.elapsedSec - night.finalReserveSec < due.song.lengthSec + 2 * night.averageSongSec;
    const waitedSongs = night.playlist.length - due.dueSinceIndex;
    if (!fits && !nearlyOver && waitedSongs <= MAX_WAIT_SONGS) return false;
    if (!fits) night.warn(night.playlist.length, `Rule relaxed to play must-play song "${due.song.title}" (it was due ${waitedSongs} songs earlier).`);
    night.placingChosen = true; // other versions of it may play elsewhere
    if (iCategory !== undefined) turns.commitRegular(iCategory, due.dance, due.song);
    else if (plan.standalone.includes(due.dance)) night.addSong(due.dance, due.song, "theme", null, night.themeLabel);
    else night.addSong(due.dance, due.song, "excursion", null, null); // does not use up an excursion count
    night.placingChosen = false;
    night.lastRow().mustPlay = true;
    due.placed = true;
    return true;
  }

  return {
    placeMustPlay,
    /** The must-play songs that have not played (yet). */
    notPlayed: () => inOrder.filter((mustPlaySong) => !mustPlaySong.placed),
  };
}
