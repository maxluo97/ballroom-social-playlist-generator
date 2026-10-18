/**
 * library.js — the library builder page (library.html).
 *
 * Flow: log in -> start from data/songs.csv (or another CSV, or nothing) -> set up automatic tags
 * -> choose your own single-dance playlists and confirm each one's dance(s) -> import -> review
 * (edit dances/tags) -> download the merged songs.csv and save it as data/songs.csv.
 * Imports only add to the library; see js/library-merge.js for the exact rules.
 */

import { el, fill, $, chipEditor, comboInput, sortRows, sortHeader, spotifyCredit, spotifyListenLink } from "./dom.js";
import {
  login, logout, isLoggedIn, hasScopes, checkAccess, handleLoginRedirect, getMyPlaylists, getPlaylistTracks,
  getTrack, searchTracks, playlistIdFrom, createPlaylist, addTracksToPlaylist, removeTracksFromPlaylist, getPlaylistTrackIds,
  getPlaylistOwnerId,
} from "./spotify.js";
import { loadUserLibrary, saveUserLibrary, markDownloaded, changedSinceDownload } from "./library-store.js";
import {
  isUnavailable, unavailableReason, isChecked, withDetails, rememberDetails, refreshDetails, detailsNeedRefresh,
  detailsAgeDays, forgetExpiredDetails, reloadDetails, clearDetails,
} from "./song-details.js";
import { canSaveToFolder, getFolder, folderHasFile, writeTextFile, rememberedFolderName } from "./folders.js";
import { RUNNING_LOCALLY, SPOTIFY_SCOPES } from "./config.js";
import { spotifyConnectionPanel } from "./spotify-panel.js";
import { spotifyTrackId, spotifyLink } from "./data.js";
import {
  loadSongsFromUrl, parseSongsText, songsToCSV, parseRemovedSongs, removedSongsToCSV, parseLibraryInfo, libraryInfoText, libraryRow,
} from "./data.js";
import {
  guessDanceInfo, canonicalDance, unknownDanceMessage, DANCE_ALIASES, BALLROOM_STYLES, BALLROOM_DANCE_NAMES,
  setCustomDances, customDanceNames, newDanceProblem,
} from "./dance-names.js";
import {
  mergeImport, markPreviouslyRemoved, keptSongs, updatedBlacklist, blacklistChanged, blacklistRows,
} from "./library-merge.js";
import { formatTime } from "./generator.js";
import { workKey, workFromTitle, plainText, recordingKey, ownRecordingKey, sameKeyGroups, workName, joinValue } from "./works.js";

const PROJECT_URL = "data/songs.csv";
/** Step 5 shows the review table in pages of this many songs. */
const REVIEW_PAGE = 200;
const LIBRARY_INFO_URL = "data/library.json";
/** The library playlist in your Spotify account (holds the whole library; see js/song-details.js). */
const LIBRARY_PLAYLIST_NAME = "Dance library (managed by the playlist generator)";
const LIBRARY_PLAYLIST_DESCRIPTION =
  "Used by the dance playlist generator to read your song library. Changes here are overwritten when the library is saved.";
const DATA_FOLDER_KEY = "dpg-data-folder"; // remembered folder for "Save to the data folder"
const RULES_KEY = "dpg.tagRules.v2"; // [{ keyword, tag }]
const DEFAULT_RULES = [
  { keyword: "soundtrack", tag: "Hollywood" },
  { keyword: "motion picture", tag: "Hollywood" },
  { keyword: "from the film", tag: "Hollywood" },
  { keyword: "from the movie", tag: "Hollywood" },
  { keyword: "original score", tag: "Hollywood" },
];

const state = {
  existing: [],
  existingName: "",
  playlists: null, // readable playlists
  hiddenCount: 0,
  // playlist id -> { selected, dances: [...], tags: [...], ambiguous: [{dance, options}], checks: [guesses to confirm] }
  choices: new Map(),
  playlistSearch: "",
  imports: null, // last imported playlists (kept so tag rules can be re-applied without Spotify)
  failures: [],
  // Step 4a worklist: songs added one by one. { song, include, dances: [...], tags: [...], source }
  manual: [],
  manualHideKnown: false,
  spotifySearch: { query: "", results: [], total: 0, nextOffset: null },
  rows: null, // merge result
  blacklist: new Map(), // songs removed from the library before (data/removed-songs.csv)
  filter: "all",
  search: "",
  reviewSort: { key: null, dir: 1 }, // step 5 table: column heading clicked, and direction
  pickingRecording: null, // step 5: the song whose "Same recording as…" picker is open
  userId: null, // the logged-in Spotify account (each account has its own library in this browser)
  reviewLimit: 200, // step 5 shows this many matching songs; "Show more" adds a page (only rows on screen are built)
  playlistMaybeForeign: false, // the library playlist came from the shared library or files: check it is yours
  saved: null, // this account's library as last saved in this browser (see js/library-store.js)
  libraryPlaylistId: null, // from data/library.json
  details: { refreshing: null, error: null }, // reading Spotify's details of the library
  // Step 5: songs flagged as duplicates / versions when the review was built. They stay on those
  // lists while you correct them, so a fix never makes a song you still need to check disappear.
  flagged: { duplicates: new Set(), versions: new Set() },
};

/** A song with the Spotify details known now, keeping its own data (dances, tags, corrections). */
const freshDetails = (s) => withDetails([libraryRow(s)])[0];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
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

/*
 * Dances defined with "Define a new dance…": [{ name, style, spellings }], kept in this browser.
 * Once a song carries one in songs.csv it is known from the library anyway.
 */
const CUSTOM_DANCES_KEY = "dpg.customDances.v1";
let customDances = store.get(CUSTOM_DANCES_KEY, []);
setCustomDances(customDances);

const splitList = (text) => String(text ?? "").split(/[;|]/).map((x) => x.trim()).filter(Boolean);
/** Dances typed by the user, in standard form ("American Rumba" -> "Rhythm Rumba"). */
const danceList = (text) => [...new Set(splitList(text).map(canonicalDance))];
const errorBox = (message) => el("ul", { class: "msgs" }, el("li", { class: "error" }, message));

/** Names already in the library that are not standard ballroom names (e.g. "Salsa", custom ones). */
const libraryDances = () => [...new Set(state.existing.flatMap((s) => s.dances || []))];

/** Dance suggestions: the 19 ballroom names, other known dances, your own dances, and whatever the library uses. */
function knownDances() {
  const ballroomBases = new Set(Object.values(BALLROOM_STYLES).flatMap((s) => s.dances));
  const set = new Set([
    ...BALLROOM_DANCE_NAMES,
    ...Object.keys(DANCE_ALIASES).filter((d) => !ballroomBases.has(d)),
    ...customDanceNames(),
    ...libraryDances(),
  ]);
  return [...set].sort();
}

/* --------------------------------------------------------- your own dances */

function saveCustomDances() {
  store.set(CUSTOM_DANCES_KEY, customDances);
  setCustomDances(customDances);
  updateLists();
  // Playlists that had no dance guessed yet may now match one of your dances.
  if (state.playlists) {
    for (const p of state.playlists) {
      const c = state.choices.get(p.id);
      if (c.dances.length || c.ambiguous.length) continue;
      const { dances, ambiguous, checks } = guessDanceInfo(p.name, libraryDances());
      Object.assign(c, { dances, ambiguous, checks, selected: c.selected || (dances.length > 0 && !ambiguous.length) });
    }
  }
  renderPlaylists();
  renderManual();
}

/** The "Define a new dance…" window: add your own dances, or remove ones you defined. */
function openDanceDialog() {
  const dialog = $("dance-dialog");
  const name = el("input", { type: "text", placeholder: "e.g. Peabody", "aria-label": "Dance name", style: "flex:1 1 14em" });
  const style = el("select", { "aria-label": "Ballroom style" },
    el("option", { value: "" }, "None (not a competitive ballroom dance)"),
    Object.entries(BALLROOM_STYLES).map(([st, s]) => el("option", { value: st }, `${st} (${s.family})`)));
  const spellings = [];
  const preview = el("p", { class: "help" });
  const message = el("div", { "aria-live": "polite" });
  const updatePreview = () => {
    const n = name.value.trim();
    preview.textContent = n
      ? `It will be called “${style.value ? `${style.value} ${n}` : n}”` +
        (style.value ? `, and a playlist named “${n}” or “${BALLROOM_STYLES[style.value].family} ${n}” will be guessed as this dance.` : ".")
      : "";
  };
  name.addEventListener("input", updatePreview);
  style.addEventListener("change", updatePreview);

  const add = () => {
    const entry = { name: name.value.trim(), style: style.value || null, spellings: [...spellings] };
    const problem = newDanceProblem(entry, libraryDances());
    if (problem) return fill(message, errorBox(problem));
    customDances.push(entry);
    saveCustomDances();
    openDanceDialog(); // redraw with the new dance listed and an empty form
  };

  const list = customDances.length
    ? el("ul", { class: "plain-list" }, customDances.map((d, i) =>
        el("li", {},
          el("strong", {}, d.style ? `${d.style} ${d.name}` : d.name),
          d.spellings.length > 0 && el("span", { class: "muted" }, ` (also: ${d.spellings.join(", ")})`),
          " ",
          el("button", { type: "button", class: "small", onclick: () => {
            if (!confirm(`Remove “${d.name}” from your dances? Songs already tagged with it keep the tag.`)) return;
            customDances.splice(i, 1);
            saveCustomDances();
            openDanceDialog();
          } }, "Remove"))))
    : el("p", { class: "muted" }, "You have not defined any dances yet.");

  fill(dialog,
    el("h2", {}, "Your own dances"),
    el("p", { class: "help" }, "Add a dance the app does not know yet. It appears in every dance box on this page and is remembered " +
      "in this browser. Once songs with this dance are saved in songs.csv, it is known everywhere."),
    list,
    el("h3", {}, "Define a new dance"),
    el("div", { class: "inline-fields" }, "Name:", name),
    el("div", { class: "inline-fields" }, "Ballroom style:", style),
    el("p", { class: "help" }, "Competitive ballroom styles are specially handled. If this dance is part of a non-ballroom " +
      "category, e.g. WCS, use the “Categories and dances” function on the generator to create categories."),
    el("div", {}, el("div", { class: "label" }, "Other spellings for guessing from playlist names (optional):"),
      chipEditor(spellings, () => [], { placeholder: "e.g. peabodies", label: "Other spelling" })),
    preview,
    message,
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: add }, "Add this dance"),
      el("button", { type: "button", onclick: () => dialog.close() }, "Close")));
  if (!dialog.open) dialog.showModal();
  name.focus();
}

