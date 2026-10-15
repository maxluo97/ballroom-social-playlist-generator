/**
 * library.js — the library builder page (library.html).
 *
 * Flow: log in -> start from data/songs.csv (or another CSV, or nothing) -> set up automatic tags
 * -> choose your own single-dance playlists and confirm each one's dance(s) -> import -> review
 * (edit dances/tags) -> download the merged songs.csv and save it as data/songs.csv.
 * Imports only add to the library; see js/library-merge.js for the exact rules.
 */

import { el, fill, $, chipEditor, comboInput } from "./dom.js";
import {
  login, logout, isLoggedIn, handleLoginRedirect, getMyPlaylists, getPlaylistTracks,
  getTrack, searchTracks, playlistIdFrom,
} from "./spotify.js";
import { spotifyTrackId } from "./data.js";
import { loadSongsFromUrl, parseSongsText, songsToCSV, parseRemovedSongs, removedSongsToCSV } from "./data.js";
import {
  guessDanceInfo, canonicalDance, unknownDanceMessage, DANCE_ALIASES, BALLROOM_STYLES, BALLROOM_DANCE_NAMES,
  setCustomDances, customDanceNames, newDanceProblem,
} from "./dance-names.js";
import {
  mergeImport, parseTagRules, markPreviouslyRemoved, keptSongs, updatedBlacklist, blacklistChanged,
} from "./library-merge.js";
import { LIBRARY_KEY } from "./settings.js";
import { formatTime } from "./generator.js";

const PROJECT_URL = "data/songs.csv";
const REMOVED_URL = "data/removed-songs.csv";
const RULES_KEY = "dpg.tagRules.v2"; // [{ keyword, tag }]
const OLD_RULES_KEY = "dpg.tagRules.v1"; // older text format, migrated once
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
};

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
  fill($("spotify"),
    el("p", {}, isLoggedIn() ? el("strong", {}, "Logged in to Spotify.") : "Not logged in."),
    message && errorBox(message),
    el("div", { class: "actions" },
      isLoggedIn()
        ? el("button", { type: "button", onclick: () => { logout(); renderSpotify(); renderPlaylists(); renderManual(); } }, "Log out")
        : el("button", { type: "button", class: "primary", onclick: () => login() }, "Log in with Spotify")));
}

/* ------------------------------------------------------- 2. Starting library */

async function loadProject() {
  try {
    const { songs, problems } = await loadSongsFromUrl(PROJECT_URL);
    setExisting(songs, "data/songs.csv", problems);
  } catch {
    setExisting([], "", []);
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

/** Songs removed from the library before (data/removed-songs.csv): Map id -> { id, title, artist, removed }. */
async function loadRemoved() {
  try {
    const res = await fetch(REMOVED_URL, { cache: "no-store" });
    state.blacklist = res.ok ? parseRemovedSongs(await res.text()) : new Map();
  } catch {
    state.blacklist = new Map();
  }
}

function renderExisting(problems = []) {
  const file = el("input", { type: "file", accept: ".csv,.json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const { songs, problems } = parseSongsText(await f.text(), f.name);
      setExisting(songs, f.name, problems);
    } catch (err) {
      alert(`Could not read ${f.name}: ${err.message}`);
    }
  });
  fill($("existing"),
    el("p", {}, state.existingName
      ? ["Starting from ", el("strong", {}, state.existingName), `: ${state.existing.length} songs. Imported songs are added to it; nothing in it is removed.`]
      : "No data/songs.csv yet, so the library starts empty."),
    problems.length > 0 && el("ul", { class: "msgs" }, problems.map((p) => el("li", { class: "warning" }, p))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "small", onclick: () => file.click() }, "Start from a different CSV…"),
      el("button", { type: "button", class: "small", onclick: loadProject }, "Reload data/songs.csv"),
      el("button", { type: "button", class: "small", onclick: () => setExisting([], "", []) }, "Start empty"),
      file));
}

/* --------------------------------------------------------- 3. Automatic tags */

