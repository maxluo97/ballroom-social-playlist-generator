// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * live-core.js — the live view's and the program's logic, without the page (the agreed spec,
 * docs/history.md, v0.4 "Live view and program").
 *
 * The generator page hands the playlist to the live and program pages as a "live plan", kept in this
 * browser's storage so every window of the app sees the latest version (edits included):
 *   { savedAt, songs: [{ id, dance, block, blockId, last }], dances: { songId: "Rumba / Cha-cha" } }
 * Only Spotify IDs and the user's own data (dances, block names): song titles come from Spotify.
 * `dances` covers the whole library, so a song played off the plan can still show its dance.
 */

import { spotifyTrackId } from "../shared/data.js";

export const LIVE_PLAN_KEY = "dpg.live.v1";
/** Songs matched to the plan by hand on the live view ("It's #15"): { playedId: plannedId }. */
export const LIVE_MATCHES_KEY = "dpg.live.matches.v1";
/** Songs added during the night (played off the plan), with the dance the organizer gave: { songId: dance }. */
export const LIVE_ADDED_KEY = "dpg.live.added.v1";

/** The live plan of a (possibly edited) generated playlist; `rows` are the library's rows. */
export function livePlan(result, rows = []) {
  const dances = {};
  for (const row of rows) {
    const id = spotifyTrackId(row.id);
    if (id && (row.dances || []).length) dances[id] = row.dances.join(" / ");
  }
  return {
    savedAt: new Date().toISOString(),
    songs: result.playlist.filter((playlistRow) => !playlistRow.removed).map((playlistRow) => ({
      id: spotifyTrackId(playlistRow.song.id) || playlistRow.song.id,
      dance: playlistRow.dance || "",
      block: playlistRow.blockLabel || null,
      blockId: playlistRow.blockId ?? null,
      last: playlistRow.kind === "final",
    })),
    dances,
  };
}

/** Keep the live plan for the live and program pages (null: forget it, with the night's matches and added songs). */
export function saveLivePlan(plan) {
  try {
    if (plan) localStorage.setItem(LIVE_PLAN_KEY, JSON.stringify(plan));
    else {
      localStorage.removeItem(LIVE_PLAN_KEY);
      localStorage.removeItem(LIVE_MATCHES_KEY);
      localStorage.removeItem(LIVE_ADDED_KEY);
    }
  } catch {
    /* storage unavailable or full: the live page will say there is no playlist */
  }
}

/** The songs matched to the plan by hand: { playedId: plannedId }. */
export function loadMatches() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_MATCHES_KEY)) || {};
  } catch {
    return {};
  }
}

/** Remember that the song playing as `playedId` is the planned song `plannedId` (null: forget them all). */
export function saveMatch(playedId, plannedId) {
  try {
    if (playedId === null) localStorage.removeItem(LIVE_MATCHES_KEY);
    else localStorage.setItem(LIVE_MATCHES_KEY, JSON.stringify({ ...loadMatches(), [playedId]: plannedId }));
  } catch {
    /* storage unavailable: the match is not kept */
  }
}

/** The songs added during the night: { songId: dance }. */
export function loadAdded() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_ADDED_KEY)) || {};
  } catch {
    return {};
  }
}

/** Remember the dance of a song added during the night (only its Spotify ID and the dance are kept). */
export function saveAdded(songId, dance) {
  try {
    localStorage.setItem(LIVE_ADDED_KEY, JSON.stringify({ ...loadAdded(), [songId]: dance }));
  } catch {
    /* storage unavailable: the dance is not kept */
  }
}

/** The live plan the generator page kept, or null. */
export function loadLivePlan() {
  try {
    const plan = JSON.parse(localStorage.getItem(LIVE_PLAN_KEY));
    return plan && Array.isArray(plan.songs) ? plan : null;
  } catch {
    return null;
  }
}

/**
 * Where the playing song is in the plan, or -1. By its Spotify ID; then the ID Spotify relinked it
 * from; then the same recording (ISRC; `isrcOf(id)` gives a planned song's); then a match made by
 * hand (`matches`). A song planned twice: the first time after `after` (the last planned song
 * played), else the first time.
 */