const defineDanceButton = () =>
  el("button", { type: "button", class: "small", onclick: openDanceDialog }, "Define a new dance…");

/**
 * Tag suggestions: tags in the library and the keyword rules, plus every tag typed anywhere on this
 * page so far (playlist rows, worklist, review), so a new tag is offered in all later tag boxes.
 */
const knownTags = () =>
  [...new Set([
    ...state.existing.flatMap((s) => s.tags || []),
    ...loadRules().map((r) => r.tag),
    ...[...state.choices.values()].flatMap((c) => c.tags),
    ...state.manual.flatMap((m) => m.tags),
    ...(state.rows || []).flatMap((r) => r.song.tags),
  ])].filter(Boolean).sort();

function updateLists() {
  $("dl-known").replaceChildren(...knownDances().map((d) => el("option", { value: d })));
  $("dl-tags").replaceChildren(...knownTags().map((t) => el("option", { value: t })));
}

const UNKNOWN_DANCE = unknownDanceMessage;

/**
 * Chip editor for a list of dances: dropdown of known dances; "American Rumba" -> "Rhythm Rumba".
 * Only known dances can be added (new dances will get their own button, not free typing).
 */
const danceChips = (list, label, onChange) =>
  chipEditor(list, knownDances, {
    placeholder: "add a dance…", label, normalize: canonicalDance, onChange,
    allowed: knownDances, notAllowed: UNKNOWN_DANCE,
  });

/** Chip editor for a list of tags. */
const tagChips = (list, label, onChange) => chipEditor(list, knownTags, { placeholder: "add a tag…", label, onChange });

/* ---------------------------------------------------------------- 1. Spotify */

function renderSpotify(message) {
  // The library on this page belongs to the account: logging out starts the page afresh.
  const signOut = () => { logout(); clearDetails(); location.reload(); };
  fill($("spotify"),
    el("p", {}, isLoggedIn() ? el("strong", {}, "Logged in to Spotify.") : "Not logged in."),
    message && errorBox(message),
    el("div", { class: "actions" },
      isLoggedIn()
        ? el("button", { type: "button", onclick: signOut }, "Log out")
        : el("button", { type: "button", class: "primary", onclick: () => login(SPOTIFY_SCOPES.library) }, "Log in with Spotify")),
    isLoggedIn() && !hasScopes(SPOTIFY_SCOPES.library) && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      "The library builder needs one more Spotify permission (reading collaborative playlists, or keeping the library playlist). ",
      el("button", { type: "button", class: "small", onclick: () => login(SPOTIFY_SCOPES.library) }, "Log in again to allow it"))),
    // Which Spotify key this browser uses; after changing it, log out (a login belongs to one key).
    spotifyConnectionPanel({ notAllowed: !!state.notAllowed, onChange: signOut }));
}

/* ------------------------------------------------------- 2. Starting library */

/*
 * Each Spotify account's library lives in this browser (js/library-store.js). A new library starts
 * from the shared library (the site owner's data/ folder: songs with their dances and tags; the
 * owner's library playlist is only reused if it is yours) or empty; files are backups.
 */

/** Startup (logged in): this account's library in this browser, if there is one. */
async function loadStart() {
  state.saved = loadUserLibrary(state.userId);
  if (state.saved) return useLibrary(state.saved, "Your library (this browser)", []);
  setExisting([], "", []);
}

/** Work on a library (rows of IDs and your data, removed songs, the library playlist's ID). */
async function useLibrary(lib, name, problems, { savedNow = true } = {}) {
  state.libraryPlaylistId = lib.playlistId;
  state.blacklist = lib.removed instanceof Map ? lib.removed : new Map();
  await resolvePlaylistOwner();
  // Spotify's details (titles, lengths, …) are not stored: read them from the library playlist.
  state.pendingRows = lib.rows;
  if (isLoggedIn() && state.libraryPlaylistId && detailsNeedRefresh(state.libraryPlaylistId)) await refreshLibraryDetails(false);
  state.pendingRows = null;
  setExisting(withDetails(lib.rows), name, problems);
  // Changes are measured against what is saved in this browser (a library from elsewhere is unsaved).
  state.savedKey = savedNow ? filesKey(currentFiles()) : null;
  renderOutput();
}

/** A library playlist from the shared library or from files is only used if it is in your account. */
async function resolvePlaylistOwner() {
  if (!state.playlistMaybeForeign) return;
  state.playlistMaybeForeign = false;
  if (!state.libraryPlaylistId) return;
  const owner = await getPlaylistOwnerId(state.libraryPlaylistId);
  if (!owner || owner !== state.userId) state.libraryPlaylistId = null; // your first save makes your own
}

/** Start from the shared library (data/ on the site): its songs with their dances and tags. */
async function startFromShared() {
  if (state.saved && !confirm("Start again from the shared library? The library on this page is replaced (your saved library stays in this browser until you save).")) return;
  try {
    const { songs, problems } = await loadSongsFromUrl(PROJECT_URL);
    state.libraryPlaylistId = await loadLibraryInfo();
    state.playlistMaybeForeign = true;
    await useLibrary({ rows: songs, removed: new Map(), playlistId: state.libraryPlaylistId }, "the shared library", problems, { savedNow: false });
  } catch (err) {
    alert(`The shared library could not be loaded: ${err.message}`);
  }
}

function startEmpty() {
  if (state.saved && !confirm("Start an empty library? The library on this page is replaced (your saved library stays in this browser until you save).")) return;
  state.libraryPlaylistId = state.saved ? state.saved.playlistId : null; // keep your library playlist
  state.blacklist = new Map();
  setExisting([], "an empty library", []);
  state.savedKey = null;
  renderOutput();
}

/** Load a backup: songs.csv (needed), removed-songs.csv and library.json (optional). */
async function loadLibraryFiles(files) {
  const byName = Object.fromEntries([...files].map((x) => [x.name.toLowerCase().replace(/ \(\d+\)(?=\.)/, ""), x]));
  const songsFile = byName["songs.csv"] || [...files].find((x) => /\.csv$/i.test(x.name) && !/removed/i.test(x.name));
  if (!songsFile) return alert("Choose your songs.csv (and, if you have them, removed-songs.csv and library.json).");
  try {
    const { songs, problems } = parseSongsText(await songsFile.text());
    const removedFile = byName["removed-songs.csv"] || [...files].find((x) => /removed/i.test(x.name));
    const infoFile = byName["library.json"] || [...files].find((x) => /\.json$/i.test(x.name));
    const removed = removedFile ? parseRemovedSongs(await removedFile.text()) : new Map();
    const playlistId = infoFile ? parseLibraryInfo(await infoFile.text()).playlistId : null;
    state.playlistMaybeForeign = true;
    await useLibrary({ rows: songs, removed, playlistId }, songsFile.name, problems, { savedNow: false });
  } catch (err) {
    alert(`Could not read the files: ${err.message}`);
  }
}

/** The shared library's playlist ID (data/library.json), or null. */
async function loadLibraryInfo() {
  try {
    const res = await fetch(LIBRARY_INFO_URL, { cache: "no-store" });
    return res.ok ? parseLibraryInfo(await res.text()).playlistId : null;
  } catch {
    return null;
  }
}

/** The song IDs of the library as it is now (or as loaded, before the review is built). */
const libraryIdsNow = () => (state.rows ? keptSongs(state.rows) : state.pendingRows || []).map((s) => s.id);

/** Read Spotify's details of the library from the library playlist (about one request per 50 songs). */
async function refreshLibraryDetails(redraw = true) {
  if (!state.libraryPlaylistId || !isLoggedIn()) return;
  state.details = { refreshing: { done: 0, total: 0 }, error: null };
  if (redraw && state.rows) renderReview();
  try {
    await refreshDetails(state.libraryPlaylistId, (done, total) => {
      state.details.refreshing = { done, total };
      const p = $("details-progress");
      if (p) p.textContent = `Reading your library from Spotify… ${done} of ${total} songs`;
    }, libraryIdsNow());
  } catch (err) {
    state.details.error = err.status === 429
      ? "Spotify is limiting requests right now, so the library could not be read; try again later (an hour is a safe start)."
      : err.status === 404 || err.status === 403
        ? "The library playlist was not found in your Spotify account (it may have been deleted). Saving the library (step 6) makes a new one."
        : `The library could not be read from Spotify: ${err.message}`;
  }
  state.details.refreshing = null;
  if (redraw && state.rows) {
    // Show the new details: every row's song gets them again (its own data is kept).
    for (const r of state.rows) r.song = freshDetails(r.song);
    renderReview();
  }
}

function setExisting(songs, name, problems) {
  state.existing = songs;
  state.existingName = name;
  state.imports = null;
  updateLists();
  renderExisting(problems);
  renderManual(); // its "In library" column depends on the starting library
  computeRows(); // the review shows the whole library straight away (so songs can be removed)
}

