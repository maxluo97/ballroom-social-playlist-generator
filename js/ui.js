/**
 * ui.js — the settings page and results list.
 *
 * One settings object (state.settings, the exact shape generatePlaylist() takes) is the single
 * source of truth: every control reads from it and writes to it. Controls only rebuild the
 * form when its structure changes (adding/removing a row); typing just updates the object.
 */

import { generatePlaylist, validateSettings, listDances, associationMap, DEFAULT_SETTINGS } from "./generator.js";
import {
  THEME_TEMPLATE, LIBRARY_KEY, clone, loadLastSettings, saveLastSettings,
  loadDefaultSettings, upgradeSettings, parseSettingsFile, settingsFileText,
} from "./settings.js";
import { loadSongsFromUrl, parseSongsText, playlistToCSV, spotifyLink } from "./data.js";
import { handleLoginRedirect } from "./spotify.js";
import { el, fill, $ } from "./dom.js";
import { DANCE_ALIASES } from "./dance-names.js";

const SAMPLE_URL = "data/sample-songs.json";
const SAMPLE_NAME = "Sample library (made-up songs)";
const PROJECT_URL = "data/songs.csv";
const PROJECT_NAME = "Project library (data/songs.csv)";
const DEFAULTS_LABEL = "Default settings";

const state = {
  defaults: null, // from data/default-settings.json
  settings: null,
  settingsLabel: DEFAULTS_LABEL, // where the current settings came from
  settingsModified: false, // edited since they were loaded
  songs: [],
  library: { name: "", problems: [] },
  result: null,
  stale: false,
  errors: [],
  themeStash: null,
  openSections: new Set(["Event basics", "Categories and dances"]),
};

/* ------------------------------------------------------------ DOM helpers */

