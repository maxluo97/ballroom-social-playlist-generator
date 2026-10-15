/**
 * library.js — the library builder page (library.html).
 *
 * Flow: log in -> start from data/songs.csv (or another CSV, or nothing) -> choose your own
 * single-dance playlists and confirm each one's dance(s) -> import -> review (edit dances/tags)
 * -> download the merged songs.csv and save it as data/songs.csv.
 * Imports only add to the library; see js/library-merge.js for the exact rules.
 */

import { el, fill, $ } from "./dom.js";
import { login, logout, isLoggedIn, handleLoginRedirect, getMyPlaylists, getPlaylistTracks } from "./spotify.js";
import { loadSongsFromUrl, parseSongsText, songsToCSV } from "./data.js";
import { guessDances, DANCE_ALIASES } from "./dance-names.js";
import { mergeImport, parseTagRules } from "./library-merge.js";
import { APP_DEFAULTS, LIBRARY_KEY } from "./settings.js";
import { formatTime } from "./generator.js";

const PROJECT_URL = "data/songs.csv";
const RULES_KEY = "dpg.tagRules.v1";
const TITLE_GUESS_KEY = "dpg.guessTitleDances.v1";
const DEFAULT_RULES = `# One rule per line:  keyword => Tag
# The keyword is looked for in song titles and album names (capitals ignored).
soundtrack => Hollywood
motion picture => Hollywood
from the film => Hollywood
from the movie => Hollywood
original score => Hollywood
`;