function renderExisting(problems = []) {
  if (!state.userId) {
    return fill($("existing"), el("p", { class: "muted" },
      "Log in first (step 1): your library is kept in this browser, for your Spotify account."));
  }
  const file = el("input", { type: "file", accept: ".csv,.json", multiple: true, hidden: true });
  file.addEventListener("change", () => file.files.length && loadLibraryFiles(file.files));
  const saved = state.saved;
  fill($("existing"),
    el("p", {}, state.existingName
      ? ["Starting from ", el("strong", {}, state.existingName), `: ${state.existing.length} songs. Imported songs are added to it; nothing in it is removed.`]
      : "You do not have a library in this browser yet. Start from the shared library (songs already sorted into dances and tagged), or start empty and build your own."),
    saved && el("p", { class: "muted" }, `Your library in this browser: ${saved.rows.length} songs, saved ${new Date(saved.savedAt).toLocaleString()}` +
      (saved.downloadedAt ? `; last backup downloaded ${new Date(saved.downloadedAt).toLocaleString()}.` : "; no backup downloaded yet.")),
    state.existingName === "the shared library" && el("p", { class: "help" },
      "If this is your first library, the songs' titles appear after your first save (step 6), which puts them in a playlist in your Spotify account."),
    problems.length > 0 && el("ul", { class: "msgs" }, problems.map((p) => el("li", { class: "warning" }, p))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: saved ? "small" : "primary", onclick: startFromShared }, "Start from the shared library"),
      el("button", { type: "button", class: "small", onclick: startEmpty }, "Start empty"),
      el("button", { type: "button", class: "small", onclick: () => file.click() }, "Load library files…"),
      saved && state.existingName !== "Your library (this browser)" &&
        el("button", { type: "button", class: "small undo", onclick: () => useLibrary(state.saved, "Your library (this browser)", []) }, "Back to your saved library"),
      file));
}

/* --------------------------------------------------------- 3. Automatic tags */

function loadRules() {
  const rules = store.get(RULES_KEY, null);
  return Array.isArray(rules) ? rules : DEFAULT_RULES.map((r) => ({ ...r }));
}

function renderRules() {
  const rules = loadRules();
  const save = () => {
    store.set(RULES_KEY, rules);
    updateLists();
    updatePreview();
  };

  const tbody = el("tbody");
  const drawRules = () =>
    fill(tbody, rules.map((r, i) => {
      const keyword = el("input", { type: "text", value: r.keyword, placeholder: "e.g. soundtrack", "aria-label": "Words to look for",
        oninput: () => { r.keyword = keyword.value.trim(); save(); } });
      const { wrap: tagWrap, input: tag } = comboInput(
        { value: r.tag, placeholder: "e.g. Hollywood", "aria-label": "Tag to add", oninput: () => { r.tag = tag.value.trim(); save(); } },
        knownTags,
        (v) => { tag.value = v; r.tag = v; save(); });
      return el("tr", {},
        el("td", {}, keyword),
        el("td", {}, tagWrap),
        el("td", {}, el("button", { type: "button", class: "icon", title: "Remove rule", "aria-label": "Remove rule",
          onclick: () => { rules.splice(i, 1); save(); drawRules(); } }, "×")));
    }));
  drawRules();

  // "Try it" box: shows which tags a title / album would get.
  const tryBox = el("input", { type: "text", placeholder: "e.g. Moon River (From \"Breakfast at Tiffany's\" Soundtrack)", "aria-label": "Try a title or album", style: "flex:1 1 20em" });
  const tryResult = el("strong", {});
  const updatePreview = () => {
    const text = tryBox.value.toLowerCase();
    const tags = [...new Set(rules.filter((r) => r.keyword && r.tag && text.includes(r.keyword.toLowerCase())).map((r) => r.tag))];
    tryResult.textContent = !text ? "" : tags.length ? `→ tags: ${tags.join(", ")}` : "→ no tags";
  };
  tryBox.addEventListener("input", updatePreview);

  fill($("rules"),
    el("p", { class: "help" }, "Tags mark songs for themes (e.g. “Hollywood”). There are two ways to add them automatically during import:"),
    el("ol", { class: "help" },
      el("li", {}, el("strong", {}, "A whole playlist: "), "in step 4, type a tag in the Tags box next to a playlist. Every song in that playlist gets it."),
      el("li", {}, el("strong", {}, "By keyword (below): "), "if a song's title or album name contains the words in the left column, it gets the tag in the right column. " +
        "For example, “soundtrack → Hollywood” tags every song from an album called “… (Original Motion Picture Soundtrack)”.")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist", style: "max-width:40em" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "If the title or album contains…"), el("th", { scope: "col" }, "…add this tag"), el("th", {}))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "small", onclick: () => { rules.push({ keyword: "", tag: "" }); save(); drawRules(); } }, "+ Add rule"),
      el("button", { type: "button", class: "small", onclick: () => {
        if (!confirm("Replace your rules with the default Hollywood rules?")) return;
        rules.splice(0, rules.length, ...DEFAULT_RULES.map((r) => ({ ...r })));
        save();
        drawRules();
      } }, "Restore default rules")),
    el("div", { class: "inline-fields" }, "Try a title or album:", tryBox, tryResult),
    el("p", { class: "help" }, "Capitals are ignored. Tags added by keyword are highlighted in step 5 so you can check them. " +
      "If you change the rules after importing, press “Re-apply tag rules” in step 5."));
}

/* ------------------------------------------------------------- 4. Playlists */

async function loadPlaylists() {
  fill($("playlists"), el("p", { class: "muted" }, "Loading your playlists…"));
  try {
    const all = await getMyPlaylists((n, total) => fill($("playlists"), el("p", { class: "muted" }, `Loading your playlists… ${n} of ${total}`)));
    state.playlists = all.filter((p) => p.ownedByMe || p.collaborative);
    state.hiddenCount = all.length - state.playlists.length;
    for (const p of state.playlists) {
      if (state.choices.has(p.id)) continue;
      const { dances, ambiguous, checks } = guessDanceInfo(p.name, libraryDances());
      state.choices.set(p.id, { selected: dances.length > 0 && !ambiguous.length, dances, tags: [], ambiguous, checks });
    }
  } catch (err) {
    state.playlists = null;
    fill($("playlists"), errorBox(err.message));
    return;
  }
  renderPlaylists();
  renderManual(); // its playlist chooser lists these playlists too
}

const familyOf = (option) => {
  const style = option.split(" ")[0];
  return BALLROOM_STYLES[style] ? `${style} = ${BALLROOM_STYLES[style].family}` : option;
};

function renderPlaylists() {
  const box = $("playlists");
  if (!isLoggedIn()) return fill(box, el("p", { class: "muted" }, "Log in first (step 1)."));
  if (!state.playlists) {
    return fill(box,
      el("p", { class: "help" }, "Lists the playlists you own or collaborate on (Spotify only lets apps read those). " +
        "Each playlist's dance is guessed from its name; check it before importing."),
      el("button", { type: "button", class: "primary", onclick: loadPlaylists }, "Load my playlists"));
  }

  const search = el("input", { type: "text", placeholder: "filter by name…", value: state.playlistSearch, "aria-label": "Filter playlists" });
  const tbody = el("tbody");
  const count = el("span", { class: "muted" });
  const updateCount = () => {
    const sel = state.playlists.filter((p) => state.choices.get(p.id).selected);
    const songs = sel.reduce((t, p) => t + (p.trackCount || 0), 0);
    count.textContent = `${sel.length} playlist(s) selected, about ${songs} songs.`;
  };

  const drawRows = () => {
    const q = state.playlistSearch.toLowerCase();
    fill(tbody, state.playlists.filter((p) => p.name.toLowerCase().includes(q)).map((p) => {
      const c = state.choices.get(p.id);
      const check = el("input", { type: "checkbox", checked: c.selected, "aria-label": `Import ${p.name}`, onchange: () => { c.selected = check.checked; updateCount(); } });
      const dances = danceChips(c.dances, `Dances for ${p.name}`, () => {
        // Giving a playlist a dance selects it for import.
        if (c.dances.length && !c.selected) (c.selected = true), (check.checked = true);
        updateCount();
      });
      const tags = tagChips(c.tags, `Tags for ${p.name}`);
      // A bare "Rumba" could be American (Rhythm) or International (Latin): ask.
      const questions = c.ambiguous.map((a) =>
        el("div", { class: "ask" }, `“${a.dance}”: which style? `,
          a.options.map((opt) => el("button", { type: "button", class: "small", onclick: () => {
            if (!c.dances.includes(opt)) c.dances.push(opt);
            c.ambiguous = c.ambiguous.filter((x) => x !== a);
            c.selected = true;
            drawRows();
            updateCount();
          } }, `${opt} (${familyOf(opt)})`))));
      // A bare "Tango" is guessed as ballroom Tango, but flagged: it could be Argentine.
      const flags = c.checks.map((k) =>
        el("div", { class: "ask" }, `⚠ ${k.message} `,
          el("button", { type: "button", class: "small", onclick: () => {
            c.dances = [...c.dances.filter((d) => !k.guessed.includes(d)), k.alternative].filter((d, i, all) => all.indexOf(d) === i);
            c.checks = c.checks.filter((x) => x !== k);
            drawRows();
          } }, `It's ${k.alternative}`),
          el("button", { type: "button", class: "small", onclick: () => {
            c.checks = c.checks.filter((x) => x !== k);
            drawRows();
          } }, "Ballroom is right")));
      return el("tr", {},
        el("td", {}, check),
        el("td", {}, p.name),
        el("td", { class: "num" }, p.trackCount ?? "?"),
        el("td", { class: c.ambiguous.length || c.checks.length ? "guess" : null }, dances, questions, flags),
        el("td", {}, tags));
    }));
  };
  search.addEventListener("input", () => { state.playlistSearch = search.value; drawRows(); });
  const setAll = (fn) => {
    for (const p of state.playlists) state.choices.get(p.id).selected = fn(state.choices.get(p.id));
    drawRows();
    updateCount();
  };
  drawRows();
  updateCount();

  fill(box,
    el("p", { class: "help" },
      `${state.playlists.length} playlists can be read.` +
        (state.hiddenCount ? ` ${state.hiddenCount} playlists you follow are hidden; to import one, copy its songs into a playlist of your own.` : "")),
    el("ul", { class: "help" },
      el("li", {}, "Each playlist's dance is guessed from its name. Check it, and add more dances if a playlist fits several."),
      el("li", {}, "Ballroom dances are named by style: Smooth or Rhythm (American), Standard or Latin (International). " +
        "Typing “American Rumba” or “Intl Cha Cha” is converted for you."),
      el("li", {}, "Tags are optional; a tag here goes on every song in that playlist.")),
    el("div", { class: "inline-fields" }, search,
      el("button", { type: "button", class: "small", onclick: () => setAll((c) => c.dances.length > 0) }, "Select all with a dance"),
      el("button", { type: "button", class: "small", onclick: () => setAll(() => false) }, "Select none"),
      el("button", { type: "button", class: "small", onclick: loadPlaylists }, "Reload playlists"),
      defineDanceButton()),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Import?", "Playlist", "Songs", "Dance(s)", "Tags"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: runImport }, "Import selected playlists"),
      count));
}