const hms = (sec) => {
  const neg = sec < 0;
  sec = Math.round(Math.abs(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${neg ? "-" : ""}${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;

/** Text that is recomputed after every settings change. */
let liveUpdaters = [];
function live(fn, tag = "p", cls = "help") {
  const node = el(tag, { class: cls });
  const update = () => (node.textContent = fn());
  liveUpdaters.push(update);
  update();
  return node;
}

/* ------------------------------------------------------- change handling */

let validateTimer;
/** Call after any settings change. `structural` = rows were added/removed, so redraw the form. */
function changed(structural = false) {
  if (!state.settingsModified) {
    state.settingsModified = true;
    renderSettingsBar();
  }
  rememberSettings();
  refresh(structural);
}

/** Keep the current settings in this browser so a reload does not lose them. */
function rememberSettings() {
  saveLastSettings(state.settings, { label: state.settingsLabel, modified: state.settingsModified });
}

/** Redraw everything that depends on the settings or the song library. */
function refresh(structural = false) {
  if (structural) renderForm();
  updateDatalists();
  liveUpdaters.forEach((u) => u());
  if (state.result && !state.stale) {
    state.stale = true;
    const banner = $("stale");
    if (banner) banner.hidden = false;
  }
  clearTimeout(validateTimer);
  validateTimer = setTimeout(renderValidation, 150);
}

const rawDances = () => listDances(state.songs, {});
const resolvedDances = () => listDances(state.songs, state.settings);
const allTags = () => [...new Set(state.songs.flatMap((sg) => sg.tags || []))].sort();

function updateDatalists() {
  const setOptions = (id, values) => $(id).replaceChildren(...values.map((v) => el("option", { value: v })));
  setOptions("dl-raw", rawDances());
  setOptions("dl-dances", resolvedDances());
  setOptions("dl-tags", allTags());
}

/** Dances referenced anywhere in the settings (after associations). */
function referencedDances() {
  const s = state.settings;
  const m = associationMap(s.associations);
  const out = new Set();
  s.categories.forEach((c) => c.dances.forEach((d) => out.add(m(d))));
  Object.keys(s.excursions.pool).forEach((d) => out.add(m(d)));
  s.fixedEvents.forEach((e) => e.dances.forEach((d) => out.add(m(d))));
  if (s.closing.finalDance) out.add(m(s.closing.finalDance));
  return out;
}

/** The association already holding this (library) dance, or null. */
const associationOf = (dance) => state.settings.associations.find((a) => a.dances.includes(dance)) ?? null;

/** Suggestions for association editors: each dance can be in only one association. */
const dancesNotInAnAssociation = () => rawDances().filter((d) => !associationOf(d));

/** Suggestions for the excursion pool: dances not already excursions or in a category. */
const dancesForExcursions = () =>
  resolvedDances().filter((d) => !(d in state.settings.excursions.pool) && !categoryOf(d));

/** Suggested association names: common dance names not yet used as an association name. */
const associationNameIdeas = () => {
  const used = new Set(state.settings.associations.map((a) => a.name));
  return Object.keys(DANCE_ALIASES).filter((d) => !used.has(d));
};

/** When an association is renamed, update every place that used the old name. */
function renameEverywhere(oldName, newName) {
  const s = state.settings;
  const swap = (list) => list && list.forEach((d, i) => d === oldName && (list[i] = newName));
  s.categories.forEach((c) => swap(c.dances));
  if (oldName in s.excursions.pool) {
    s.excursions.pool = Object.fromEntries(Object.entries(s.excursions.pool).map(([d, w]) => [d === oldName ? newName : d, w]));
  }
  s.fixedEvents.forEach((e) => {
    swap(e.dances);
    swap(e.notAfter);
  });
  if (s.theme) swap(s.theme.dances);
  swap(s.opening.blacklist);
  if (s.closing.finalDance === oldName) s.closing.finalDance = newName;
}

/* ----------------------------------------------------------- form controls */

function field(label, control, help) {
  return el("label", { class: "field" }, el("span", { class: "label" }, label), control, help && el("small", {}, help));
}

function numberInput(get, set, { min, max, step = 1 } = {}) {
  const input = el("input", { type: "number", value: String(get()), min, max, step });
  input.addEventListener("input", () => {
    const v = input.valueAsNumber;
    if (Number.isFinite(v)) {
      set(v);
      changed();
    }
  });
  return input;
}

/**
 * Text input. Updates on every keystroke unless `commitOnly` (then on Enter / leaving the box).
 * `suggest`: a function returning suggestions for this box's own dropdown (refreshed on focus).
 */
function textInput(get, set, { placeholder, list, suggest, commitOnly = false, onCommit } = {}) {
  const ownList = suggest ? el("datalist", { id: `dl-auto-${++autoListId}` }) : null;
  const input = el("input", { type: "text", value: get() ?? "", placeholder, list: ownList ? ownList.id : list });
  if (ownList) input.addEventListener("focus", () => ownList.replaceChildren(...suggest().map((v) => el("option", { value: v }))));
  if (!commitOnly) {
    input.addEventListener("input", () => {
      set(input.value);
      changed();
    });
  }
  input.addEventListener("change", () => {
    if (onCommit) onCommit(input.value);
    else if (commitOnly) {
      set(input.value);
      changed();
    }
  });
  return ownList ? el("span", { class: "contents" }, input, ownList) : input;
}

/** Slider + number box for a 0..1 fraction shown as a percentage. */
function percentSlider(get, set) {
  const range = el("input", { type: "range", min: 0, max: 100, step: 1, value: String(Math.round(get() * 100)) });
  const num = el("input", { type: "number", min: 0, max: 100, step: 1, value: String(Math.round(get() * 100)) });
  const apply = (v, other) => {
    if (!Number.isFinite(v)) return;
    v = Math.min(100, Math.max(0, v));
    other.value = String(v);
    set(v / 100);
    changed();
  };
  range.addEventListener("input", () => apply(range.valueAsNumber, num));
  num.addEventListener("input", () => apply(num.valueAsNumber, range));
  return el("span", { class: "inline-fields" }, range, num, "%");
}

/**
 * Editable list of names shown as removable chips, with a suggestion dropdown.
 * `source` is a function returning the suggestions, or the id of a shared <datalist> to copy
 * them from. Each editor keeps its own list (refreshed on focus) and leaves out items
 * already added. `check(value)` may return an error message to refuse a value.
 */
let autoListId = 0;
function chipEditor(list, source, { placeholder = "add…", label = "Add", check = null } = {}) {
  const chips = el("span", { class: "chips-list" });
  const suggestions = typeof source === "function" ? source : () => [...$(source).options].map((o) => o.value);
  const datalist = el("datalist", { id: `dl-auto-${++autoListId}` });
  const refresh = () =>
    datalist.replaceChildren(...suggestions().filter((v) => !list.includes(v)).map((v) => el("option", { value: v })));
  const input = el("input", { type: "text", list: datalist.id, placeholder, "aria-label": label });
  const draw = () => {
    chips.replaceChildren(
      ...list.map((d, i) =>
        el(
          "span",
          { class: "chip" },
          d,
          el("button", { type: "button", title: `Remove ${d}`, "aria-label": `Remove ${d}`, onclick: () => {
            list.splice(i, 1);
            draw();
            changed();
          } }, "×")
        )
      )
    );
    refresh();
  };
  /** `explain`: show the reason if the value is refused (on Enter; not when leaving the box). */
  const add = (explain) => {
    const v = input.value.replace(/,$/, "").trim();
    if (!v) return;
    const problem = list.includes(v) ? `${v} is already in this list.` : check && check(v);
    if (problem) {
      input.setCustomValidity(problem);
      if (explain) input.reportValidity();
      return;
    }
    input.value = "";
    list.push(v);
    draw();
    changed();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(true);
    } else if (e.key === "Backspace" && !input.value && list.length) {
      list.pop();
      draw();
      changed();
    }
  });
  input.addEventListener("input", (e) => {
    input.setCustomValidity("");
    // Picking an entry from the suggestion list adds it straight away.
    if (e.inputType === undefined || e.inputType === "insertReplacementText") {
      const options = [...datalist.options].map((o) => o.value);
      if (options.includes(input.value)) add(true);
    }
  });
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", () => add(false));
  draw();
  return el("div", { class: "chips" }, chips, input, datalist);
}

function removeButton(what, onclick) {
  return el("button", { type: "button", class: "icon", title: `Remove ${what}`, "aria-label": `Remove ${what}`, onclick }, "×");
}

function section(title, note, ...body) {
  const d = el(
    "details",
    { class: "section", open: state.openSections.has(title) },
    el("summary", {}, title, note),
    el("div", { class: "section-body" }, ...body)
  );
  d.addEventListener("toggle", () => (d.open ? state.openSections.add(title) : state.openSections.delete(title)));
  return d;
}

/* --------------------------------------------------------------- sections */

function basicsSection(s) {
  return section(
    "Event basics",
    null,
    field(
      "Event length",
      el("span", { class: "inline-fields" },
        numberInput(() => s.eventLengthMinutes, (v) => (s.eventLengthMinutes = v), { min: 10, max: 720, step: 5 }),
        "minutes",
        live(() => `(${hms(s.eventLengthMinutes * 60)})`, "span", "muted"))
    )
  );
}

function associationsSection(s) {
  const rows = s.associations.map((a, i) =>
    el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => a.name, (v) => (a.name = v.trim()), {
          placeholder: "Merged name, e.g. Waltz",
          suggest: associationNameIdeas,
          commitOnly: true,
          onCommit: (v) => {
            const old = a.name;
            a.name = v.trim();
            if (old && a.name && old !== a.name) renameEverywhere(old, a.name);
            // By default an association includes its own name (e.g. "Waltz" also covers songs
            // tagged plain "Waltz"). Keep that chip in step with renames; it can be removed.
            if (!old || a.dances.includes(old)) {
              a.dances = a.dances.filter((d) => d !== old);
              if (a.name && !a.dances.includes(a.name)) a.dances.unshift(a.name);
            }
            changed(true);
          },
        }),
        removeButton(`association ${a.name}`, () => {
          s.associations.splice(i, 1);
          changed(true);
        })),
      chipEditor(a.dances, dancesNotInAnAssociation, {
        placeholder: "add a dance…",
        label: `Add a dance to ${a.name}`,
        check: (v) => {
          const owner = associationOf(v);
          return owner && owner !== a ? `${v} is already in the association “${owner.name}”.` : null;
        },
      }))
  );
  return section(
    "Dance associations",
    live(() => `${s.associations.length} group(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "Treat several dances as one. Example: “Waltz” = Smooth Waltz + Standard Waltz. Songs tagged with any of them " +
        "can play wherever “Waltz” is used, and the rules (spacing, shuffle-bag) count them as one dance. " +
        "Dances not listed here keep their own names. A group with one dance simply renames it."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      s.associations.push({ name: "", dances: [] });
      state.openSections.add("Dance associations");
      changed(true);
    } }, "+ Add association")),
    live(() => {
      const raw = rawDances();
      const inGroup = new Set(s.associations.flatMap((a) => [a.name, ...a.dances]));
      const loose = raw.filter((d) => !inGroup.has(d));
      return `The library has ${raw.length} dances; after associations there are ${resolvedDances().length}. ` +
        (loose.length ? `Not in any association: ${loose.join(", ")}.` : "");
    })
  );
}

/** The category already holding this dance (compared after associations), or null. */
function categoryOf(dance) {
  const m = associationMap(state.settings.associations);
  return state.settings.categories.find((c) => c.dances.some((d) => m(d) === m(dance))) ?? null;
}

/** Suggestions for category editors: each dance can be in only one category. */
const dancesNotInACategory = () => resolvedDances().filter((d) => !categoryOf(d));

function categoriesSection(s) {
  const rows = s.categories.map((c, i) =>
    el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => c.name, (v) => (c.name = v), { placeholder: "Category name, e.g. Latin" }),
        removeButton(`category ${c.name}`, () => {
          s.categories.splice(i, 1);
          changed(true);
        })),
      chipEditor(c.dances, dancesNotInACategory, {
        placeholder: "add a dance…",
        label: `Add a dance to ${c.name}`,
        check: (v) => {
          const owner = categoryOf(v);
          return owner ? `${v} is already in ${owner === c ? "this category" : `“${owner.name}”`}.` : null;
        },
      }))
  );
  return section(
    "Categories and dances",
    live(() => `${s.categories.length} categor${s.categories.length === 1 ? "y" : "ies"}`, "span", "summary-note"),
    el("p", { class: "help" }, "Categories take turns in blocks. Each dance can belong to only one category."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      s.categories.push({ name: `Category ${s.categories.length + 1}`, dances: [] });
      changed(true);
    } }, "+ Add category")),
    live(() => {
      const used = referencedDances();
      const unused = resolvedDances().filter((d) => !used.has(d));
      return unused.length
        ? `Not used anywhere (categories, excursions, fixed events, final dance): ${unused.join(", ")}.`
        : "Every dance in the library is used somewhere.";
    })
  );
}

function repetitionSection(s) {
  return section(
    "Repetition",
    null,
    field("Max in a row", numberInput(() => s.maxInARow, (v) => (s.maxInARow = v), { min: 1, max: 10 }),
      "Longest run of songs from one category. Each block is a random length from 1 up to this."),
    field("Songs between repeats", numberInput(() => s.minToRepeat, (v) => (s.minToRepeat = v), { min: 0, max: 20 }),
      "Minimum number of other songs between two songs of the same dance.")
  );
}

function excursionsSection(s) {
  const ex = s.excursions;
  // Suggestions leave out dances that are already excursions or belong to a category.
  const addList = el("datalist", { id: `dl-auto-${++autoListId}` });
  const addBox = el("input", { type: "text", list: addList.id, placeholder: "dance to add…", "aria-label": "Excursion dance to add" });
  addBox.addEventListener("focus", () => addList.replaceChildren(...dancesForExcursions().map((v) => el("option", { value: v }))));
  const addDance = () => {
    const d = addBox.value.trim();
    if (d && !(d in ex.pool)) {
      ex.pool[d] = 1;
      changed(true);
    }
  };
  addBox.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), addDance()));
  addBox.addEventListener("input", (e) => {
    // Picking an entry from the suggestion list adds it straight away.
    if ((e.inputType === undefined || e.inputType === "insertReplacementText") && [...addList.options].some((o) => o.value === addBox.value)) addDance();
  });
  const rows = Object.keys(ex.pool).map((d) =>
    el("tr", {},
      el("td", {}, d),
      el("td", {}, numberInput(() => ex.pool[d], (v) => (ex.pool[d] = v), { min: 0, max: 50 })),
      el("td", {}, removeButton(`excursion ${d}`, () => {
        delete ex.pool[d];
        changed(true);
      })))
  );
  return section(
    "Excursions",
    live(() => `${Object.keys(ex.pool).length} dance(s), every ${ex.intervalMinutes} min`, "span", "summary-note"),
    el("p", { class: "help" },
      "Dances outside the categories, played on a timer. The number next to each dance is the most times it can " +
        "play before the pool refills; higher numbers are also more likely to be picked."),
    field("Every", el("span", { class: "inline-fields" },
      numberInput(() => ex.intervalMinutes, (v) => (ex.intervalMinutes = v), { min: 0, max: 240 }), "minutes"),
      "0 turns excursions off."),
    field("Random variation", el("span", { class: "inline-fields" },
      "±", numberInput(() => ex.jitterMinutes ?? 0, (v) => (ex.jitterMinutes = v), { min: 0, max: 60 }), "minutes")),
    rows.length
      ? el("table", { class: "pool-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Dance"), el("th", {}, "Max count"), el("th", {}))),
          el("tbody", {}, rows))
      : el("p", { class: "muted" }, "No excursion dances yet."),
    el("div", { class: "inline-fields" }, addBox, addList, el("button", { type: "button", class: "small", onclick: addDance }, "+ Add"))
  );
}

function fixedSection(s) {
  const rows = s.fixedEvents.map((e, i) => {
    e.notAfter ??= [];
    return el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => e.name, (v) => (e.name = v), { placeholder: "Event name, e.g. Line dance break" }),
        removeButton(`fixed event ${e.name}`, () => {
          s.fixedEvents.splice(i, 1);
          changed(true);
        })),
      el("div", { class: "inline-fields" }, "Dance(s):",
        chipEditor(e.dances, resolvedDances, { placeholder: "add a dance…", label: `Add a dance to ${e.name}` })),
      el("div", { class: "inline-fields" },
        el("label", {}, "Songs", numberInput(() => e.count ?? 1, (v) => (e.count = v), { min: 1, max: 10 }))),
      el("div", { class: "inline-fields" }, "At", percentSlider(() => e.at, (v) => (e.at = v)), "of the night"),
      el("div", { class: "inline-fields" }, "Never directly after:",
        chipEditor(e.notAfter, () => [...s.fixedEvents.filter((x) => x !== e).map((x) => x.name), ...resolvedDances()],
          { placeholder: "dance or event…", label: `Never directly after (${e.name})` })));
  });
  return section(
    "Fixed events",
    live(() => `${s.fixedEvents.length} event(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "Dances placed at a set point in the night, e.g. a line-dance break at 50% or one Paso Doble at 70%. " +
        "With several dances, each song of the event is one of them. Two fixed events never play back to back."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      s.fixedEvents.push({ name: "New event", dances: [], count: 1, at: 0.5, notAfter: [] });
      changed(true);
    } }, "+ Add fixed event"))
  );
}