const state = {
  existing: [],
  existingName: "",
  playlists: null, // readable playlists
  hiddenCount: 0,
  choices: new Map(), // playlist id -> { selected, dances, tags } (dances/tags as "a; b" text)
  playlistSearch: "",
  rows: null, // merge result
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

const splitList = (text) => String(text ?? "").split(/[;|]/).map((x) => x.trim()).filter(Boolean);
const errorBox = (message) => el("ul", { class: "msgs" }, el("li", { class: "error" }, message));

/** Dance names to suggest and to match against: built-in list, the app's defaults, and the library. */
function knownDances() {
  const set = new Set(Object.keys(DANCE_ALIASES));
  for (const a of APP_DEFAULTS.associations) a.dances.forEach((d) => set.add(d));
  for (const s of state.existing) (s.dances || []).forEach((d) => set.add(d));
  return [...set].sort();
}

function updateKnownList() {
  $("dl-known").replaceChildren(...knownDances().map((d) => el("option", { value: d })));
}

/* ---------------------------------------------------------------- 1. Spotify */

function renderSpotify(message) {
  fill($("spotify"),
    el("p", {}, isLoggedIn() ? el("strong", {}, "Logged in to Spotify.") : "Not logged in."),
    message && errorBox(message),
    el("div", { class: "actions" },
      isLoggedIn()
        ? el("button", { type: "button", onclick: () => { logout(); renderSpotify(); renderPlaylists(); } }, "Log out")
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
  state.rows = null;
  updateKnownList();
  renderExisting(problems);
  renderReview();
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

/* ------------------------------------------------------------- 3. Playlists */

async function loadPlaylists() {
  fill($("playlists"), el("p", { class: "muted" }, "Loading your playlists…"));
  try {
    const all = await getMyPlaylists((n, total) => fill($("playlists"), el("p", { class: "muted" }, `Loading your playlists… ${n} of ${total}`)));
    state.playlists = all.filter((p) => p.ownedByMe || p.collaborative);
    state.hiddenCount = all.length - state.playlists.length;
    const known = knownDances();
    for (const p of state.playlists) {
      if (state.choices.has(p.id)) continue;
      const dances = guessDances(p.name, known);
      state.choices.set(p.id, { selected: dances.length > 0, dances: dances.join("; "), tags: "" });
    }
  } catch (err) {
    state.playlists = null;
    fill($("playlists"), errorBox(err.message));
    return;
  }
  renderPlaylists();
}

function renderPlaylists() {
  const box = $("playlists");
  if (!isLoggedIn()) return fill(box, el("p", { class: "muted" }, "Log in first (step 1)."));
  if (!state.playlists) {
    return fill(box,
      el("p", { class: "help" }, "Lists the playlists you own or collaborate on (Spotify does not let apps read anyone else's). " +
        "Each playlist's dance is guessed from its name; check it before importing."),
      el("button", { type: "button", class: "primary", onclick: loadPlaylists }, "Load my playlists"));
  }

  const search = el("input", { type: "text", placeholder: "filter by name…", value: state.playlistSearch, "aria-label": "Filter playlists" });
  const tbody = el("tbody");
  const drawRows = () => {
    const q = state.playlistSearch.toLowerCase();
    fill(tbody, state.playlists.filter((p) => p.name.toLowerCase().includes(q)).map((p) => {
      const c = state.choices.get(p.id);
      const check = el("input", { type: "checkbox", checked: c.selected, "aria-label": `Import ${p.name}`, onchange: () => { c.selected = check.checked; updateCount(); } });
      const dances = el("input", { type: "text", value: c.dances, list: "dl-known", placeholder: "e.g. Waltz", "aria-label": `Dances for ${p.name}`,
        oninput: () => (c.dances = dances.value) });
      const tags = el("input", { type: "text", value: c.tags, placeholder: "optional", "aria-label": `Tags for ${p.name}`,
        oninput: () => (c.tags = tags.value) });
      return el("tr", {},
        el("td", {}, check),
        el("td", {}, p.name),
        el("td", { class: "num" }, p.trackCount ?? "?"),
        el("td", {}, dances),
        el("td", {}, tags));
    }));
  };
  search.addEventListener("input", () => { state.playlistSearch = search.value; drawRows(); });

  const count = el("span", { class: "muted" });
  const updateCount = () => {
    const sel = state.playlists.filter((p) => state.choices.get(p.id).selected);
    const songs = sel.reduce((t, p) => t + (p.trackCount || 0), 0);
    count.textContent = `${sel.length} playlist(s) selected, about ${songs} songs.`;
  };
  const setAll = (fn) => {
    for (const p of state.playlists) state.choices.get(p.id).selected = fn(state.choices.get(p.id));
    drawRows();
    updateCount();
  };
  drawRows();
  updateCount();

  fill(box,
    el("p", { class: "help" },
      `${state.playlists.length} playlists can be read` +
        (state.hiddenCount ? `; ${state.hiddenCount} others you follow are hidden (copy their songs into a playlist of your own to import them).` : ".") +
        " Dances: separate several with “;”. Tags (optional) are added to every song in that playlist."),
    el("div", { class: "inline-fields" }, search,
      el("button", { type: "button", class: "small", onclick: () => setAll((c) => splitList(c.dances).length > 0) }, "Select all with a dance"),
      el("button", { type: "button", class: "small", onclick: () => setAll(() => false) }, "Select none"),
      el("button", { type: "button", class: "small", onclick: loadPlaylists }, "Reload playlists")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Import?", "Playlist", "Songs", "Dance(s)", "Tags"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: runImport }, "Import selected playlists"),
      count));
}

/* ------------------------------------------------------------------ 4. Rules */

function renderRules() {
  const area = el("textarea", { rows: 8, spellcheck: false, style: "width:100%;font-family:ui-monospace,Consolas,monospace", "aria-label": "Tag rules" });
  area.value = store.get(RULES_KEY, DEFAULT_RULES);
  area.addEventListener("input", () => store.set(RULES_KEY, area.value));
  const titleGuess = el("input", { type: "checkbox", checked: store.get(TITLE_GUESS_KEY, true),
    onchange: () => store.set(TITLE_GUESS_KEY, titleGuess.checked) });
  fill($("rules"),
    el("p", { class: "help" }, "Tag rules: when a song's title or album contains the keyword, the tag is suggested. " +
      "Suggestions are highlighted in the review so you can check them."),
    area,
    el("div", { class: "actions" },
      el("button", { type: "button", class: "small", onclick: () => { area.value = DEFAULT_RULES; store.set(RULES_KEY, DEFAULT_RULES); } }, "Restore default rules")),
    el("label", { class: "inline-fields" }, titleGuess,
      "Also suggest extra dances named in song titles (e.g. a song called “… Cha Cha Cha” in a Rumba playlist also gets Cha-cha)"),
    el("p", { class: "help" }, "Changes here apply the next time you press “Import selected playlists”."));
}

/* ----------------------------------------------------------------- import */

async function runImport() {
  const chosen = state.playlists.filter((p) => state.choices.get(p.id).selected);
  if (!chosen.length) return alert("Select at least one playlist.");
  const noDance = chosen.filter((p) => !splitList(state.choices.get(p.id).dances).length);
  if (noDance.length && !confirm(
    `These playlists have no dance set:\n${noDance.map((p) => "• " + p.name).join("\n")}\n\n` +
      "Their songs only get tags (and title guesses). Songs that end up with no dance at all are flagged in the review. Continue?")) return;

  const imports = [];
  const failures = [];
  for (const [i, p] of chosen.entries()) {
    fill($("review"), el("p", { class: "muted" }, `Reading “${p.name}” (${i + 1} of ${chosen.length})…`));
    try {
      const songs = await getPlaylistTracks(p.id);
      const c = state.choices.get(p.id);
      imports.push({ playlistName: p.name, dances: splitList(c.dances), tags: splitList(c.tags), songs });
    } catch (err) {
      failures.push(`${p.name}: ${err.message}`);
    }
  }
  state.rows = mergeImport(state.existing, imports, {
    tagRules: parseTagRules(store.get(RULES_KEY, DEFAULT_RULES)),
    guessTitleDances: store.get(TITLE_GUESS_KEY, true),
    knownDances: knownDances(),
  });
  state.failures = failures;
  state.filter = "all";
  renderReview();
}

/* ----------------------------------------------------------------- 5. Review */

const FILTERS = {
  all: ["All", () => true],
  new: ["New", (r) => r.status === "new"],
  updated: ["Updated", (r) => r.status === "updated"],
  guessed: ["Has suggestions", (r) => r.guessed.dances.length || r.guessed.tags.length],
  nodance: ["No dance", (r) => !r.song.dances.length],
  unchanged: ["Unchanged", (r) => r.status === "unchanged"],
};

function renderReview() {
  const rows = state.rows;
  if (!rows) {
    fill($("review"), el("p", { class: "muted" }, "Import playlists in step 3 to see the result here."));
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
    (state.failures || []).length > 0 && el("ul", { class: "msgs" }, state.failures.map((f) => el("li", { class: "error" }, f))),
    el("p", { class: "help" }, "Edit dances and tags directly in the table (separate several with “;”). " +
      "Highlighted cells contain suggestions from the guessing rules; remove any that are wrong."),
    el("div", { class: "inline-fields" }, ...filterButtons, search),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Status", "Title", "Artist", "Album", "Length", "Dances", "Tags", "From playlist(s)"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)));
  renderOutput();
}

function reviewRow(r) {
  const s = r.song;
  const cell = (key, guessed) => {
    const input = el("input", { type: "text", value: s[key].join("; "), list: key === "dances" ? "dl-known" : null,
      "aria-label": `${key} for ${s.title}`,
      oninput: () => (s[key] = splitList(input.value)) });
    return el("td", { class: guessed.length ? "guess" : null },
      input,
      guessed.length > 0 && el("small", { class: "muted", style: "display:block" }, `suggested: ${guessed.join(", ")}`));
  };
  return el("tr", { class: !s.dances.length ? "nodance" : null },
    el("td", {}, r.status === "new" ? "New" : r.status === "updated" ? `+ ${[...r.added.dances, ...r.added.tags].join(", ")}` : ""),
    el("td", {}, s.title),
    el("td", {}, s.artist),
    el("td", {}, s.album || ""),
    el("td", { class: "num" }, formatTime(s.lengthSec)),
    cell("dances", r.guessed.dances),
    cell("tags", r.guessed.tags),
    el("td", { class: "muted" }, r.sources.join(", ")));
}

/* ------------------------------------------------------------------- 6. Save */

function renderOutput() {
  if (!state.rows) return fill($("output"), el("p", { class: "muted" }, "Nothing to save yet."));
  const songs = () => state.rows.map((r) => r.song);
  const download = () => {
    const blob = new Blob([songsToCSV(songs())], { type: "text/csv" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "songs.csv" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const useNow = () => {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify({ name: "Library builder result (not yet saved as data/songs.csv)", songs: songs().filter((s) => s.dances.length) }));
      location.href = "./";
    } catch (err) {
      alert(`Could not hand the library to the generator: ${err.message}`);
    }
  };
  const noDance = state.rows.filter((r) => !r.song.dances.length).length;
  fill($("output"),
    el("p", {}, `The merged library has ${state.rows.length} songs.`),
    noDance > 0 && el("ul", { class: "msgs" }, el("li", { class: "warning" },
      `${noDance} song(s) have no dance. They are kept in songs.csv, but the generator skips them until they get one (filter “No dance” above).`)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: download }, "Download songs.csv"),
      el("button", { type: "button", onclick: useNow }, "Try it in the generator now")),
    el("ol", { class: "help" },
      el("li", {}, "Download songs.csv and move it into the project's data folder, replacing data/songs.csv if it exists."),
      el("li", {}, "Reload the generator page: it uses data/songs.csv automatically."),
      el("li", {}, "Commit the file when you are happy with it.")));
}

/* -------------------------------------------------------------------- init */

async function init() {
  const result = await handleLoginRedirect();
  if (result.handled && !result.error) return;
  renderSpotify(result.error);
  renderRules();
  renderPlaylists();
  await loadProject();
}

init();
