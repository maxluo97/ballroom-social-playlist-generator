/**
 * library.js — the library builder page (library.html).
 *
 * Flow: log in -> start from data/songs.csv (or another CSV, or nothing) -> set up automatic tags
 * -> choose your own single-dance playlists and confirm each one's dance(s) -> import -> review
 * (edit dances/tags) -> download the merged songs.csv and save it as data/songs.csv.
 * Imports only add to the library; see js/library-merge.js for the exact rules.
 */

import { el, fill, $ } from "./dom.js";
import { login, logout, isLoggedIn, handleLoginRedirect, getMyPlaylists, getPlaylistTracks } from "./spotify.js";
import { loadSongsFromUrl, parseSongsText, songsToCSV } from "./data.js";
import { guessDanceInfo, canonicalDance, DANCE_ALIASES, BALLROOM_STYLES, BALLROOM_DANCE_NAMES } from "./dance-names.js";
import { mergeImport, parseTagRules } from "./library-merge.js";
import { LIBRARY_KEY } from "./settings.js";
import { formatTime } from "./generator.js";

const PROJECT_URL = "data/songs.csv";
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
  // playlist id -> { selected, dances: "a; b", tags: "a; b", ambiguous: [{dance, options}], checks: [guesses to confirm] }
  choices: new Map(),
  playlistSearch: "",
  imports: null, // last imported playlists (kept so tag rules can be re-applied without Spotify)
  failures: [],
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
/** Dances typed by the user, in standard form ("American Rumba" -> "Rhythm Rumba"). */
const danceList = (text) => [...new Set(splitList(text).map(canonicalDance))];
const errorBox = (message) => el("ul", { class: "msgs" }, el("li", { class: "error" }, message));

/** Names already in the library that are not standard ballroom names (e.g. "Salsa", custom ones). */
const libraryDances = () => [...new Set(state.existing.flatMap((s) => s.dances || []))];

/** Dance suggestions: the 19 ballroom names, other known dances, and whatever the library uses. */
function knownDances() {
  const ballroomBases = new Set(Object.values(BALLROOM_STYLES).flatMap((s) => s.dances));
  const set = new Set([...BALLROOM_DANCE_NAMES, ...Object.keys(DANCE_ALIASES).filter((d) => !ballroomBases.has(d)), ...libraryDances()]);
  return [...set].sort();
}