function themeSection(s) {
  const toggle = el("input", { type: "checkbox", checked: !!s.theme, onchange: () => {
    if (toggle.checked) s.theme = state.themeStash ?? clone(THEME_TEMPLATE);
    else {
      state.themeStash = s.theme;
      s.theme = null;
    }
    changed(true);
  } });
  const body = [el("label", { class: "inline-fields" }, toggle, "This event has a theme")];
  if (s.theme) {
    const t = s.theme;
    t.tags ??= [];
    const presetButton = (label, min, max) =>
      el("button", { type: "button", class: "small", onclick: () => {
        t.fractionMin = min;
        t.fractionMax = max;
        changed(true);
      } }, label);
    body.push(
      field("Theme name", textInput(() => t.name, (v) => (t.name = v), { placeholder: "e.g. Roarin' Twenties" })),
      el("div", {}, el("div", { class: "label" }, "Theme dances"), chipEditor(t.dances, resolvedDances, { placeholder: "add a dance…", label: "Add a theme dance" })),
      el("div", {}, el("div", { class: "label" }, "Theme song tags"), chipEditor(t.tags, allTags, { placeholder: "add a tag…", label: "Add a theme tag" })),
      live(() => {
        const tags = allTags();
        return tags.length ? `Tags in the library: ${tags.join(", ")}.` : "No songs in the library have tags.";
      }),
      el("p", { class: "help" }, "A song counts toward the theme if it is played as a theme dance or has a theme tag."),
      el("div", { class: "inline-fields" }, "Theme share at least", percentSlider(() => t.fractionMin, (v) => (t.fractionMin = v))),
      el("div", { class: "inline-fields" }, "Theme share at most", percentSlider(() => t.fractionMax, (v) => (t.fractionMax = v))),
      el("div", { class: "inline-fields" }, "Quick set:", presetButton("Broad theme (50–70%)", 0.5, 0.7), presetButton("Dance-focused theme (20–25%)", 0.2, 0.25)),
      el("p", { class: "help" },
        "Broad themes (e.g. Hollywood) match songs of any dance, so a high share is easy to reach. " +
          "Dance-focused themes (e.g. Hustle night) should stay lower so that one dance does not dominate."),
      field("Guaranteed theme openers", numberInput(() => t.guaranteedOpeners, (v) => (t.guaranteedOpeners = v), { min: 0, max: 10 }),
        "How many songs at the start of the night must be theme songs.")
    );
  }
  return section("Theme", live(() => (s.theme ? s.theme.name || "on" : "off"), "span", "summary-note"), ...body);
}