/* ----------------------------------------------------------------- import */

async function runImport() {
  const chosen = state.playlists.filter((p) => state.choices.get(p.id).selected);
  if (!chosen.length) return alert("Select at least one playlist.");
  const unanswered = chosen.filter((p) => state.choices.get(p.id).ambiguous.length);
  if (unanswered.length && !confirm(
    `These playlists still have a style question (e.g. which Rumba):\n${unanswered.map((p) => "• " + p.name).join("\n")}\n\n` +
      "The unanswered dance will not be added. Continue?")) return;
  const unchecked = chosen.filter((p) => state.choices.get(p.id).checks.length);
  if (unchecked.length && !confirm(
    `These playlists have a guess you have not confirmed:\n` +
      unchecked.map((p) => `• ${p.name}: ${state.choices.get(p.id).checks.map((k) => k.message).join(" ")}`).join("\n") +
      "\n\nImport them with the guess as it stands?")) return;
  const noDance = chosen.filter((p) => !state.choices.get(p.id).dances.length);
  if (noDance.length && !confirm(
    `These playlists have no dance set:\n${noDance.map((p) => "• " + p.name).join("\n")}\n\n` +
      "Their songs only get tags. Songs that end up with no dance at all are flagged in the review. Continue?")) return;

  const imports = [];
  const failures = [];
  for (const [i, p] of chosen.entries()) {
    fill($("review"), el("p", { class: "muted" }, `Reading “${p.name}” (${i + 1} of ${chosen.length})…`));
    try {
      const songs = await getPlaylistTracks(p.id);
      const c = state.choices.get(p.id);
      imports.push({ playlistName: p.name, dances: [...c.dances], tags: [...c.tags], songs });
    } catch (err) {
      failures.push(`${p.name}: ${err.message}`);
    }
  }
  state.imports = imports;
  state.failures = failures;
  computeRows();
}

/** (Re)build the review rows from the imported playlists and the current tag rules. */
function computeRows() {
  // Imported songs come with Spotify's details: remember them (temporarily) for this page and the
  // generator; a library song whose details were unknown gets them from the import.
  rememberDetails([...(state.imports || []).flatMap((p) => p.songs), ...state.manual.map((m) => m.song)]);
  const merged = markPreviouslyRemoved(
    mergeImport(state.existing.map((s) => (s.unknown ? freshDetails(s) : s)), [...(state.imports || []), ...manualImports()], { tagRules: loadRules() }), state.blacklist);
  // Every other blacklisted song gets a (hidden unless filtered) row too, so it can be restored.
  state.rows = [...merged, ...blacklistRows(merged, state.blacklist).map((r) => ({ ...r, song: freshDetails(r.song) }))];
  state.filter = "all";
  updateGroups();
  state.flagged = { duplicates: new Set(groups.duplicates.keys()), versions: new Set(groups.versions.keys()) };
  renderReview();
}

/* -------------------------------------------------- 4a. Songs one by one */

/** Ticked worklist songs, as one-song "imports" for mergeImport. */
function manualImports() {
  return state.manual
    .filter((m) => m.include)
    .map((m) => ({ playlistName: m.source, dances: [...m.dances], tags: [...m.tags], songs: [m.song] }));
}

const libraryEntry = (id) => state.existing.find((s) => s.id === id) ?? null;

/** What the library says about a song: its dances, "removed on <date>" if removed before, else `fallback`. */
function libraryStatus(id, fallback) {
  const lib = libraryEntry(id);
  if (lib) return lib.dances.join(", ") || "(no dance)";
  const gone = state.blacklist.get(id);
  if (gone) return `removed from the library${gone.removed ? ` on ${gone.removed}` : ""}`;
  return fallback;
}

/** Add songs to the worklist (skipping ones already on it). Returns how many were new. */
function addToWorklist(songs, source, include) {
  const onList = new Set(state.manual.map((m) => m.song.id));
  let added = 0;
  for (const song of songs) {
    if (onList.has(song.id)) continue;
    onList.add(song.id);
    state.manual.push({ song, include, dances: [], tags: [], source });
    added++;
  }
  return added;
}

function renderManual(message) {
  const box = $("manual");
  if (!isLoggedIn()) return fill(box, el("p", { class: "muted" }, "Log in first (step 1)."));
  const status = el("p", { class: "muted" }, message || "");

  /* --- single songs: paste links --- */
  const links = el("textarea", { rows: 3, placeholder: "https://open.spotify.com/track/…  (one per line)", "aria-label": "Spotify song links",
    style: "width:100%" });
  const addLinks = async () => {
    const lines = links.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const bad = lines.filter((l) => !spotifyTrackId(l));
    const ids = [...new Set(lines.map(spotifyTrackId).filter(Boolean))];
    const songs = [];
    const failed = [];
    for (const [i, id] of ids.entries()) {
      status.textContent = `Looking up song ${i + 1} of ${ids.length}…`;
      try {
        songs.push(await getTrack(id));
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
      }
    }
    const added = addToWorklist(songs, "Added by hand", true);
    links.value = bad.join("\n");
    renderManual([
      `${added} song(s) added to the worklist below.`,
      bad.length ? `${bad.length} line(s) are not Spotify song links and were left in the box.` : "",
      failed.length ? `Could not look up: ${failed.join("; ")}` : "",
    ].filter(Boolean).join(" "));
  };

  /* --- single songs: search --- */
  const query = el("input", { type: "text", value: state.spotifySearch.query, placeholder: "title and/or artist", "aria-label": "Search Spotify", style: "flex:1 1 16em" });
  const runSearch = async (offset = 0) => {
    state.spotifySearch.query = query.value.trim();
    if (!state.spotifySearch.query) return;
    status.textContent = "Searching…";
    try {
      const res = await searchTracks(state.spotifySearch.query, offset);
      state.spotifySearch.results = offset ? [...state.spotifySearch.results, ...res.songs] : res.songs;
      state.spotifySearch.total = res.total;
      state.spotifySearch.nextOffset = res.nextOffset;
      renderManual();
    } catch (err) {
      status.textContent = err.message;
    }
  };
  query.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), runSearch(0)));
  const onList = new Set(state.manual.map((m) => m.song.id));
  const searchResults = state.spotifySearch.results.length > 0 &&
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["", "Title", "Artist", "Album", "Length", "In library"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, state.spotifySearch.results.map((s) => {
          return el("tr", {},
            el("td", {}, onList.has(s.id)
              ? el("span", { class: "muted" }, "on list")
              : el("button", { type: "button", class: "small", onclick: () => { addToWorklist([s], "Added by hand", true); renderManual(); } }, "Add")),
            el("td", {}, s.title), el("td", {}, s.artist), el("td", {}, s.album),
            el("td", { class: "num" }, formatTime(s.lengthSec)),
            el("td", { class: "muted" }, libraryStatus(s.id, "")));
        }))),
      el("p", { class: "muted" }, `Showing ${state.spotifySearch.results.length} of ${state.spotifySearch.total}. `,
        state.spotifySearch.nextOffset != null && el("button", { type: "button", class: "small", onclick: () => runSearch(state.spotifySearch.nextOffset) }, "More results")));

  /* --- one playlist, song by song --- */
  const choose = el("select", { "aria-label": "Playlist to go through" },
    el("option", { value: "" }, state.playlists ? "Choose one of your playlists…" : "(load your playlists first)"),
    (state.playlists || []).map((p) => el("option", { value: p.id }, `${p.name} (${p.trackCount ?? "?"} songs)`)));
  const linkBox = el("input", { type: "text", placeholder: "…or paste a playlist link", "aria-label": "Playlist link", style: "flex:1 1 16em" });
  const loadOne = async () => {
    const id = choose.value || playlistIdFrom(linkBox.value);
    if (!id) return alert("Choose a playlist or paste a playlist link.");
    const known = (state.playlists || []).find((p) => p.id === id);
    const name = known ? known.name : "Pasted playlist";
    status.textContent = `Reading “${name}”…`;
    try {
      const songs = await getPlaylistTracks(id, (n, total) => (status.textContent = `Reading “${name}”… ${n} of ${total}`));
      const added = addToWorklist(songs, `${name} (song by song)`, false);
      renderManual(`${added} song(s) from “${name}” added to the worklist, unticked. Give each one its dance(s); typing a dance ticks the song.`);
    } catch (err) {
      renderManual(err.status === 403
        ? "Spotify refused (403): apps can only read playlists you own or collaborate on. Copy the songs into a playlist of your own first."
        : err.message);
    }
  };

  fill(box,
    el("div", { class: "attribution" }, spotifyCredit()),
    el("p", { class: "help" },
      "For songs that are not in a single-dance playlist. A song's dance cannot be guessed from the song alone, so you choose it here. " +
        "Added songs go into the worklist below; ticked songs are added to the review (step 5)."),
    el("h3", {}, "Single songs"),
    el("div", {}, el("div", { class: "label" }, "Paste Spotify song links (Share → Copy song link):"), links,
      el("div", { class: "actions" }, el("button", { type: "button", onclick: addLinks }, "Add these songs"))),
    el("div", { class: "inline-fields" }, "Or search Spotify:", query,
      el("button", { type: "button", onclick: () => runSearch(0) }, "Search")),
    searchResults,
    el("h3", {}, "One playlist, song by song"),
    el("div", { class: "inline-fields" }, choose, linkBox,
      el("button", { type: "button", onclick: loadOne }, "Load its songs"),
      !state.playlists && el("button", { type: "button", class: "small", onclick: loadPlaylists }, "Load my playlists")),
    status,
    el("h3", {}, `Worklist (${state.manual.length} song${state.manual.length === 1 ? "" : "s"})`),
    renderWorklist());
}