function updateLists() {
  $("dl-known").replaceChildren(...knownDances().map((d) => el("option", { value: d })));
  const tags = [...new Set([...state.existing.flatMap((s) => s.tags || []), ...loadRules().map((r) => r.tag)])].filter(Boolean).sort();
  $("dl-tags").replaceChildren(...tags.map((t) => el("option", { value: t })));
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
  state.imports = null;
  updateLists();
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
      const tag = el("input", { type: "text", value: r.tag, list: "dl-tags", placeholder: "e.g. Hollywood", "aria-label": "Tag to add",
        oninput: () => { r.tag = tag.value.trim(); save(); } });
      return el("tr", {},
        el("td", {}, keyword),
        el("td", {}, tag),
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
    el("p", { class: "help" }, "Capitals are ignored. Tags added by keyword are highlighted in the review (step 5) so you can check them; " +
      "you can also edit any song's tags by hand there or later in songs.csv. After changing rules, use “Re-apply tag rules” in step 5."));
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
      state.choices.set(p.id, { selected: dances.length > 0 && !ambiguous.length, dances: dances.join("; "), tags: "", ambiguous, checks });
    }
  } catch (err) {
    state.playlists = null;
    fill($("playlists"), errorBox(err.message));
    return;
  }
  renderPlaylists();
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
      el("p", { class: "help" }, "Lists the playlists you own or collaborate on (Spotify does not let apps read anyone else's). " +
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
      const dances = el("input", { type: "text", value: c.dances, list: "dl-known", placeholder: "e.g. Standard Waltz", "aria-label": `Dances for ${p.name}`,
        oninput: () => (c.dances = dances.value),
        onchange: () => { c.dances = danceList(dances.value).join("; "); dances.value = c.dances; } });
      const tags = el("input", { type: "text", value: c.tags, list: "dl-tags", placeholder: "optional", "aria-label": `Tags for ${p.name}`,
        oninput: () => (c.tags = tags.value) });
      // A bare "Rumba" could be American (Rhythm) or International (Latin): ask.
      const questions = c.ambiguous.map((a) =>
        el("div", { class: "ask" }, `“${a.dance}”: which style? `,
          a.options.map((opt) => el("button", { type: "button", class: "small", onclick: () => {
            c.dances = danceList(`${c.dances}; ${opt}`).join("; ");
            c.ambiguous = c.ambiguous.filter((x) => x !== a);
            c.selected = true;
            drawRows();
            updateCount();
          } }, `${opt} (${familyOf(opt)})`))));
      // A bare "Tango" is guessed as ballroom Tango, but flagged: it could be Argentine.
      const flags = c.checks.map((k) =>
        el("div", { class: "ask" }, `⚠ ${k.message} `,
          el("button", { type: "button", class: "small", onclick: () => {
            c.dances = danceList([...danceList(c.dances).filter((d) => !k.guessed.includes(d)), k.alternative].join("; ")).join("; ");
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
      `${state.playlists.length} playlists can be read` +
        (state.hiddenCount ? `; ${state.hiddenCount} others you follow are hidden (copy their songs into a playlist of your own to import them).` : ".") +
        " Dances: separate several with “;”. Ballroom dances use the style name: Smooth / Rhythm (American), Standard / Latin (International). " +
        "Names like “American Rumba” or “Intl Cha Cha” are converted automatically. Tags (optional) are added to every song in that playlist."),
    el("div", { class: "inline-fields" }, search,
      el("button", { type: "button", class: "small", onclick: () => setAll((c) => danceList(c.dances).length > 0) }, "Select all with a dance"),
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
  const noDance = chosen.filter((p) => !danceList(state.choices.get(p.id).dances).length);
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
      imports.push({ playlistName: p.name, dances: danceList(c.dances), tags: splitList(c.tags), songs });
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
  state.rows = mergeImport(state.existing, state.imports, { tagRules: loadRules() });
  state.filter = "all";
  renderReview();
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
};

function renderReview() {
  const rows = state.rows;
  if (!rows) {
    fill($("review"), el("p", { class: "muted" }, "Import playlists in step 4 to see the result here."));
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
    el("p", { class: "help" }, "Edit dances and tags directly in the table (separate several with “;”). " +
      "A song in several of the imported playlists gets all of their dances. Highlighted tags came from keyword rules; remove any that are wrong."),
    el("div", { class: "inline-fields" }, ...filterButtons, search),
    state.imports && el("div", { class: "actions" },
      el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Re-apply the tag rules from step 3? Edits you made in this table will be lost.")) computeRows();
      } }, "Re-apply tag rules")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Status", "Title", "Artist", "Album", "Length", "Dances", "Tags", "From playlist(s)"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)));
  renderOutput();
}

function reviewRow(r) {
  const s = r.song;
  const cell = (key, guessed) => {
    const input = el("input", { type: "text", value: s[key].join("; "), list: key === "dances" ? "dl-known" : "dl-tags",
      "aria-label": `${key} for ${s.title}`,
      oninput: () => (s[key] = splitList(input.value)),
      onchange: () => {
        if (key === "dances") {
          s.dances = danceList(input.value);
          input.value = s.dances.join("; ");
        }
        renderOutput();
      } });
    return el("td", { class: guessed.length ? "guess" : null },
      input,
      guessed.length > 0 && el("small", { class: "muted", style: "display:block" }, `from keywords: ${guessed.join(", ")}`));
  };
  return el("tr", { class: !s.dances.length ? "nodance" : null },
    el("td", {}, r.status === "new" ? "New" : r.status === "updated" ? `+ ${[...r.added.dances, ...r.added.tags].join(", ")}` : ""),
    el("td", {}, s.title),
    el("td", {}, s.artist),
    el("td", {}, s.album || ""),
    el("td", { class: "num" }, formatTime(s.lengthSec)),
    cell("dances", []),
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
      el("li", {}, "Reload the generator page and press “Use data/songs.csv” (or it is picked automatically if nothing else was loaded)."),
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
