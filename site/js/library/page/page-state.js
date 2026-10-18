// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * page-state.js — the library builder's state, shared by its steps, and the look-ups they all use
 * (known dances and tags, the dance and tag chip boxes, the keyword tag rules).
 *
 * The steps redraw each other (an import redraws the review; saving redraws step 2). They do it through
 * `redraw`, which library-page.js fills in, so the steps do not need to import each other.
 */

import { el, $, chipEditor } from "../../shared/dom.js";
import { withDetails } from "../../shared/song-details.js";
import { libraryRow } from "../../shared/data.js";
import { canonicalDance, unknownDanceMessage, DANCE_ALIASES, BALLROOM_STYLES, BALLROOM_DANCE_NAMES, customDanceNames } from "../../shared/dance-names.js";

/** The shared library (the site owner's data/ folder): its songs, and its library playlist. */
export const SHARED_LIBRARY_URL = "data/songs.csv";
export const SHARED_LIBRARY_INFO_URL = "data/library.json";
/** Step 5 shows the review table in pages of this many songs. */
export const REVIEW_PAGE_SIZE = 200;
/** The library playlist in your Spotify account (holds the whole library; see site/js/shared/song-details.js). */
export const LIBRARY_PLAYLIST_NAME = "Dance library (managed by the playlist generator)";
export const LIBRARY_PLAYLIST_DESCRIPTION =
  "Used by the dance playlist generator to read your song library. Changes here are overwritten when the library is saved.";
/** Where this browser remembers the folder chosen for "Publish to the data folder". */
export const DATA_FOLDER_KEY = "dpg-data-folder";

export const state = {
  existing: [], // the library the page started from (step 2)
  existingName: "",
  playlists: null, // your readable playlists (step 4)
  hiddenCount: 0, // playlists you follow but cannot read
  // playlist id -> { selected, dances: [...], tags: [...], ambiguous: [{ dance, options }], checks: [guesses to confirm] }
  choices: new Map(),
  playlistSearch: "",
  imports: null, // the last imported playlists (kept so tag rules can be re-applied without Spotify)
  failures: [], // playlists that could not be read
  // Step 4a's worklist: songs added one by one. { song, include, dances: [...], tags: [...], source }
  manual: [],
  manualHideKnown: false,
  spotifySearch: { query: "", results: [], total: 0, nextOffset: null },
  rows: null, // the review's rows (the merge result; see site/js/library/library-merge.js)
  blacklist: new Map(), // songs removed from the library before (removed-songs.csv)
  filter: "all", // step 5's filter
  search: "", // step 5's search
  reviewSort: { key: null, dir: 1 }, // step 5's table: the column heading clicked, and the direction
  pickingRecording: null, // step 5: the song whose "Same recording as…" picker is open
  userId: null, // the logged-in Spotify account (each account has its own library in this browser)
  notAllowed: false, // Spotify refuses this account (not on the key's list)
  reviewLimit: REVIEW_PAGE_SIZE, // step 5 shows this many matching songs; "Show more" adds a page (only rows on screen are built)
  playlistMaybeForeign: false, // the library playlist came from the shared library or files: check it is yours
  saved: null, // this account's library as last saved in this browser (see site/js/shared/library-store.js)
  savedKey: null, // the saved library's files, to tell whether the page has unsaved changes
  pendingRows: null, // the library being loaded, while its details are read
  libraryPlaylistId: null,
  details: { refreshing: null, error: null }, // reading Spotify's details of the library
  // Step 5: songs flagged as duplicates / versions when the review was built. They stay on those
  // lists while you correct them, so a fix never makes a song you still need to check disappear.
  flagged: { duplicates: new Set(), versions: new Set() },
  dataFolderName: null, // the folder "Publish to the data folder" writes to
  saveMessage: null, // what the last save (or publish) did
  saveOk: false,
  leaving: false, // going back to the generator on purpose: no "unsaved changes" warning from the browser
};