function renderWorklist() {
  if (!state.manual.length) return el("p", { class: "muted" }, "Empty. Add songs above.");
  const tbody = el("tbody");
  const count = el("span", { class: "muted" });
  const updateCount = () => {
    const ticked = state.manual.filter((m) => m.include);
    const noDance = ticked.filter((m) => !m.dances.length && !(libraryEntry(m.song.id) || { dances: [] }).dances.length);
    count.textContent = `${ticked.length} ticked` + (noDance.length ? `, ${noDance.length} of them without a dance` : "");
  };
  const visible = () => state.manual.filter((m) => !(state.manualHideKnown && libraryEntry(m.song.id)));
  const drawRows = () => {
    fill(tbody, visible().map((m) => {
      const tick = el("input", { type: "checkbox", checked: m.include, "aria-label": `Include ${m.song.title}`,
        onchange: () => { m.include = tick.checked; updateCount(); } });
      const dances = danceChips(m.dances, `Dances for ${m.song.title}`, () => {
        // Giving a song a dance ticks it.
        if (m.dances.length && !m.include) (m.include = true), (tick.checked = true);
        updateCount();
      });
      const tags = tagChips(m.tags, `Tags for ${m.song.title}`);
      return el("tr", {},
        el("td", {}, tick),
        el("td", {}, m.song.title),
        el("td", {}, m.song.artist),
        el("td", { class: "num" }, formatTime(m.song.lengthSec)),
        el("td", { class: "muted" }, libraryStatus(m.song.id, "new")),
        el("td", {}, dances),
        el("td", {}, tags),
        el("td", { class: "muted" }, m.source),
        el("td", {}, el("button", { type: "button", class: "icon", title: "Remove from worklist", "aria-label": `Remove ${m.song.title}`,
          onclick: () => { state.manual = state.manual.filter((x) => x !== m); renderManual(); } }, "×")));
    }));
    updateCount();
  };

  // Bulk: add a dance or tag to every ticked song.
  const { wrap: bulkDanceWrap, input: bulkDance } = comboInput({ placeholder: "dance", "aria-label": "Dance to add to ticked songs" },
    knownDances, (v) => (bulkDance.value = v));
  const { wrap: bulkTagWrap, input: bulkTag } = comboInput({ placeholder: "tag", "aria-label": "Tag to add to ticked songs" },
    knownTags, (v) => (bulkTag.value = v));
  const addToTicked = (key, input, normalize) => {
    let values = normalize(input.value);
    if (!values.length) return;
    if (key === "dances") {
      // Only known dances (spelled as in the list).
      const known = knownDances();
      const unknown = values.filter((v) => !known.some((k) => k.toLowerCase() === v.toLowerCase()));
      if (unknown.length) return alert(UNKNOWN_DANCE(unknown[0]));
      values = values.map((v) => known.find((k) => k.toLowerCase() === v.toLowerCase()));
    }
    for (const m of state.manual) if (m.include) for (const v of values) if (!m[key].includes(v)) m[key].push(v);
    input.value = "";
    drawRows();
  };
  const setTicks = (value) => {
    for (const m of visible()) m.include = value;
    drawRows();
  };
  const hide = el("input", { type: "checkbox", checked: state.manualHideKnown,
    onchange: () => { state.manualHideKnown = hide.checked; drawRows(); } });
  drawRows();

  return el("div", {},
    el("div", { class: "inline-fields" },
      el("button", { type: "button", class: "small", onclick: () => setTicks(true) }, "Tick all shown"),
      el("button", { type: "button", class: "small", onclick: () => setTicks(false) }, "Tick none"),
      el("label", { class: "inline-fields" }, hide, "Hide songs already in the library"),
      el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Empty the worklist?")) { state.manual = []; renderManual(); }
      } }, "Empty worklist"),
      defineDanceButton()),
    el("div", { class: "inline-fields" }, "For all ticked songs:",
      bulkDanceWrap, el("button", { type: "button", class: "small", onclick: () => addToTicked("dances", bulkDance, danceList) }, "Add dance"),
      bulkTagWrap, el("button", { type: "button", class: "small", onclick: () => addToTicked("tags", bulkTag, splitList) }, "Add tag")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Include?", "Title", "Artist", "Length", "In library", "Dance(s)", "Tags", "From", ""].map((h) => el("th", { scope: "col" }, h)))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: () => {
        const ticked = state.manual.filter((m) => m.include);
        if (!ticked.length) return alert("Tick at least one song.");
        const noDance = ticked.filter((m) => !m.dances.length && !(libraryEntry(m.song.id) || { dances: [] }).dances.length);
        if (noDance.length && !confirm(`${noDance.length} ticked song(s) have no dance yet. Add them to the review anyway (they will be flagged “No dance”)?`)) return;
        computeRows();
        $("review").scrollIntoView({ behavior: "smooth" });
      } }, "Add ticked songs to the review (step 5)"),
      count));
}

/* ----------------------------------------------------------------- 5. Review */

/* ----------------------------------------------- Spotify's details of the library */
/*
 * Spotify's details (titles, lengths, whether a song can play) are read from the library playlist and
 * kept in this browser only temporarily (js/song-details.js); songs.csv holds only IDs and your data.
 */

const notAvailable = (id) => isUnavailable(id);


/** What to show under a song's title about its details or availability (null = nothing to say). */
function availabilityNote(s) {
  if (isUnavailable(s.id)) return el("div", { class: "swap-warning" }, `Warning: ${unavailableReason(s.id)}. Consider removing it.`);
  if (s.unknown) {
    return el("div", { class: "muted", style: "font-size:0.85em" },
      isLoggedIn() ? "Its details are not known yet: saving puts it in the library playlist, then they are read." : "Log in (step 1) to read its details.");
  }
  return null;
}

/** The "Spotify details" box at the top of step 5. */
function detailsBox() {
  reloadDetails(); // the generator page may have read the details since this page opened
  const inLibrary = state.rows.filter((r) => !r.removedNow && !r.blocked);
  const known = inLibrary.filter((r) => isChecked(r.song.id)).length;
  const bad = inLibrary.filter((r) => isUnavailable(r.song.id)).length;
  const age = detailsAgeDays();
  const { refreshing, error } = state.details;
  return el("div", { class: "subbox" },
    el("div", { class: "subbox-title" }, "Spotify details"),
    el("p", { class: "help" },
      "Titles, lengths and whether songs can play come from Spotify (the library playlist) and are kept in this browser for a while only; " +
        "songs.csv holds just the song IDs and your dances, tags and corrections. " +
        `Details known for ${known} of ${inLibrary.length} songs` + (age !== null ? `, read ${age < 1 ? "today" : `${Math.floor(age)} day(s) ago`}` : "") +
        `; ${bad} cannot be played` + (bad ? " (filter “Not available on Spotify” below; consider removing them)." : ".")),
    error && el("ul", { class: "msgs" }, el("li", { class: "error" }, error)),
    refreshing
      ? el("p", { class: "muted", id: "details-progress" }, `Reading your library from Spotify… ${refreshing.done} of ${refreshing.total} songs`)
      : el("div", { class: "inline-fields" },
          !state.libraryPlaylistId ? el("span", { class: "muted" }, "Saving the library (step 6) creates the library playlist in your Spotify account.")
            : isLoggedIn() ? el("button", { type: "button", class: "small", onclick: () => refreshLibraryDetails() }, "Refresh from Spotify")
              : el("span", { class: "muted" }, "Log in (step 1) to read the details.")));
}

const FILTERS = {
  all: ["All", () => true],
  new: ["New", (r) => r.status === "new"],
  updated: ["Updated", (r) => r.status === "updated"],
  multi: ["In several playlists", (r) => r.sources.length > 1],
  guessed: ["Keyword tags", (r) => r.guessed.tags.length],
  nodance: ["No dance", (r) => !r.song.dances.length],
  unchanged: ["Unchanged", (r) => r.status === "unchanged"],
  unavailable: ["Not available on Spotify", (r) => notAvailable(r.song.id)],
  duplicates: ["Duplicates", (r) => groups.duplicates.has(r.song.id) || state.flagged.duplicates.has(r.song.id)],
  versions: ["Versions", (r) => groups.versions.has(r.song.id) || state.flagged.versions.has(r.song.id)],
  removed: ["Removed", (r) => r.removedNow],
  blocked: ["Removed earlier", (r) => r.blocked || r.reimported],
};