function openingSection(s) {
  return section(
    "Opening and closing",
    null,
    field("Opening length", el("span", { class: "inline-fields" },
      numberInput(() => s.opening.earlyCount, (v) => (s.opening.earlyCount = v), { min: 0, max: 30 }), "songs")),
    el("div", {}, el("div", { class: "label" }, "Not allowed in the opening"),
      chipEditor(s.opening.blacklist, "dl-dances", { placeholder: "add a dance…", label: "Add a dance to the opening blacklist" })),
    field("Last dance of the night",
      selectInput(() => s.closing.finalDance, (v) => (s.closing.finalDance = v), resolvedDances, "(none)"))
  );
}

/**
 * Dropdown with no free typing. `options()` is re-read whenever settings change, so the
 * list follows the song library and associations. `noneLabel` is the "nothing chosen" entry
 * (its value is null). A current value missing from the options is kept, marked as missing.
 */
function selectInput(get, set, options, noneLabel) {
  const select = el("select", {});
  const update = () => {
    const current = get();
    const values = options();
    select.replaceChildren(
      el("option", { value: "" }, noneLabel),
      ...values.map((v) => el("option", { value: v }, v)),
      current && !values.includes(current) && el("option", { value: current }, `${current} (no songs)`)
    );
    select.value = current ?? "";
  };
  select.addEventListener("change", () => {
    set(select.value || null);
    changed();
  });
  liveUpdaters.push(update);
  update();
  return select;
}