function loadRules() {
  const rules = store.get(RULES_KEY, null);
  if (Array.isArray(rules)) return rules;
  const old = store.get(OLD_RULES_KEY, null);
  return old ? parseTagRules(old) : DEFAULT_RULES.map((r) => ({ ...r }));
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
  const merged = mergeImport(state.existing, [...(state.imports || []), ...manualImports()], { tagRules: loadRules() });
  state.rows = markPreviouslyRemoved(merged, state.blacklist);
  state.filter = "all";
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

const FILTERS = {
  all: ["All", () => true],
  new: ["New", (r) => r.status === "new"],
  updated: ["Updated", (r) => r.status === "updated"],
  multi: ["In several playlists", (r) => r.sources.length > 1],
  guessed: ["Keyword tags", (r) => r.guessed.tags.length],
  nodance: ["No dance", (r) => !r.song.dances.length],
  unchanged: ["Unchanged", (r) => r.status === "unchanged"],
  removed: ["Removed", (r) => r.removedNow],
  blocked: ["Removed before", (r) => r.blocked || r.reimported],
};

function renderReview() {
  const rows = state.rows;
  if (!rows || !rows.length) {
    fill($("review"), el("p", { class: "muted" }, "The library is empty. Import playlists in step 4 or add songs in step 4a."));
    renderOutput();
    return;
  }
  const tbody = el("tbody");
  const search = el("input", { type: "text", placeholder: "search title / artist…", value: state.search, "aria-label": "Search songs" });
  const drawRows = () => {
    const q = state.search.toLowerCase();
    const [, test] = FILTERS[state.filter];
    const shown = rows.filter((r) => test(r) && `${r.song.title} ${r.song.artist}`.toLowerCase().includes(q));
    fill(tbody, shown.slice(0, 1000).map(reviewRow),
      shown.length > 1000 && el("tr", {}, el("td", { colspan: 8, class: "muted" }, `…and ${shown.length - 1000} more (use the filter or search).`)));
  };
  search.addEventListener("input", () => { state.search = search.value; drawRows(); });

  const filterButtons = Object.entries(FILTERS).map(([key, [label, test]]) =>
    el("button", { type: "button", class: key === state.filter ? "small primary" : "small", onclick: () => { state.filter = key; renderReview(); } },
      `${label} (${rows.filter(test).length})`));
  drawRows();

  fill($("review"),
    state.failures.length > 0 && el("ul", { class: "msgs" }, state.failures.map((f) => el("li", { class: "error" }, f))),
    el("p", { class: "help" }, "Your whole library is listed here, plus anything imported. Use × to take a dance or tag off a song, " +
      "and the dropdown to add one. Highlighted tags came from keyword rules, so check them. " +
      "Remove takes a song out of the library; the app remembers it, so a later import will not quietly bring it back."),
    el("div", { class: "inline-fields" }, ...filterButtons, search),
    el("div", { class: "actions" },
      (state.imports || state.manual.length > 0) && el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Re-apply the tag rules from step 3? Edits you made in this table will be lost.")) computeRows();
      } }, "Re-apply tag rules"),
      // For long libraries: jump past the table and back.
      el("button", { type: "button", class: "small jump", onclick: () => jump("review-bottom") }, "Jump to bottom ↓")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Status", "Title", "Artist", "Album", "Length", "Dances", "Tags", "From playlist(s)", ""].map((h) => el("th", { scope: "col" }, h)))),
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

function reviewRow(r) {
  const s = r.song;
  const button = (cls, label, title, onclick) => el("button", { type: "button", class: cls, title, "aria-label": title, onclick: () => { onclick(); renderReview(); } }, label);

  // Taken out of the library in this session: small and faded, can be restored.
  if (r.removedNow) {
    return el("tr", { class: "removed" },
      el("td", {}, "Removed"),
      el("td", {}, el("s", {}, s.title)),
      el("td", {}, s.artist),
      el("td", {}, s.album || ""),
      el("td", { class: "num" }, formatTime(s.lengthSec)),
      el("td", {}, s.dances.join(", ")),
      el("td", {}, s.tags.join(", ")),
      el("td", { class: "muted" }, r.sources.join(", ")),
      el("td", {}, button("small undo", "Restore", `Keep ${s.title} in the library`, () => (r.removedNow = false))));
  }
  // An import of a song that was removed before: left out unless re-imported.
  if (r.blocked) {
    return el("tr", { class: "removed blocked" },
      el("td", {}, "Removed before"),
      el("td", {}, s.title,
        el("div", { class: "swap-warning" }, `Warning: you removed this song from the library` +
          (r.removedEntry && r.removedEntry.removed ? ` on ${r.removedEntry.removed}` : "") + ". It is left out unless you re-import it.")),
      el("td", {}, s.artist),
      el("td", {}, s.album || ""),
      el("td", { class: "num" }, formatTime(s.lengthSec)),
      el("td", {}, s.dances.join(", ")),
      el("td", {}, s.tags.join(", ")),
      el("td", { class: "muted" }, r.sources.join(", ")),
      el("td", {}, button("small", "Re-import", `Bring ${s.title} back into the library`, () => {
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
    el("td", {}, r.reimported ? "Re-imported"
      : r.status === "new" ? "New" : r.status === "updated" ? `+ ${[...r.added.dances, ...r.added.tags].join(", ")}` : ""),
    el("td", {}, s.title),
    el("td", {}, s.artist),
    el("td", {}, s.album || ""),
    el("td", { class: "num" }, formatTime(s.lengthSec)),
    cell(danceChips(s.dances, `Dances for ${s.title}`, edited), []),
    cell(tagChips(s.tags, `Tags for ${s.title}`, edited), r.guessed.tags),
    el("td", { class: "muted" }, r.sources.join(", ")),
    el("td", {}, r.reimported
      ? button("small undo", "Undo re-import", `Leave ${s.title} out again`, () => {
          r.reimported = false;
          r.blocked = true;
        })
      : button("small", "Remove", `Take ${s.title} out of the library`, () => (r.removedNow = true))));
  return row;
}

/* ------------------------------------------------------------------- 6. Save */

function renderOutput() {
  if (!state.rows || !state.rows.length) return fill($("output"), el("p", { class: "muted" }, "Nothing to save yet."));
  const songs = () => keptSongs(state.rows);
  const saveFile = (name, text) => {
    const blob = new Blob([text], { type: "text/csv" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const download = () => saveFile("songs.csv", songsToCSV(songs()));
  const today = new Date().toISOString().slice(0, 10);
  const listChanged = blacklistChanged(state.rows);
  const downloadRemoved = () => saveFile("removed-songs.csv", removedSongsToCSV(updatedBlacklist(state.blacklist, state.rows, today)));
  const removedNow = state.rows.filter((r) => r.removedNow).length;
  const blocked = state.rows.filter((r) => r.blocked).length;
  const useNow = () => {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify({ name: "Library builder result (not yet saved as data/songs.csv)", songs: songs().filter((s) => s.dances.length) }));
      location.href = "./";
    } catch (err) {
      alert(`Could not hand the library to the generator: ${err.message}`);
    }
  };
  const noDance = songs().filter((s) => !s.dances.length).length;
  fill($("output"),
    el("p", {}, `The library will have ${songs().length} songs.` +
      (removedNow ? ` ${removedNow} removed now.` : "") +
      (blocked ? ` ${blocked} previously removed song(s) from the import left out.` : "")),
    noDance > 0 && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      `${noDance} song(s) have no dance. They are kept in songs.csv, but the generator skips them until they get one (filter “No dance” above).`)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: download }, "Download songs.csv"),
      listChanged && el("button", { type: "button", class: "primary", onclick: downloadRemoved }, "Download removed-songs.csv"),
      el("button", { type: "button", onclick: useNow }, "Try it in the generator now")),
    el("ol", { class: "help" },
      el("li", {}, "Download songs.csv and save it in the project's data folder, replacing the old one."),
      listChanged && el("li", {}, "Also download removed-songs.csv and save it in the data folder too. " +
        "It is how the app remembers the songs you removed."),
      el("li", {}, "Reload the generator page. If it still shows an older library, press “Use data/songs.csv”.")));
}

/* -------------------------------------------------------------------- init */

async function init() {
  const result = await handleLoginRedirect();
  if (result.handled && !result.error) return;
  renderSpotify(result.error);
  renderRules();
  renderPlaylists();
  renderManual();
  await loadRemoved();
  await loadProject();
}

init();