/*
 * Works and duplicates (the agreed spec, NOTES.md v0.2.4; logic in js/works.js), among the songs
 * that stay in the library. Recomputed on every redraw of the review table.
 *   duplicates  song id -> the other songs that are the same recording
 *   versions    song id -> the other songs of the same work
 *   works       work key -> { songs, name }   (every work, one song or more; names: see js/works.js)
 */
let groups = { duplicates: new Map(), versions: new Map(), works: new Map() };
function updateGroups() {
  const kept = (state.rows || []).filter((r) => !r.removedNow && !r.blocked).map((r) => r.song);
  const works = new Map();
  for (const s of kept) {
    const k = workKey(s);
    if (!works.has(k)) works.set(k, { songs: [] });
    works.get(k).songs.push(s);
  }
  for (const w of works.values()) w.name = workName(w.songs);
  groups = { duplicates: sameKeyGroups(kept, recordingKey), versions: sameKeyGroups(kept, workKey), works };
}
/** The name of the work a song belongs to. */
const workNameOf = (s) => (groups.works.get(workKey(s)) || { name: workName([s]) }).name;
const songName = (s) => `“${s.title}”${s.artist ? ` by ${s.artist}` : ""}`;

/** The review table's sortable columns (heading -> the value to sort by). On-screen order only. */
const statusText = (r) =>
  r.removedNow ? "Removed" : r.blocked ? "Removed earlier" : r.reimported ? "Restored" : r.status === "new" ? "New" : r.status === "updated" ? "Updated" : "";
const REVIEW_COLUMNS = {
  "Status": statusText,
  "Title": (r) => r.song.title,
  "Artist": (r) => r.song.artist,
  "Album": (r) => r.song.album,
  "Length": (r) => r.song.lengthSec,
  "Dances": (r) => r.song.dances.join(", "),
  "Tags": (r) => r.song.tags.join(", "),
  "Work": (r) => workNameOf(r.song),
  "From playlist(s)": (r) => r.sources.join(", "),
};

/** Blacklisted songs only show under "Removed earlier" (until restored); every other filter hides them. */
const shownIn = (key, r) => (key === "blocked" || !r.fromBlacklist || r.reimported) && FILTERS[key][1](r);

function renderReview() {
  const rows = state.rows;
  if (!rows || !rows.length) {
    fill($("review"), el("p", { class: "muted" }, "The library is empty. Import playlists in step 4 or add songs in step 4a."));
    renderOutput();
    return;
  }
  updateGroups();
  const tbody = el("tbody");
  const search = el("input", { type: "text", placeholder: "search title / artist…", value: state.search, "aria-label": "Search songs" });
  const grouping = { duplicates: { key: "group", dir: 1 }, versions: { key: "group", dir: 1 } }[state.filter];
  const groupKey = state.filter === "duplicates" ? (r) => recordingKey(r.song) : (r) => workKey(r.song);
  const drawRows = () => {
    const q = state.search.toLowerCase();
    const matching = rows.filter((r) => shownIn(state.filter, r) && `${r.song.title} ${r.song.artist}`.toLowerCase().includes(q));
    const shown = state.reviewSort && state.reviewSort.key ? sortRows(matching, state.reviewSort, REVIEW_COLUMNS)
      : grouping ? sortRows(matching, grouping, { group: groupKey }) : matching;
    // Only the rows on screen are built (every change redraws them), so long libraries stay quick.
    const more = shown.length - state.reviewLimit;
    fill(tbody, shown.slice(0, state.reviewLimit).map(reviewRow),
      more > 0 && el("tr", {}, el("td", { colspan: 10, class: "muted" },
        `Showing ${state.reviewLimit} of ${shown.length} songs. `,
        el("button", { type: "button", class: "small", onclick: () => { state.reviewLimit += REVIEW_PAGE; drawRows(); } }, `Show ${Math.min(REVIEW_PAGE, more)} more`),
        " ",
        el("button", { type: "button", class: "small", onclick: () => { state.reviewLimit = shown.length; drawRows(); } }, "Show all"),
        " (or narrow it down with a filter or the search)")));
  };
  search.addEventListener("input", () => { state.search = search.value; state.reviewLimit = REVIEW_PAGE; drawRows(); });

  const filterButtons = Object.entries(FILTERS).map(([key, [label]]) =>
    el("button", { type: "button", class: key === state.filter ? "small primary" : "small", onclick: () => { state.filter = key; state.reviewLimit = REVIEW_PAGE; renderReview(); } },
      `${label} (${rows.filter((r) => shownIn(key, r)).length})`));
  drawRows();

  fill($("review"),
    state.failures.length > 0 && el("ul", { class: "msgs" }, state.failures.map((f) => el("li", { class: "error" }, f))),
    el("p", { class: "help" }, "Your whole library is listed here, plus anything imported. Use × to take a dance or tag off a song, " +
      "and the dropdown to add one. Highlighted tags came from keyword rules, so check them. " +
      "Remove takes a song out of the library; the app remembers it, so a later import will not quietly bring it back. " +
      "Duplicates are the same recording under another Spotify ID; Versions are other recordings of the same song (by title). " +
      "Fix wrong matches with the Work box or the duplicate buttons; ▶ plays a song in a player at the bottom of the page. " +
      "Click a column heading to sort the table by it (click again to reverse)."),
    detailsBox(),
    el("div", { class: "attribution" }, spotifyCredit()),
    el("div", { class: "inline-fields" }, ...filterButtons, search),
    el("div", { class: "actions" },
      (state.imports || state.manual.length > 0) && el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Re-apply the tag rules from step 3? Edits you made in this table will be lost.")) computeRows();
      } }, "Re-apply tag rules"),
      // For long libraries: jump past the table and back.
      el("button", { type: "button", class: "small jump", onclick: () => jump("review-bottom") }, "Jump to bottom ↓")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {},
          Object.keys(REVIEW_COLUMNS).map((label) => sortHeader(label, label, state.reviewSort, (sort) => {
            state.reviewSort = sort;
            renderReview();
          })),
          el("th", { scope: "col" }))),
        tbody)),
    el("div", { id: "review-bottom", class: "actions" },
      el("button", { type: "button", class: "small jump", onclick: () => jump("review") }, "Jump to top ↑")));
  renderOutput();
}

/** Scroll smoothly to an element of the page (by id), leaving a little space above it. */
function jump(id) {
  const target = $(id);
  if (!target) return;
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" });
}

/** Put a blacklisted song back into the library, as it was (it comes off the blacklist when saved). */
async function restoreFromBlacklist(r) {
  r.blocked = false;
  r.reimported = true;
  renderReview();
  if (r.song.unknown && isLoggedIn()) {
    try {
      const sg = await getTrack(r.song.id);
      rememberDetails([sg]);
      r.song = freshDetails(r.song);
      renderReview();
    } catch {
      /* stays "Unknown song" until the next refresh */
    }
  }
}

function reviewRow(r) {
  const s = r.song;
  const button = (cls, label, title, onclick) => el("button", { type: "button", class: cls, title, "aria-label": title, onclick: () => { onclick(); renderReview(); } }, label);

  // Taken out of the library in this session: small and faded, can be restored.
  if (r.removedNow) {
    return el("tr", { class: "removed" },
      el("td", {}, "Removed"),
      el("td", {}, previewButton(s), " ", el("s", {}, s.title)),
      el("td", {}, s.artist),
      el("td", {}, s.album || ""),
      el("td", { class: "num" }, formatTime(s.lengthSec)),
      el("td", {}, s.dances.join(", ")),
      el("td", {}, s.tags.join(", ")),
      el("td", { class: "muted" }, workNameOf(s)),
      el("td", { class: "muted" }, r.sources.join(", ")),
      el("td", {}, button("small undo", "Restore", `Keep ${s.title} in the library`, () => (r.removedNow = false))));
  }
  // An import of a song that was removed before: left out unless re-imported.
  if (r.blocked) {
    const when = r.removedEntry && r.removedEntry.removed ? ` on ${r.removedEntry.removed}` : "";
    return el("tr", { class: "removed blocked" },
      el("td", {}, r.fromBlacklist ? "Removed earlier" : "Removed before"),
      el("td", {}, previewButton(s), " ", s.title,
        r.fromBlacklist
          ? el("div", { class: "muted", style: "font-size:0.85em" }, `Removed from the library${when}.`)
          : el("div", { class: "swap-warning" }, `Warning: you removed this song from the library${when}. It is left out unless you re-import it.`)),
      el("td", {}, s.artist),
      el("td", {}, s.album || ""),
      el("td", { class: "num" }, s.lengthSec ? formatTime(s.lengthSec) : ""),
      el("td", {}, s.dances.join(", ")),
      el("td", {}, s.tags.join(", ")),
      el("td", { class: "muted" }, workNameOf(s)),
      el("td", { class: "muted" }, r.sources.join(", ")),
      el("td", {}, r.fromBlacklist
        ? button("small", "Restore", `Put ${s.title} back into the library`, () => restoreFromBlacklist(r))
        : button("small", "Re-import", `Bring ${s.title} back into the library`, () => {
            r.blocked = false;
            r.reimported = true;
          })));
  }

  let row = null;
  const edited = () => {
    row.className = s.dances.length ? "" : "nodance";
    renderOutput();
  };
  const cell = (editor, guessed) =>
    el("td", { class: guessed.length ? "guess" : null },
      editor,
      guessed.length > 0 && el("small", { class: "muted", style: "display:block" }, `from keywords: ${guessed.join(", ")}`));
  row = el("tr", { class: !s.dances.length ? "nodance" : null },
    el("td", {}, r.reimported ? (r.fromBlacklist ? "Restored" : "Re-imported")
      : r.status === "new" ? "New" : r.status === "updated" ? `+ ${[...r.added.dances, ...r.added.tags].join(", ")}` : ""),
    el("td", {}, previewButton(s), " ", !s.unknown && spotifyListenLink(spotifyLink(s.id), s.title), s.title, availabilityNote(s), sameSongNotes(s)),
    el("td", {}, s.artist),
    el("td", {}, s.album || ""),
    el("td", { class: "num" }, formatTime(s.lengthSec)),
    cell(danceChips(s.dances, `Dances for ${s.title}`, edited), []),
    cell(tagChips(s.tags, `Tags for ${s.title}`, edited), r.guessed.tags),
    el("td", {}, workEditor(s)),
    el("td", { class: "muted" }, r.sources.join(", ")),
    el("td", {}, r.reimported
      ? button("small undo", r.fromBlacklist ? "Undo restore" : "Undo re-import", `Leave ${s.title} out again`, () => {
          r.reimported = false;
          r.blocked = true;
        })
      : button("small", "Remove", `Take ${s.title} out of the library`, () => (r.removedNow = true))));
  return row;
}