function renderForm() {
  liveUpdaters = [];
  const s = state.settings;
  $("settings-form").replaceChildren(
    basicsSection(s),
    associationsSection(s),
    categoriesSection(s),
    repetitionSection(s),
    excursionsSection(s),
    fixedSection(s),
    themeSection(s),
    openingSection(s)
  );
}

/* -------------------------------------------------------------- validation */

function renderValidation() {
  const { errors, warnings } = state.songs.length
    ? validateSettings(state.songs, state.settings)
    : { errors: ["No song library is loaded."], warnings: [] };
  state.errors = errors;
  $("generate").disabled = errors.length > 0;
  $("validation").replaceChildren(
    ...(errors.length || warnings.length
      ? [el("ul", { class: "msgs" },
          errors.map((e) => el("li", { class: "error" }, e)),
          warnings.map((w) => el("li", { class: "warning" }, w)))]
      : [])
  );
}

/* --------------------------------------------------------- settings files */

/** Offer `text` as a file download named `filename`. */
function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Replace the current settings (from the defaults file or a user file). */
function applySettings(settings, label) {
  state.settings = upgradeSettings(settings, state.defaults);
  state.settingsLabel = label;
  state.settingsModified = false;
  state.themeStash = null;
  rememberSettings();
  renderSettingsBar();
  refresh(true);
}