export function findInPlan(plan, song, isrcOf = () => "", after = -1, matches = {}) {
  if (!plan || !song) return -1;
  const songs = plan.songs;
  /** The place of the planned song that passes `test`: the first one after `after`, else the first; -1 if none. */
  const pick = (test) => {
    const places = songs.map((planned, iPlanned) => (test(planned) ? iPlanned : -1)).filter((iPlanned) => iPlanned >= 0);
    return places.length ? places.find((iPlanned) => iPlanned > after) ?? places[0] : -1;
  };
  let place = song.id ? pick((planned) => planned.id === song.id) : -1;
  if (place < 0 && song.linkedFromId) place = pick((planned) => planned.id === song.linkedFromId);
  if (place < 0 && song.isrc) place = pick((planned) => (isrcOf(planned.id) || "").toUpperCase() === song.isrc.toUpperCase());
  const matchedByHand = song.id && matches[song.id];
  if (place < 0 && matchedByHand) place = pick((planned) => planned.id === matchedByHand);
  return place;
}

/**
 * What the live screens show. `playing` is getCurrentlyPlaying()'s answer (or null before the first
 * one); `lastIndex` is the last planned song played so far (-1 for none). Returns:
 *   index      the playing song's place in the plan, or -1
 *   offPlan    a song is playing that is not in the plan
 *   lastIndex  the last planned song played (for the next call)
 *   current    the playing song's plan row (null if none or off the plan)
 *   added      an off-plan song the organizer added during the night (its dance is offPlanDance)
 *   offPlanDance  the dance of an off-plan song: the one given when it was added, else from the
 *              library ("" if unknown). Added songs never change the order: next stays the next planned song.
 *   nextIndex, next   the next planned song (null after the last song of the night)
 *   following  the planned song after that (null if none)
 *   nextBlock  { label, inSongs } for the next special block (inSongs 1 = the next song), or null
 *              during a block, or when no block is left
 *   upcoming   the next few planned songs: [{ index, row }]
 */
export function liveState(plan, playing, lastIndex = -1, { isrcOf = () => "", upcomingCount = 5, matches = {}, added = {} } = {}) {
  const songs = (plan && plan.songs) || [];
  const song = playing && playing.song;
  const index = song ? findInPlan(plan, song, isrcOf, lastIndex, matches) : -1;
  const offPlan = !!song && index < 0;
  if (index >= 0) lastIndex = index;
  const planPlace = index >= 0 ? index : lastIndex; // where the night is in the plan
  const current = index >= 0 ? songs[index] : null;
  const nextIndex = planPlace + 1;
  const next = songs[nextIndex] || null;

  let nextBlock = null;
  if (!(current && current.blockId !== null)) {
    // An off-plan song may come in the middle of a block: the rest of that block is not "next".
    const inBlock = planPlace >= 0 && songs[planPlace] && songs[planPlace].blockId !== null ? songs[planPlace].blockId : null;
    for (let iSong = nextIndex; iSong < songs.length; iSong++) {
      const blockId = songs[iSong].blockId;
      if (blockId === null || blockId === inBlock) continue;
      nextBlock = { label: songs[iSong].block || "Special block", inSongs: iSong - planPlace };
      break;
    }
  }
  const libraryDance = offPlan ? (plan.dances && (plan.dances[song.id] || plan.dances[song.linkedFromId])) || "" : "";
  const addedDance = offPlan && song.id ? added[song.id] || "" : "";
  const upcoming = songs.slice(nextIndex, nextIndex + upcomingCount).map((row, iUpcoming) => ({ index: nextIndex + iUpcoming, row }));
  return {
    index,
    offPlan,
    lastIndex,
    current,
    added: !!addedDance,
    offPlanDance: addedDance || libraryDance,
    nextIndex,
    next,
    following: songs[nextIndex + 1] || null,
    nextBlock,
    upcoming,
  };
}

/** How far into the playing song we are now (ms), counting on from Spotify's last answer. */
export function progressNow(playing, now = Date.now()) {
  if (!playing || !playing.song) return 0;
  const progressMs = playing.progressMs + (playing.isPlaying ? now - playing.at : 0);
  return Math.max(0, Math.min(progressMs, playing.song.durationMs || progressMs));
}

/** Milliseconds as m:ss (whole seconds, rounded down, as a song's timer shows them). */
export function clock(ms) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

/** "next song", "in 3 songs". */
export const inSongsText = (songCount) => (songCount <= 1 ? "next song" : `in ${songCount} songs`);

/** The program's rows: [number, dance, special block]; the last dance says so. */
export function programRows(plan) {
  return ((plan && plan.songs) || []).map((planned, iSong) => [String(iSong + 1), planned.last ? `${planned.dance} (last dance)` : planned.dance, planned.block || ""]);
}