/** The page's drawing functions, filled in by library-page.js. */
export const redraw = {
  spotify: null,
  existing: null,
  playlists: null,
  manual: null,
  review: null,
  output: null,
};

/** Settings of this page kept in this browser (JSON values; never fails). */
export const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

/** A song with the Spotify details known now, keeping its own data (dances, tags, corrections). */
export const freshDetails = (song) => withDetails([libraryRow(song)])[0];

/** "a; b | c" -> ["a", "b", "c"]. */
export const splitList = (text) => String(text ?? "").split(/[;|]/).map((item) => item.trim()).filter(Boolean);
/** Dances typed by the user, in standard form ("American Rumba" -> "Rhythm Rumba"). */
export const danceList = (text) => [...new Set(splitList(text).map(canonicalDance))];
export const errorBox = (message) => el("ul", { class: "msgs" }, el("li", { class: "error" }, message));

/** Dance names already in the library that are not standard ballroom names (e.g. "Salsa", your own ones). */
export const libraryDances = () => [...new Set(state.existing.flatMap((song) => song.dances || []))];

/** Dance suggestions: the 19 ballroom names, other known dances, your own dances, and whatever the library uses. */
export function knownDances() {
  const ballroomBaseNames = new Set(Object.values(BALLROOM_STYLES).flatMap((style) => style.dances));
  const dances = new Set([
    ...BALLROOM_DANCE_NAMES,
    ...Object.keys(DANCE_ALIASES).filter((dance) => !ballroomBaseNames.has(dance)),
    ...customDanceNames(),
    ...libraryDances(),
  ]);
  return [...dances].sort();
}

/* ---- the keyword tag rules (step 3) ---- */

const RULES_KEY = "dpg.tagRules.v2"; // [{ keyword, tag }]
export const DEFAULT_RULES = [
  { keyword: "soundtrack", tag: "Hollywood" },
  { keyword: "motion picture", tag: "Hollywood" },
  { keyword: "from the film", tag: "Hollywood" },
  { keyword: "from the movie", tag: "Hollywood" },
  { keyword: "original score", tag: "Hollywood" },
];

/** The keyword tag rules kept in this browser (the default Hollywood rules if none). */
export function loadRules() {
  const rules = store.get(RULES_KEY, null);
  return Array.isArray(rules) ? rules : DEFAULT_RULES.map((rule) => ({ ...rule }));
}

export const saveRules = (rules) => store.set(RULES_KEY, rules);

/**
 * Tag suggestions: tags in the library and the keyword rules, plus every tag typed anywhere on this
 * page so far (playlist rows, worklist, review), so a new tag is offered in all later tag boxes.
 */
export const knownTags = () =>
  [...new Set([
    ...state.existing.flatMap((song) => song.tags || []),
    ...loadRules().map((rule) => rule.tag),
    ...[...state.choices.values()].flatMap((choice) => choice.tags),
    ...state.manual.flatMap((entry) => entry.tags),
    ...(state.rows || []).flatMap((row) => row.song.tags),
  ])].filter(Boolean).sort();

/** The suggestion lists of the page's dance and tag boxes. */
export function updateLists() {
  $("dl-known").replaceChildren(...knownDances().map((dance) => el("option", { value: dance })));
  $("dl-tags").replaceChildren(...knownTags().map((tag) => el("option", { value: tag })));
}

/**
 * A chip box for a list of dances: a dropdown of known dances; "American Rumba" -> "Rhythm Rumba".
 * Only known dances can be added (new ones are defined with "Define a new dance…").
 */
export const danceChips = (list, label, onChange) =>
  chipEditor(list, knownDances, {
    placeholder: "add a dance…", label, normalize: canonicalDance, onChange,
    allowed: knownDances, notAllowed: unknownDanceMessage,
  });

/** A chip box for a list of tags. */
export const tagChips = (list, label, onChange) => chipEditor(list, knownTags, { placeholder: "add a tag…", label, onChange });