function loadDefaults() {
  if (state.settingsModified && !confirm("Load the default settings? Changes you have not saved to a file will be lost.")) return;
  applySettings(state.defaults, DEFAULTS_LABEL);
}

/** Save the current settings to a file the user names (never touches the default settings). */
async function saveUserSettings() {
  const suggested = state.settingsLabel !== DEFAULTS_LABEL ? state.settingsLabel : "My settings";
  const saved = (name) => {
    state.settingsLabel = name;
    state.settingsModified = false;
    rememberSettings();
    renderSettingsBar();
  };
  if (window.showSaveFilePicker) {
    // Chrome / Edge: a real "Save as" dialog (choose the name and the folder).
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${suggested}.json`,
        types: [{ description: "Playlist settings", accept: { "application/json": [".json"] } }],
      });
      const name = handle.name.replace(/\.json$/i, "");
      const file = await handle.createWritable();
      await file.write(settingsFileText(state.settings, name));
      await file.close();
      saved(name);
    } catch (err) {
      if (err.name !== "AbortError") alert(`Could not save the settings: ${err.message}`);
    }
    return;
  }
  // Other browsers: ask for a name, then download (it goes to the Downloads folder).
  const name = (prompt("Name for this settings file:", suggested) || "").trim();
  if (!name) return;
  downloadFile(`${name.replace(/[\\/:*?"<>|]+/g, "-")}.json`, settingsFileText(state.settings, name), "application/json");
  saved(name);
}

function loadUserSettings() {
  const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    if (state.settingsModified && !confirm(`Load “${file.name}”? Changes you have not saved to a file will be lost.`)) return;
    try {
      const { name, settings } = parseSettingsFile(await file.text());
      applySettings(settings, name || file.name.replace(/\.json$/i, ""));
    } catch (err) {
      alert(`Could not load ${file.name}: ${err.message}`);
    }
  });
  document.body.append(input);
  input.click();
}

function renderSettingsBar() {
  fill($("settings-bar"),
    el("div", { class: "library-line" },
      el("span", {}, "Current settings: ", el("strong", {}, state.settingsLabel),
        state.settingsModified && el("span", { class: "muted" }, " (changed, not saved to a file)")),
      el("button", { type: "button", class: "small", onclick: loadDefaults }, "Load default settings"),
      el("button", { type: "button", class: "small", onclick: saveUserSettings }, "Save user settings…"),
      el("button", { type: "button", class: "small", onclick: loadUserSettings }, "Load user settings…")));
}

/* ----------------------------------------------------------------- library */

function setLibrary(songs, name, problems, persist) {
  state.songs = songs;
  state.library = { name, problems };
  state.result = null;
  try {
    if (persist) localStorage.setItem(LIBRARY_KEY, JSON.stringify({ name, songs }));
    else localStorage.removeItem(LIBRARY_KEY);
  } catch {
    /* storage full or unavailable: the library just won't be remembered */
  }
  renderLibrary();
  renderResults();
  refresh();
}

function loadSavedLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The project library (data/songs.csv), or null if it does not exist yet. */
async function fetchProjectLibrary() {
  try {
    return await loadSongsFromUrl(PROJECT_URL);
  } catch {
    return null;
  }
}

async function useProject() {
  const lib = await fetchProjectLibrary();
  if (lib && lib.songs.length) setLibrary(lib.songs, PROJECT_NAME, lib.problems, false);
  else alert("data/songs.csv was not found or has no songs.");
}

async function useSample() {
  try {
    const { songs, problems } = await loadSongsFromUrl(SAMPLE_URL);
    setLibrary(songs, SAMPLE_NAME, problems, false);
  } catch (err) {
    $("library").replaceChildren(
      el("ul", { class: "msgs" }, el("li", { class: "error" },
        `Could not load the sample library: ${err.message} ` +
          "If you opened index.html directly from disk, run “npm start” and use http://127.0.0.1:8000/ instead."))
    );
  }
}

/** Startup: a library loaded earlier in this browser, else data/songs.csv, else the sample. */
async function loadStartingLibrary() {
  const saved = loadSavedLibrary();
  if (saved && Array.isArray(saved.songs) && saved.songs.length) return setLibrary(saved.songs, saved.name, [], true);
  const lib = await fetchProjectLibrary();
  if (lib && lib.songs.length) return setLibrary(lib.songs, PROJECT_NAME, lib.problems, false);
  await useSample();
}

function renderLibrary() {
  const fileInput = el("input", { type: "file", accept: ".csv,.json,text/csv,application/json", hidden: true });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const { songs, problems } = parseSongsText(await file.text(), file.name);
      if (!songs.length) throw new Error(problems[0] || "No songs found.");
      setLibrary(songs, file.name, problems, true);
    } catch (err) {
      alert(`Could not read ${file.name}: ${err.message}`);
    }
  });
  const { name, problems } = state.library;
  fill($("library"),
    el("div", { class: "library-line" },
      el("span", {}, "Song library: ", el("strong", {}, name), ` — ${state.songs.length} songs, ${rawDances().length} dances`),
      el("button", { type: "button", class: "small", onclick: () => fileInput.click() }, "Load CSV / JSON…"),
      name !== PROJECT_NAME && el("button", { type: "button", class: "small", onclick: useProject }, "Use data/songs.csv"),
      name !== SAMPLE_NAME && el("button", { type: "button", class: "small", onclick: useSample }, "Use sample library"),
      el("a", { href: "library.html", class: "small" }, "Library builder"),
      fileInput),
    problems.length > 0 &&
      el("details", {},
        el("summary", {}, `${problems.length} row(s) skipped or changed while loading`),
        el("ul", { class: "msgs" }, problems.map((p) => el("li", { class: "warning" }, p))))
  );
}