/*
 * Song preview: one Spotify embedded player docked at the bottom of the page (no login code, and it
 * does not count toward the Spotify request limit). The whole song plays if this browser is logged
 * in to Spotify (Premium); otherwise Spotify plays a short preview.
 */
let previewing = null; // the song in the player
function previewButton(s) {
  const id = spotifyTrackId(s.id);
  if (!id) return null;
  const playing = previewing && previewing.id === s.id;
  return el("button", {
    type: "button", class: playing ? "small primary preview-button" : "small preview-button",
    title: `Listen to ${s.title}`, "aria-label": `Listen to ${s.title}`,
    onclick: () => showPreview(s),
  }, playing ? "▶ playing" : "▶");
}
function showPreview(s) {
  previewing = s;
  let dock = $("preview-dock");
  if (!dock) {
    dock = el("div", { id: "preview-dock", class: "preview-dock", role: "region", "aria-label": "Song preview" });
    document.body.append(dock);
  }
  fill(dock,
    el("div", { class: "preview-head" },
      el("span", {}, el("span", { class: "muted" }, "Song preview: "), el("strong", {}, s.title), s.artist ? ` — ${s.artist}` : ""),
      el("button", { type: "button", class: "small", onclick: closePreview }, "Close")),
    el("iframe", {
      src: `https://open.spotify.com/embed/track/${spotifyTrackId(s.id)}`,
      width: "100%", height: "80", loading: "lazy", title: `Spotify player: ${s.title}`,
      allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      style: "border:0;border-radius:12px",
    }));
  document.body.classList.add("previewing");
  renderReview();
}
function closePreview() {
  previewing = null;
  const dock = $("preview-dock");
  if (dock) dock.remove();
  document.body.classList.remove("previewing");
  renderReview();
}

/** Notes under a song's title: duplicates and versions, with the buttons to correct them. */
function sameSongNotes(s) {
  const small = (cls, label, title, onclick) =>
    el("button", { type: "button", class: `small ${cls}`.trim(), title, "aria-label": title, onclick: () => { onclick(); renderReview(); } }, label);
  const dups = groups.duplicates.get(s.id) || [];
  const versions = (groups.versions.get(s.id) || []).filter((x) => !dups.includes(x));
  const out = [];
  if (s.recording) {
    // A hand-made correction: say what it is, with its undo.
    const joined = (state.rows || []).map((r) => r.song).find((x) => x !== s && recordingKey(x) === s.recording && !x.recording);
    out.push(el("div", { class: "muted", style: "font-size:0.85em" },
      s.recording === ownRecordingKey(s) ? "Marked as not a duplicate. " : `Marked as the same recording as ${joined ? songName(joined) : "another song"}. `,
      small("undo", "Undo", `Undo the duplicate correction for ${s.title}`, () => delete s.recording)));
  }
  if (dups.length) {
    out.push(el("div", { class: "swap-warning" }, `Same recording as ${dups.slice(0, 3).map(songName).join(", ")}${dups.length > 3 ? " …" : ""}. `,
      s.recording !== ownRecordingKey(s) && small("", "Not a duplicate", `${s.title} is not the same recording`, () => (s.recording = ownRecordingKey(s)))));
  }
  if (versions.length) {
    out.push(el("div", { class: "muted", style: "font-size:0.85em" },
      `Another version: ${versions.slice(0, 3).map(songName).join(", ")}${versions.length > 3 ? " …" : ""}.`));
  } else if (!groups.versions.has(s.id) && state.flagged.versions.has(s.id)) {
    out.push(el("div", { class: "muted", style: "font-size:0.85em" }, "No other versions now (flagged when the review started)."));
  }
  if (!dups.length && !s.recording && state.flagged.duplicates.has(s.id)) {
    out.push(el("div", { class: "muted", style: "font-size:0.85em" }, "No duplicates now (flagged when the review started)."));
  }
  // "Same recording as…": pick another library song (for duplicates the ISRC misses).
  if (!s.recording) {
    if (state.pickingRecording === s.id) {
      const others = (state.rows || []).filter((r) => r.song !== s && !r.removedNow && !r.blocked).map((r) => r.song);
      const label = (x) => `${x.title} — ${x.artist || "?"}${x.album ? ` (${x.album})` : ""}`;
      const byLabel = new Map(others.map((x) => [label(x), x]));
      const combo = comboInput({ placeholder: "type a title…", "aria-label": `Same recording as (for ${s.title})` }, () => [...byLabel.keys()], (v) => {
        const target = byLabel.get(v);
        if (!target) return;
        s.recording = recordingKey(target);
        state.pickingRecording = null;
        renderReview();
      });
      out.push(el("div", { class: "inline-fields" }, "Same recording as:", combo.wrap,
        small("undo", "Cancel", "Cancel", () => (state.pickingRecording = null))));
      setTimeout(() => combo.input.focus(), 0);
    } else {
      out.push(el("div", {}, small("", "Same recording as…", `Mark ${s.title} as the same recording as another song`,
        () => (state.pickingRecording = s.id))));
    }
  }
  return out;
}

/**
 * The Work box: empty = the work worked out from the title (its name is shown in grey). Picking a
 * work's name from the list joins that work; typing a new name makes a work of its own.
 * "Rename work…" gives the whole work (all its songs) a new name.
 */
function workEditor(s) {
  const list = s.work ? [s.work] : [];
  const others = () => [...groups.works.values()].filter((w) => !w.songs.includes(s));
  const editor = chipEditor(list, () => others().map((w) => w.name).sort(), {
    placeholder: `auto: ${workNameOf(s)}`,
    label: `Work for ${s.title}`,
    // A work's name (as listed) becomes the text that joins it.
    normalize: (v) => {
      const w = others().find((x) => x.name === v);
      return w ? joinValue(w.songs) : v;
    },
    onChange: () => {
      // One work per song: the newest entry wins; none = back to the title's work.
      const v = list[list.length - 1];
      if (v && plainText(v) && plainText(v) !== workFromTitle(s.title)) s.work = v;
      else delete s.work;
      renderReview();
    },
  });
  const work = groups.works.get(workKey(s));
  const rename = work && work.songs.length > 1 && el("button", {
    type: "button", class: "small", title: `Rename the work ${work.name}`, "aria-label": `Rename the work ${work.name}`,
    onclick: () => {
      const name = (prompt(`New name for this work (all ${work.songs.length} songs):`, work.name) || "").trim();
      if (!name || !plainText(name) || name === work.name) return;
      for (const x of work.songs) x.work = name;
      renderReview();
    },
  }, "Rename work…");
  return el("div", {}, editor, rename);
}

/* ------------------------------------------------------------------- 6. Save */

/*
 * Saving: the library always lives in two files in the project's data folder, songs.csv and
 * removed-songs.csv (the songs you took out; may be empty). Both are always saved together, and the
 * generator only ever reads data/songs.csv, so unsaved changes here are lost on leaving.
 */

/** The files' contents for the library as it is on this page now (IDs and your own data only). */
function currentFiles() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    songs: songsToCSV(keptSongs(state.rows || [])),
    removed: removedSongsToCSV(updatedBlacklist(state.blacklist, state.rows || [], today)),
    info: libraryInfoText({ playlistId: state.libraryPlaylistId }),
  };
}
const filesKey = (f) => `${f.songs}\u0000${f.removed}`;

/**
 * Bring the library playlist in step with the library (creating it the first time): add the songs it
 * lacks, remove the ones no longer in the library. Returns a message about what happened.
 */
