// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * live-core.js — the live view's and the program's logic, without the page (the agreed spec,
 * NOTES.md v0.4 "Live view and program").
 *
 * The generator page hands the playlist to the live and program pages as a "live plan", kept in this
 * browser's storage so every window of the app sees the latest version (edits included):
 *   { savedAt, songs: [{ id, dance, block, blockId, last }], dances: { songId: "Rumba / Cha-cha" } }
 * Only Spotify IDs and the user's own data (dances, block names): song titles come from Spotify.
 * `dances` covers the whole library, so a song played off the plan can still show its dance.
 */

import { spotifyTrackId } from "./data.js";

export const LIVE_PLAN_KEY = "dpg.live.v1";
/** Songs matched to the plan by hand on the live view ("It's #15"): { playedId: plannedId }. */
export const LIVE_MATCHES_KEY = "dpg.live.matches.v1";
/** Songs added during the night (played off the plan), with the dance the organizer gave: { songId: dance }. */
export const LIVE_ADDED_KEY = "dpg.live.added.v1";

/** The live plan of a (possibly edited) generated playlist; `rows` are the library's rows. */
export function livePlan(r, rows = []) {
  const dances = {};
  for (const row of rows) {
    const id = spotifyTrackId(row.id);
    if (id && (row.dances || []).length) dances[id] = row.dances.join(" / ");
  }
  return {
    savedAt: new Date().toISOString(),
    songs: r.playlist.filter((x) => !x.removed).map((it) => ({
      id: spotifyTrackId(it.song.id) || it.song.id,
      dance: it.dance || "",
      block: it.blockLabel || null,
      blockId: it.blockId ?? null,
      last: it.kind === "final",
    })),
    dances,
  };
}

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

export function loadLivePlan() {
  try {
    const p = JSON.parse(localStorage.getItem(LIVE_PLAN_KEY));
    return p && Array.isArray(p.songs) ? p : null;
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
  const pick = (test) => {
    const hits = songs.map((x, i) => (test(x) ? i : -1)).filter((i) => i >= 0);
    return hits.length ? hits.find((i) => i > after) ?? hits[0] : -1;
  };
  let i = song.id ? pick((x) => x.id === song.id) : -1;
  if (i < 0 && song.linkedFromId) i = pick((x) => x.id === song.linkedFromId);
  if (i < 0 && song.isrc) i = pick((x) => (isrcOf(x.id) || "").toUpperCase() === song.isrc.toUpperCase());
  const byHand = song.id && matches[song.id];
  if (i < 0 && byHand) i = pick((x) => x.id === byHand);
  return i;
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
  const base = index >= 0 ? index : lastIndex; // where the night is in the plan
  const current = index >= 0 ? songs[index] : null;
  const nextIndex = base + 1;
  const next = songs[nextIndex] || null;

  let nextBlock = null;
  if (!(current && current.blockId !== null)) {
    // An off-plan song may come in the middle of a block: the rest of that block is not "next".
    const inBlock = base >= 0 && songs[base] && songs[base].blockId !== null ? songs[base].blockId : null;
    for (let j = nextIndex; j < songs.length; j++) {
      const b = songs[j].blockId;
      if (b === null || b === inBlock) continue;
      nextBlock = { label: songs[j].block || "Special block", inSongs: j - base };
      break;
    }
  }
  const libraryDance = offPlan ? (plan.dances && (plan.dances[song.id] || plan.dances[song.linkedFromId])) || "" : "";
  const addedDance = offPlan && song.id ? added[song.id] || "" : "";
  const upcoming = songs.slice(nextIndex, nextIndex + upcomingCount).map((row, k) => ({ index: nextIndex + k, row }));
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
  const p = playing.progressMs + (playing.isPlaying ? now - playing.at : 0);
  return Math.max(0, Math.min(p, playing.song.durationMs || p));
}

/** 0:00 style. */
export function clock(ms) {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** "next song", "in 3 songs". */
export const inSongsText = (n) => (n <= 1 ? "next song" : `in ${n} songs`);

/** The program's rows: [number, dance, special block]; the last dance says so. */
export function programRows(plan) {
  return ((plan && plan.songs) || []).map((x, i) => [String(i + 1), x.last ? `${x.dance} (last dance)` : x.dance, x.block || ""]);
}