/* ----------------------------------------------------------------- results */

function generate() {
  clearTimeout(validateTimer);
  renderValidation();
  if (state.errors.length) return;
  state.result = generatePlaylist(state.songs, { ...state.settings, seed: null }); // always a fresh random playlist
  state.stale = false;
  renderResults();
}

function renderResults() {
  const r = state.result;
  const box = $("results");
  if (!r) {
    box.replaceChildren(el("p", { class: "muted" }, "Adjust the settings, then press ", el("strong", {}, "Generate playlist"), "."));
    return;
  }
  const s = state.settings;
  const themed = Boolean(s.theme && (s.theme.dances.length || (s.theme.tags || []).length));
  const diff = r.totalSec - r.targetSec;

  /** A button that copies text to the clipboard and briefly confirms. */
  const copyButton = (label, getText, done = "Copied!") => {
    const btn = el("button", { type: "button", onclick: async () => {
      try {
        await navigator.clipboard.writeText(getText());
        btn.textContent = done;
        setTimeout(() => (btn.textContent = label), 2000);
      } catch {
        alert("Copying failed in this browser. Use “Download CSV” instead.");
      }
    } }, label);
    return btn;
  };

  const copyList = copyButton("Copy song list", () =>
    r.playlist.map((it, i) => `${i + 1}. ${it.song.title}${it.song.artist ? ` – ${it.song.artist}` : ""} (${it.dance})`).join("\n"));

  // Spotify links, in playlist order. Songs without a real Spotify ID are left out (and reported).
  const links = r.playlist.map((it) => spotifyLink(it.song.id));
  const linkCount = links.filter(Boolean).length;
  const missingLinks = r.playlist.filter((it, i) => !links[i]);
  const copyLinks = copyButton("Copy Spotify links", () => links.filter(Boolean).join("\n"), `Copied ${linkCount} links!`);
  if (!linkCount) {
    copyLinks.disabled = true;
    copyLinks.title = "No song in this playlist has a Spotify track ID.";
  }

  const download = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    downloadFile(`playlist-${stamp}.csv`, playlistToCSV(r), "text/csv");
  };

  const kindLabel = (it) =>
    it.kind === "regular" ? it.category : it.kind === "excursion" ? "Excursion" : it.kind === "fixed" ? it.source : "Last dance";

  fill(box,
    el("ul", { id: "stale", class: "msgs", hidden: !state.stale },
      el("li", { class: "warning" }, "Settings have changed since this playlist was generated.")),
    el("div", { class: "summary" },
      el("span", {}, "Songs: ", el("b", {}, String(r.playlist.length))),
      el("span", {}, "Length: ", el("b", {}, hms(r.totalSec)), ` (target ${hms(r.targetSec)}, ${diff >= 0 ? "+" : ""}${hms(diff)})`),
      themed && el("span", {}, "Theme share: ", el("b", {}, pct(r.stats.themeFraction)))),
    el("div", { class: "result-actions" },
      el("button", { type: "button", class: "primary", onclick: generate, disabled: state.errors.length > 0 }, "Generate another"),
      copyLinks,
      copyList,
      el("button", { type: "button", onclick: download }, "Download CSV")),
    linkCount > 0 &&
      el("p", { class: "help" },
        "To build the playlist by hand: copy the Spotify links, open an empty playlist in the Spotify desktop app, " +
          "click in its track list and paste (Ctrl+V)."),
    missingLinks.length > 0 &&
      el("ul", { class: "msgs" }, el("li", { class: "warning" },
        linkCount
          ? `${missingLinks.length} song(s) have no Spotify track ID and are left out of the links: ` +
              missingLinks.map((it) => `#${it.index + 1} ${it.song.title}`).join(", ") + "."
          : "This song library has no Spotify track IDs, so there are no Spotify links to copy.")),
    r.warnings.length > 0 &&
      el("ul", { class: "msgs" },
        r.warnings.map((w) => el("li", { class: "warning" }, (w.index >= 0 ? `#${w.index + 1}: ` : "") + w.message))),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {},
          ["#", "Start", "Dance", "Type", "Title", "Length"].map((h) => el("th", { scope: "col" }, h)),
          themed && el("th", { scope: "col" }, "Theme?"))),
        el("tbody", {},
          r.playlist.map((it) =>
            el("tr", { class: it.kind },
              el("td", { class: "num" }, String(it.index + 1)),
              el("td", { class: "num" }, hms(it.startSec)),
              el("td", { title: it.song.sourceDances ? `Tagged: ${it.song.sourceDances.join(", ")}` : null }, it.dance),
              el("td", { class: "type" }, kindLabel(it)),
              el("td", {}, it.song.title, it.song.artist && el("span", { class: "muted" }, ` – ${it.song.artist}`)),
              el("td", { class: "num" }, hms(it.song.lengthSec)),
              themed && el("td", { class: "theme-mark" }, it.isTheme ? "Yes" : ""))))))
  );
}

/* -------------------------------------------------------------------- init */

async function init() {
  // Spotify sends the browser back to this page after login; finish it (this may leave the page).
  const login = await handleLoginRedirect();
  if (login.handled && !login.error) return;
  if (login.error) alert(login.error);

  $("generate").addEventListener("click", generate);

  // Defaults come from data/default-settings.json; the page then continues where it left off.
  try {
    state.defaults = (await loadDefaultSettings()).settings;
  } catch (err) {
    alert(`${err.message} Starting with empty settings.`);
    state.defaults = clone(DEFAULT_SETTINGS);
  }
  const last = loadLastSettings();
  state.settings = upgradeSettings(last && last.settings, state.defaults);
  state.settingsLabel = (last && last.label) || DEFAULTS_LABEL;
  state.settingsModified = !!(last && last.modified);

  renderSettingsBar();
  renderForm();
  await loadStartingLibrary();
}

init();