async function syncLibraryPlaylist(report) {
  const ids = keptSongs(state.rows || []).map((s) => s.id);
  if (!state.libraryPlaylistId) {
    report("Creating the library playlist in your Spotify account…");
    const p = await createPlaylist({ name: LIBRARY_PLAYLIST_NAME, description: LIBRARY_PLAYLIST_DESCRIPTION, isPublic: false });
    state.libraryPlaylistId = p.id;
  }
  report("Reading the library playlist…");
  let current;
  try {
    current = await getPlaylistTrackIds(state.libraryPlaylistId);
  } catch (err) {
    // Gone from Spotify (or no longer yours): make a new one, after asking. Nothing of yours is lost.
    if (err.status !== 404 && err.status !== 403) throw err;
    if (!confirm(`The library playlist could not be found in your Spotify account (it may have been deleted).\n\nCreate a new private “${LIBRARY_PLAYLIST_NAME}” with all your songs?`)) {
      throw new Error("the library playlist was not found, and no new one was made");
    }
    report("Creating a new library playlist in your Spotify account…");
    const p = await createPlaylist({ name: LIBRARY_PLAYLIST_NAME, description: LIBRARY_PLAYLIST_DESCRIPTION, isPublic: false });
    state.libraryPlaylistId = p.id;
    current = [];
  }
  const inPlaylist = new Set(current);
  const wanted = new Set(ids);
  const add = ids.filter((id) => !inPlaylist.has(id));
  const remove = [...inPlaylist].filter((id) => !wanted.has(id));
  if (add.length) await addTracksToPlaylist(state.libraryPlaylistId, add, (n, total) => report(`Adding songs to the library playlist… ${n} of ${total}`));
  if (remove.length) await removeTracksFromPlaylist(state.libraryPlaylistId, remove, (n, total) => report(`Removing songs from the library playlist… ${n} of ${total}`));
  return `The library playlist on Spotify is up to date (${add.length} added, ${remove.length} removed).`;
}

/** The first save creates the library playlist: the user agrees to that first. */
function agreeToLibraryPlaylist() {
  if (state.libraryPlaylistId) return true;
  return confirm(
    `Saving creates a private playlist in your Spotify account:\n\n“${LIBRARY_PLAYLIST_NAME}”\n\n` +
      `It holds all ${keptSongs(state.rows || []).length} songs of your library, and the generator reads their titles and lengths from it. ` +
      "It is private (not on your profile), and every save brings it in step with the library (songs added or removed).\n\n" +
      "Create it and save?");
}

/** Before saving: the library playlist (needs a login). Returns { ok, message }. */
async function syncBeforeSaving(report) {
  if (!isLoggedIn()) return { ok: false, message: "Not logged in to Spotify, so the library playlist was not updated: log in (step 1) and save again." };
  try {
    return { ok: true, message: await syncLibraryPlaylist(report) };
  } catch (err) {
    const why = err.status === 429 ? "Spotify is limiting requests right now" : err.message;
    return { ok: false, message: `The library playlist could not be updated (${why}); your library was saved anyway. Save again later to finish it.` };
  }
}

/** Has the library on this page changed since it was saved in this browser? */
function looksUnsaved() {
  if (!state.rows) return false;
  return filesKey(currentFiles()) !== state.savedKey;
}

/** "Back to the generator": with a warning if the library on this page is not saved. */
function backToGenerator(event) {
  event.preventDefault();
  if (looksUnsaved() &&
    !confirm("Your changes to the library are not saved. If you go back to the generator now, they will be lost.\n\nLeave without saving?")) {
    $("output").scrollIntoView({ behavior: "smooth" });
    return;
  }
  goToGenerator();
}

function goToGenerator() {
  state.leaving = true; // no second "unsaved changes" warning from the browser
  location.href = "./";
}

function renderOutput() {
  if (!state.userId) return fill($("output"), el("p", { class: "muted" }, "Log in first (step 1)."));
  if (!state.rows || !state.rows.length) return fill($("output"), el("p", { class: "muted" }, "Nothing to save yet."));
  const count = keptSongs(state.rows).length;
  const removedNow = state.rows.filter((r) => r.removedNow).length;
  const blocked = state.rows.filter((r) => r.blocked && !r.fromBlacklist).length;
  const restored = state.rows.filter((r) => r.fromBlacklist && r.reimported).length;
  const noDance = keptSongs(state.rows).filter((s) => !s.dances.length).length;
  const unsaved = looksUnsaved();
  const today = () => new Date().toISOString().slice(0, 10);

  const download = (name, text) => {
    const blob = new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/csv" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const report = (text) => {
    const p = $("save-progress");
    if (p) p.textContent = text;
  };

  /** Save: the library playlist brought in step, then the library kept in this browser. */
  const save = async () => {
    await resolvePlaylistOwner();
    if (!agreeToLibraryPlaylist()) return;
    const sync = await syncBeforeSaving(report);
    try {
      saveUserLibrary(state.userId, {
        rows: keptSongs(state.rows),
        removed: updatedBlacklist(state.blacklist, state.rows, today()),
        playlistId: state.libraryPlaylistId,
      });
    } catch (err) {
      return alert(`The library could not be kept in this browser (${err.message}). Download a backup (below) so nothing is lost.`);
    }
    if (sync.ok) await refreshLibraryDetails(false);
    state.saved = loadUserLibrary(state.userId);
    await useLibrary(state.saved, "Your library (this browser)", []);
    state.saveMessage = `Saved ${count} songs in this browser at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ${sync.message}`;
    state.saveOk = sync.ok;
    renderOutput();
  };

  /** A backup: the three files, as the library is saved. */
  const downloadBackup = () => {
    if (unsaved && !confirm("You have unsaved changes. Download the library as it is on this page (with the changes)?")) return;
    const files = currentFiles();
    download("songs.csv", files.songs);
    download("removed-songs.csv", files.removed);
    download("library.json", files.info);
    if (!unsaved) markDownloaded(state.userId);
    state.saved = loadUserLibrary(state.userId);
    renderOutput();
  };

  // On the computer (Chrome / Edge): publish the saved library as the shared library, into the project's data folder.
  const publish = async (choose) => {
    if (unsaved) return alert("Save the library first (above); then publish it.");
    let folder;
    try {
      folder = await getFolder(DATA_FOLDER_KEY, {
        choose,
        check: async (h) => ((await folderHasFile(h, "default-settings.json")) ? null
          : `The folder “${h.name}” does not look like the project's data folder (it has no default-settings.json).`),
      });
    } catch (err) {
      return alert(`Could not open the folder: ${err.message}`);
    }
    if (!folder) return;
    const files = currentFiles();
    try {
      await writeTextFile(folder, "songs.csv", files.songs);
      await writeTextFile(folder, "removed-songs.csv", files.removed);
      await writeTextFile(folder, "library.json", files.info);
    } catch (err) {
      return alert(`Could not save: ${err.message}`);
    }
    state.dataFolderName = folder.name;
    state.saveMessage = `Published ${count} songs as the shared library in ${folder.name}/ at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` +
      "Commit and push data/ so the online site offers it.";
    state.saveOk = true;
    renderOutput();
  };

  const saved = state.saved;
  fill($("output"),
    el("p", {}, `The library will have ${count} songs.` +
      (removedNow ? ` ${removedNow} removed now.` : "") +
      (blocked ? ` ${blocked} previously removed song(s) from the import left out.` : "") +
      (restored ? ` ${restored} restored from the removed songs.` : "")),
    noDance > 0 && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      `${noDance} song(s) have no dance. They are kept, but the generator skips them until they get one (filter “No dance” above).`)),
    unsaved
      ? el("ul", { class: "msgs" }, el("li", { class: "warning" }, "You have changes that are not saved yet. Unsaved changes are lost when you leave this page."))
      : state.saveMessage && el("ul", { class: "msgs" }, el("li", { class: state.saveOk ? "ok" : "warning" }, state.saveMessage)),
    !unsaved && saved && changedSinceDownload(saved) && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      "Your library has changes that are not in a downloaded backup. Browser storage can be wiped (clearing site data, another browser or computer): download a backup now and then.")),
    el("p", { class: "muted", id: "save-progress", "aria-live": "polite" }),
    el("p", { class: "help" }, "Saving keeps your library in this browser, for your Spotify account: the songs' Spotify IDs, dances, tags, " +
      "corrections and removed songs. It also brings your library playlist on Spotify in step, from which the songs' titles and lengths are read. " +
      "A backup is three files (songs.csv, removed-songs.csv, library.json); load them with “Load library files…” in step 2, e.g. on another computer."),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: save }, "Save"),
      el("button", { type: "button", onclick: downloadBackup }, "Download a backup")),
    RUNNING_LOCALLY && canSaveToFolder() && el("details", {}, el("summary", { class: "muted" }, "Publish as the shared library (site owner)"),
      el("p", { class: "help" }, "Writes your saved library into the project's data folder, as the shared library that new users can start from. " +
        (state.dataFolderName ? `Folder: “${state.dataFolderName}”.` : "The first time, choose the “data” folder inside the project.") +
        " Then commit and push data/."),
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: () => publish(false) }, "Publish to the data folder"),
        state.dataFolderName && el("button", { type: "button", class: "small", onclick: () => publish(true) }, "Choose a different folder…"))));
}

/* -------------------------------------------------------------------- init */

async function init() {
  const result = await handleLoginRedirect();
  if (result.handled && !result.error) return;
  renderSpotify(result.error);
  if (isLoggedIn()) {
    // An account not on the key's list can log in, but Spotify refuses everything: say so.
    const access = await checkAccess();
    state.notAllowed = !access.ok;
    state.userId = access.ok ? access.userId : null;
    if (state.notAllowed) renderSpotify();
  }
  renderRules();
  renderPlaylists();
  renderManual();
  // Both "Back to the generator" buttons check that the library is saved first.
  for (const link of document.querySelectorAll("a.back-to-generator")) link.addEventListener("click", backToGenerator);
  // Closing the tab or leaving another way with unsaved changes: the browser's own warning.
  window.addEventListener("beforeunload", (e) => {
    if (!state.leaving && looksUnsaved()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  state.dataFolderName = await rememberedFolderName(DATA_FOLDER_KEY);
  forgetExpiredDetails(); // Spotify's details are only kept temporarily
  if (state.userId) await loadStart();
  else {
    renderExisting();
    renderOutput();
  }
}

init();
