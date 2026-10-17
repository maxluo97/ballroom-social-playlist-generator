/**
 * ui.js — the settings page and results list.
 *
 * One settings object (state.settings, the exact shape generatePlaylist() takes) is the single
 * source of truth: every control reads from it and writes to it. Controls only rebuild the
 * form when its structure changes (adding/removing a row); typing just updates the object.
 */

import {
  generatePlaylist, validateSettings, listDances, associationMap, withinLengthLimits, DEFAULT_SETTINGS,
  themeMinGapFor, themeMinGapApplies, BLOCK_DEFAULTS,
} from "./generator.js";
import {
  THEME_TEMPLATE, clone, loadLastSettings, saveLastSettings,
  loadDefaultSettings, workingSettings, parseSettingsFile, settingsFileText,
} from "./settings.js";
import { loadSongsFromUrl, playlistToCSV, spotifyLink, spotifyTrackId, parseLength } from "./data.js";
import { handleLoginRedirect, isLoggedIn, login as spotifyLogin, createPlaylist, addTracksToPlaylist } from "./spotify.js";
import { el, fill, $, comboInput, sortRows, sortHeader, chipEditor as sharedChipEditor } from "./dom.js";
import { checkSongs, isUnavailable, unavailableReason, isChecked, checkFailed } from "./availability.js";
import { DANCE_ALIASES, BALLROOM_DANCE_NAMES, canonicalDance, unknownDanceMessage } from "./dance-names.js";
import {
  activeItems, activeResult, hasEdits, prepareGenerated,
  swapSong, resetSwap, insertSong, removeItem, restoreItem, resetAll,
} from "./playlist-edit.js";
import { checkAndReplace } from "./playlist-check.js";

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
 * `suggest`: a function returning suggestions for a dropdown; picking one counts as committing it.
 */
function textInput(get, set, { placeholder, suggest, commitOnly = false, onCommit } = {}) {
  const combo = suggest
    ? comboInput({ value: get() ?? "", placeholder }, suggest, (v) => {
        combo.input.value = v;
        combo.input.dispatchEvent(new Event("input"));
        combo.input.dispatchEvent(new Event("change"));
      })
    : null;
  const input = combo ? combo.input : el("input", { type: "text", value: get() ?? "", placeholder });
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
  return combo ? combo.wrap : input;
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

/** Chip editor (see js/dom.js) whose changes count as settings edits. */
const chipEditor = (list, source, options = {}) => sharedChipEditor(list, source, { ...options, onChange: () => changed() });

/*
 * Dance boxes accept known dances only (no free typing of new dances; a dedicated "define a dance"
 * button is planned). Known = the library's dances, association names, and the app's built-in names.
 */
const builtInDances = () => [...BALLROOM_DANCE_NAMES, ...Object.keys(DANCE_ALIASES)];
/** Dances usable in settings (after associations). */
const settingDances = () =>
  [...new Set([...resolvedDances(), ...state.settings.associations.map((a) => a.name).filter(Boolean), ...builtInDances()])];
/** Dances usable inside associations (the library's own tags). */
const libraryDanceNames = () => [...new Set([...rawDances(), ...builtInDances()])];
/** Options for a dance chip editor that only accepts the names in `allowedFn()`. */
const onlyDances = (allowedFn) => ({ allowed: allowedFn, notAllowed: unknownDanceMessage, normalize: canonicalDance });

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
    ),
    field("Shortest song allowed", lengthInput(() => s.minSongSec, (v) => (s.minSongSec = v))),
    field("Longest song allowed", lengthInput(() => s.maxSongSec, (v) => (s.maxSongSec = v)),
      live(() => {
        const how = "Type minutes:seconds (2:30) or just seconds (150 becomes 2:30). Leave blank for no limit.";
        if (!(s.minSongSec > 0) && !(s.maxSongSec > 0)) return how;
        const fit = state.songs.filter((sg) => withinLengthLimits(sg, s)).length;
        return `${how} ${fit} of ${state.songs.length} songs in the library fit these limits.`;
      }, "span", ""))
  );
}

/** A song length typed as m:ss (or seconds). Blank = no limit (null). */
function lengthInput(get, set) {
  const show = (sec) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "");
  const input = el("input", { type: "text", value: show(get()), placeholder: "no limit", size: 7, "aria-label": "Length (m:ss)" });
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("change", () => {
    const text = input.value.trim();
    const sec = text ? Math.round(parseLength(text)) : null;
    if (text && !(sec > 0)) {
      input.setCustomValidity("Type a length like 2:30 (minutes:seconds), or leave it blank.");
      input.reportValidity();
      return;
    }
    set(sec);
    input.value = show(sec);
    changed();
  });
  return input;
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
        ...onlyDances(libraryDanceNames),
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
      "Treat several dances as one. Example: “Waltz” = Smooth Waltz + Standard Waltz: a song tagged with any of them " +
        "can play as a Waltz, and the generator counts them as the same dance when it spaces out repeats. " +
        "Dances not in a group keep their own names. A group with a single dance just renames it."),
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
        ...onlyDances(settingDances),
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
    el("p", { class: "help" }, "The night alternates between categories in short blocks (see Repetition). Within a category, " +
      "every dance plays once before any of them repeats. Each dance can belong to only one category."),
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
      "The most songs in a row from one category before switching. Each block is a random length from 1 up to this."),
    field("Songs between repeats", numberInput(() => s.minToRepeat, (v) => (s.minToRepeat = v), { min: 0, max: 20 }),
      "At least this many other songs between two songs of the same dance.")
  );
}

function excursionsSection(s) {
  const ex = s.excursions;
  // Dropdown leaves out dances that are already excursions or belong to a category; picking one adds it.
  const { wrap: addWrap, input: addBox } = comboInput({ placeholder: "dance to add…", "aria-label": "Excursion dance to add" },
    dancesForExcursions, (v) => { addBox.value = v; addDance(); });
  const addDance = () => {
    const typed = canonicalDance(addBox.value);
    if (!typed) return;
    const d = settingDances().find((k) => k.toLowerCase() === typed.toLowerCase());
    if (!d) {
      addBox.setCustomValidity(unknownDanceMessage(typed));
      addBox.reportValidity();
      return;
    }
    if (!(d in ex.pool)) {
      ex.pool[d] = 1;
      changed(true);
    }
  };
  addBox.addEventListener("input", () => addBox.setCustomValidity(""));
  addBox.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), addDance()));
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
      "Dances outside the categories, played every so often. Max count is how many times a dance can play before " +
        "all the counts start over; a higher count also makes that dance more likely to be picked."),
    field("Every", el("span", { class: "inline-fields" },
      numberInput(() => ex.intervalMinutes, (v) => (ex.intervalMinutes = v), { min: 0, max: 240 }), "minutes"),
      "0 turns excursions off."),
    field("Random variation", el("span", { class: "inline-fields" },
      "±", numberInput(() => ex.jitterMinutes ?? 0, (v) => (ex.jitterMinutes = v), { min: 0, max: 60 }), "minutes"),
      // Same range the generator uses: interval ± variation, never under 1 minute.
      live(() => {
        const every = ex.intervalMinutes;
        const jitter = ex.jitterMinutes || 0;
        if (!(every > 0)) return "Excursions are off.";
        if (!jitter) return `Every ${every} minutes`;
        return `Every ${Math.max(1, every - jitter)} to ${every + jitter} minutes`;
      }, "span", "")),
    // The dances and their counts, in their own box so they stand apart from the timing fields.
    el("div", { class: "subbox" },
      el("div", { class: "subbox-title" }, "Excursion dances"),
      rows.length
        ? el("table", { class: "pool-table" },
            el("thead", {}, el("tr", {}, el("th", {}, "Dance"), el("th", {}, "Max count"), el("th", {}))),
            el("tbody", {}, rows))
        : el("p", { class: "muted" }, "No excursion dances yet."),
      el("div", { class: "inline-fields" }, addWrap, el("button", { type: "button", class: "small", onclick: addDance }, "+ Add")))
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
        chipEditor(e.dances, resolvedDances, { ...onlyDances(settingDances), placeholder: "add a dance…", label: `Add a dance to ${e.name}` })),
      el("div", { class: "inline-fields" },
        el("label", {}, "Songs", numberInput(() => e.count ?? 1, (v) => (e.count = v), { min: 1, max: 10 }))),
      el("div", { class: "inline-fields" }, "At", percentSlider(() => e.at, (v) => (e.at = v)), "of the night"),
      el("div", { class: "inline-fields" }, "Never directly after:",
        chipEditor(e.notAfter, () => [...s.fixedEvents.filter((x) => x !== e).map((x) => x.name), ...resolvedDances()], {
          allowed: () => [...s.fixedEvents.filter((x) => x !== e).map((x) => x.name), ...settingDances()],
          notAllowed: (v) => `“${v}” is not a known dance or fixed event.`,
          placeholder: "dance or event…",
          label: `Never directly after (${e.name})`,
        })));
  });
  return section(
    "Fixed events",
    live(() => `${s.fixedEvents.length} event(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "Dances placed at a set point in the night, e.g. a line-dance break halfway through (50%) or one Paso Doble at 70%. " +
        "If an event lists several dances, each of its songs is one of them. Two fixed events never play back to back."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      s.fixedEvents.push({ name: "New event", dances: [], count: 1, at: 0.5, notAfter: [] });
      changed(true);
    } }, "+ Add fixed event"))
  );
}

/** Themed blocks (the agreed spec, NOTES.md v0.2.4). */
function blocksSection(s) {
  s.themedBlocks ??= [];
  const rows = s.themedBlocks.map((b, i) => {
    b.placement = { ...BLOCK_DEFAULTS.placement, ...(b.placement || {}) };
    b.interruptBy = { ...BLOCK_DEFAULTS.interruptBy, ...(b.interruptBy || {}) };
    const p = b.placement;
    const ib = b.interruptBy;
    const select = (value, options, onChange, label) => {
      const node = el("select", { "aria-label": label, onchange: () => onChange(node.value) },
        options.map(([v, text]) => el("option", { value: v, selected: v === value }, text)));
      return node;
    };
    const tick = (checked, onChange, text) =>
      el("label", { class: "inline-fields" }, el("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), text);
    const placement =
      p.mode === "at" ? el("div", { class: "inline-fields" }, "At", percentSlider(() => p.at, (v) => (p.at = v)), "of the night")
        : p.mode === "window" ? el("div", {},
          el("div", { class: "inline-fields" }, "From", percentSlider(() => p.from, (v) => (p.from = v))),
          el("div", { class: "inline-fields" }, "to", percentSlider(() => p.to, (v) => (p.to = v)), "of the night"))
          : el("p", { class: "help" }, "Somewhere after the opening songs and before the last 15% of the night, different every time.");
    return el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => b.tag, (v) => (b.tag = v), { placeholder: "Tag, e.g. Hollywood", suggest: allTags }),
        removeButton(`themed block ${b.tag}`, () => {
          s.themedBlocks.splice(i, 1);
          changed(true);
        })),
      el("div", { class: "inline-fields" },
        el("label", {}, "Songs", numberInput(() => b.count, (v) => (b.count = v), { min: 1, max: 20 }))),
      tick(!!b.fixedEvent, (v) => {
        b.fixedEvent = v;
        changed(true);
      }, "Plays as a fixed event"),
      el("p", { class: "help" }, b.fixedEvent
        ? "Any dance with the tag, outside the category turns. Never directly before or after a fixed event."
        : "The next songs in the normal category turns, each with the tag."),
      el("div", { class: "inline-fields" }, "Placement:",
        select(p.mode, [["at", "At a point"], ["random", "At a random point"], ["window", "At a random point between"]], (v) => {
          p.mode = v;
          changed(true);
        }, "Placement")),
      placement,
      el("div", { class: "inline-fields" }, "May be interrupted by:",
        tick(!!ib.excursions, (v) => ((ib.excursions = v), changed()), "excursions"),
        tick(!!ib.theme, (v) => ((ib.theme = v), changed()), "theme dances in no category"),
        !b.fixedEvent && tick(!!ib.fixed, (v) => ((ib.fixed = v), changed()), "fixed events")),
      el("div", { class: "inline-fields" }, "After an interruption:",
        select(b.afterInterruption, [["continue", "continue the block"], ["end", "end the block"]], (v) => {
          b.afterInterruption = v;
          changed();
        }, "After an interruption")));
  });
  return section(
    "Themed blocks",
    live(() => `${s.themedBlocks.length} block(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "A run of songs that all carry one tag, e.g. 4 Hollywood songs at 40% of the night. " +
        "Blocks keep the shuffle-bag and the gap between repeats; if too few tagged songs fit, a block is shorter. " +
        "Anything that may not interrupt a block waits until it ends."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      s.themedBlocks.push(clone(BLOCK_DEFAULTS));
      changed(true);
    } }, "+ Add themed block"))
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
      el("div", {}, el("div", { class: "label" }, "Theme dances"), chipEditor(t.dances, resolvedDances, { ...onlyDances(settingDances), placeholder: "add a dance…", label: "Add a theme dance" })),
      el("div", {}, el("div", { class: "label" }, "Theme song tags"), chipEditor(t.tags, allTags, { placeholder: "add a tag…", label: "Add a theme tag" })),
      live(() => {
        const tags = allTags();
        return tags.length ? `Tags in the library: ${tags.join(", ")}.` : "No songs in the library have tags.";
      }),
      el("p", { class: "help" }, "A song is a theme song if it is played as a theme dance or has a theme tag. " +
        "The theme share is the part of the night's songs that are theme songs, not counting the opening songs (which are theme songs anyway)."),
      el("div", { class: "inline-fields" }, "Theme share at least", percentSlider(() => t.fractionMin, (v) => (t.fractionMin = v))),
      el("div", { class: "inline-fields" }, "Theme share at most", percentSlider(() => t.fractionMax, (v) => (t.fractionMax = v))),
      el("div", { class: "inline-fields" }, "Quick set:", presetButton("Broad theme (50–70%)", 0.5, 0.7), presetButton("Dance-focused theme (20–25%)", 0.2, 0.25)),
      el("p", { class: "help" },
        "Broad themes (e.g. Hollywood) match songs of any dance, so a high share is easy to reach. " +
          "Dance-focused themes (e.g. Hustle night) should stay lower so that one dance does not dominate."),
      themeMinGapField(s, t)
    );
  }
  return section("Theme", live(() => (s.theme ? s.theme.name || "on" : "off"), "span", "summary-note"), ...body);
}

/**
 * The theme minimum gap: only shown when it matters (the theme has tags, or is one dance that is in no
 * category and not an excursion). Until set, it follows the normal gap (minus 2).
 */
function themeMinGapField(s, t) {
  const input = numberInput(() => themeMinGapFor(s), (v) => (t.minGap = v), { min: 0, max: 20 });
  const node = field("Theme songs may repeat after at least", el("span", { class: "inline-fields" }, input, "songs"),
    "When no theme song fits the normal gap between repeats, the gap may shrink down to this. " +
      "Also the gap for a theme of one dance that is in no category. Default: the normal gap minus 2.");
  liveUpdaters.push(() => {
    node.hidden = !themeMinGapApplies(s);
    if (t.minGap == null && document.activeElement !== input) input.value = String(themeMinGapFor(s));
  });
  node.hidden = !themeMinGapApplies(s);
  return node;
}

function openingSection(s) {
  return section(
    "Opening and closing",
    null,
    field("Opening length", el("span", { class: "inline-fields" },
      numberInput(() => s.opening.earlyCount, (v) => (s.opening.earlyCount = v), { min: 0, max: 30 }), "songs"),
      "The first songs of the night, which avoid the dances listed below (e.g. fast or demanding ones). " +
        "With a theme, they are theme songs too. Theme dances take turns there (never the same one twice in a row, unless there is only one) " +
        "and may open even if listed below."),
    el("div", {}, el("div", { class: "label" }, "Not allowed in the opening"),
      chipEditor(s.opening.blacklist, "dl-dances", { ...onlyDances(settingDances), placeholder: "add a dance…", label: "Add a dance to the opening blacklist" })),
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
    blocksSection(s),
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

/**
 * Options shared by the "Save user settings" and "Load user settings" file windows (Chrome / Edge).
 * Web pages may not open a file window in a particular folder (such as the project's data folder),
 * but the same `id` makes the browser reopen whichever folder was used last for settings files.
 * `startIn` only applies the very first time, before any folder has been remembered.
 */
const SETTINGS_PICKER = {
  id: "dpg-settings",
  startIn: "documents",
  types: [{ description: "Playlist settings", accept: { "application/json": [".json"] } }],
};

/** Replace the current settings (from the defaults file or a user file). */
function applySettings(settings, label) {
  state.settings = workingSettings(settings, state.defaults);
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
        ...SETTINGS_PICKER,
        suggestedName: `${suggested}.json`,
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

async function loadUserSettings() {
  const use = async (file) => {
    if (state.settingsModified && !confirm(`Load “${file.name}”? Changes you have not saved to a file will be lost.`)) return;
    try {
      const { name, settings } = parseSettingsFile(await file.text());
      applySettings(settings, name || file.name.replace(/\.json$/i, ""));
    } catch (err) {
      alert(`Could not load ${file.name}: ${err.message}`);
    }
  };
  if (window.showOpenFilePicker) {
    // Chrome / Edge: opens in the folder last used for settings files (see SETTINGS_PICKER).
    try {
      const [handle] = await window.showOpenFilePicker({ ...SETTINGS_PICKER, multiple: false });
      await use(await handle.getFile());
    } catch (err) {
      if (err.name !== "AbortError") alert(`Could not open the file: ${err.message}`);
    }
    return;
  }
  // Other browsers: the standard file box (the browser decides where it opens).
  const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.remove();
    if (file) await use(file);
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

/*
 * The song library is always data/songs.csv, made and saved with the library builder. Nothing is
 * kept in the browser, so there is never any doubt which library is in use. Until data/songs.csv
 * exists, the page points to the library builder.
 */

function setLibrary(songs, name, problems) {
  state.songs = songs;
  state.library = { name, problems };
  state.result = null;
  renderLibrary();
  renderResults();
  refresh();
}

/** The project library (data/songs.csv), or null if it does not exist yet. */
async function fetchProjectLibrary() {
  try {
    return await loadSongsFromUrl(PROJECT_URL);
  } catch {
    return null;
  }
}

/** Startup: data/songs.csv, or nothing (with directions to the library builder). */
async function loadStartingLibrary() {
  const project = await fetchProjectLibrary();
  if (project) return setLibrary(project.songs, PROJECT_NAME, project.problems);
  setLibrary([], "", []);
}

function renderLibrary() {
  const { name, problems } = state.library;
  const builder = el("a", { href: "library.html", class: "button-link small" }, "Library builder");
  if (!name) {
    // No data/songs.csv yet: the library has to be built (and saved) in the library builder first.
    return fill($("library"),
      el("ul", { class: "msgs" }, el("li", { class: "warning" },
        "No song library yet: data/songs.csv was not found. Build your library from your Spotify playlists in the " +
          "library builder and save it there; the generator then uses it automatically.")),
      el("div", { class: "library-line" }, builder));
  }
  fill($("library"),
    el("div", { class: "library-line" },
      el("span", {}, "Song library: ", el("strong", {}, name), ` — ${state.songs.length} songs, ${rawDances().length} dances`),
      el("button", { type: "button", class: "small", onclick: openLibraryView, disabled: !state.songs.length }, "View library"),
      builder),
    problems.length > 0 &&
      el("details", {},
        el("summary", {}, `${problems.length} row(s) skipped or changed while loading`),
        el("ul", { class: "msgs" }, problems.map((p) => el("li", { class: "warning" }, p))))
  );
}

/* ------------------------------------------------------------ view library */

/**
 * Read-only window listing the loaded song library, with search, a dance filter, song counts per
 * dance, and a note on songs that cannot play with the current settings. Editing and removing songs
 * happen in the library builder.
 */
function openLibraryView() {
  const dialog = $("library-dialog");
  const s = state.settings;
  const m = associationMap(s.associations);
  const used = referencedDances();

  /** Why a song cannot play with the current settings, or "". */
  const problem = (sg) => {
    if (s.minSongSec > 0 && sg.lengthSec < s.minSongSec) return "shorter than the shortest allowed";
    if (s.maxSongSec > 0 && sg.lengthSec > s.maxSongSec) return "longer than the longest allowed";
    if (isUnavailable(sg.id)) return unavailableReason(sg.id);
    if (!sg.dances.some((d) => used.has(m(d)))) return "its dances are not used by the settings";
    return "";
  };
  const rows = state.songs.map((sg) => ({ sg, merged: [...new Set(sg.dances.map(m))], why: problem(sg) }));

  // Songs per dance (after associations), counting only songs that can play.
  const counts = new Map();
  for (const r of rows) if (!r.why) for (const d of r.merged) counts.set(d, (counts.get(d) || 0) + 1);
  const danceNames = [...new Set(rows.flatMap((r) => r.merged))].sort();

  const view = { search: "", dance: "", only: "" }; // only: "" | "can" | "cannot"
  const search = el("input", { type: "text", placeholder: "search title / artist / tag…", "aria-label": "Search the library", style: "flex:1 1 16em" });
  const danceFilter = el("select", { "aria-label": "Show one dance" },
    el("option", { value: "" }, "All dances"),
    danceNames.map((d) => el("option", { value: d }, `${d} (${counts.get(d) || 0})`)));
  // Two "only" boxes that exclude each other: ticking one unticks the other.
  const onlyCan = el("input", { type: "checkbox" });
  const onlyCannot = el("input", { type: "checkbox" });
  const summary = el("p", { class: "muted" });
  const tbody = el("tbody");

  // Sortable columns (heading -> value to sort by); clicking a heading sorts, clicking again reverses.
  const columns = {
    "Title": (r) => r.sg.title,
    "Artist": (r) => r.sg.artist,
    "Length": (r) => r.sg.lengthSec,
    "Dances": (r) => r.sg.dances.join(", "),
    "Tags": (r) => (r.sg.tags || []).join(", "),
    "Cannot play because": (r) => r.why,
  };
  view.sort = { key: null, dir: 1 };
  const headerRow = el("tr");
  const drawHeader = () => fill(headerRow, Object.keys(columns).map((label) =>
    sortHeader(label, label, view.sort, (sort) => {
      view.sort = sort;
      drawHeader();
      draw();
    })));

  const draw = () => {
    const q = view.search.toLowerCase();
    const shown = sortRows(rows.filter((r) =>
      (!view.dance || r.merged.includes(view.dance)) &&
      (view.only !== "can" || !r.why) &&
      (view.only !== "cannot" || r.why) &&
      `${r.sg.title} ${r.sg.artist || ""} ${(r.sg.tags || []).join(" ")}`.toLowerCase().includes(q)), view.sort, columns);
    summary.textContent = `Showing ${Math.min(shown.length, 1000)} of ${shown.length} matching songs (${rows.length} in the library).`;
    fill(tbody, shown.slice(0, 1000).map((r) =>
      el("tr", { class: r.why ? "cannot-play" : null },
        el("td", {}, r.sg.title),
        el("td", { class: "muted" }, r.sg.artist || ""),
        el("td", { class: "num" }, hms(r.sg.lengthSec)),
        el("td", { title: r.merged.join(", ") !== r.sg.dances.join(", ") ? `Counts as: ${r.merged.join(", ")}` : null }, r.sg.dances.join(", ")),
        el("td", {}, (r.sg.tags || []).join(", ")),
        el("td", { class: "muted" }, r.why))));
  };
  search.addEventListener("input", () => { view.search = search.value; draw(); });
  danceFilter.addEventListener("change", () => { view.dance = danceFilter.value; draw(); });
  const setOnly = (box, other, value) => {
    if (box.checked) other.checked = false;
    view.only = box.checked ? value : "";
    draw();
  };
  onlyCan.addEventListener("change", () => setOnly(onlyCan, onlyCannot, "can"));
  onlyCannot.addEventListener("change", () => setOnly(onlyCannot, onlyCan, "cannot"));
  drawHeader();
  draw();

  const cannot = rows.filter((r) => r.why).length;
  fill(dialog,
    el("div", { class: "dialog-head" },
      el("h2", {}, `Song library: ${state.library.name}`),
      el("button", { type: "button", onclick: () => dialog.close() }, "Close")),
    el("p", { class: "help" },
      `${rows.length} songs. ` + (cannot ? `${cannot} cannot play with the current settings (marked below). ` : "") +
        "Click a column heading to sort by it (click again to reverse). To change or remove songs, use the library builder."),
    el("details", {},
      el("summary", {}, "Songs per dance (playable songs, after associations)"),
      el("div", { class: "chips" }, [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) =>
        el("button", { type: "button", class: "chip count-chip", onclick: () => { danceFilter.value = d; view.dance = d; draw(); } }, `${d} · ${n}`)))),
    el("div", { class: "inline-fields" }, search, danceFilter,
      el("label", { class: "inline-fields" }, onlyCan, "Only songs that can play"),
      el("label", { class: "inline-fields" }, onlyCannot, "Only songs that cannot play")),
    summary,
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, headerRow),
        tbody)));
  dialog.showModal();
}

/* ----------------------------------------------------------------- results */

/*
 * The playlist can be edited by hand and is checked on Spotify; the logic for both lives in
 * js/playlist-edit.js and js/playlist-check.js. This file shows the results and calls them.
 */

function generate() {
  clearTimeout(validateTimer);
  renderValidation();
  if (state.errors.length) return;
  if (hasEdits(state.result) && !confirm("Generate a new playlist? Your swaps, insertions and removals in the current one will be lost.")) return;
  // Always a fresh random playlist; songs known to be unavailable on Spotify are never picked.
  const r = generatePlaylist(state.songs, { ...state.settings, seed: null }, { songFilter: (sg) => !isUnavailable(sg.id) });
  state.result = prepareGenerated(r, state.settings);
  state.stale = false;
  renderResults();
  // Check the new playlist's songs on Spotify (and replace unavailable ones), if logged in.
  if (isLoggedIn() && activeItems(r).some((it) => spotifyTrackId(it.song.id))) checkPlaylistOnSpotify(r);
}

/* ------------------------------------------- check the playlist on Spotify */

/** Check the playlist on Spotify (see js/playlist-check.js), showing progress, then redraw. */
async function checkPlaylistOnSpotify(r, force = false) {
  r.check = { running: true, done: 0, total: activeItems(r).filter((it) => spotifyTrackId(it.song.id)).length };
  renderResults();
  const stillCurrent = () => state.result === r;
  const done = await checkAndReplace(r, state.songs, state.settings, {
    stillCurrent,
    force, // "Check again" looks up every song; after generating, recently checked songs are skipped
    onProgress: (n, total) => {
      r.check.done = n;
      const progress = $("check-progress");
      if (progress) progress.textContent = `Checking songs on Spotify… ${n} of ${total}`;
    },
  });
  if (done && stillCurrent()) renderResults();
}

/** Check one song a user swapped or inserted (no automatic replacement: the user chose it). */
function checkChosenSong(song) {
  const r = state.result;
  if (!isLoggedIn() || !spotifyTrackId(song.id) || isChecked(song.id)) return;
  checkSongs([song.id]).then(() => state.result === r && renderResults());
}

/** The "checked on Spotify" line under the playlist summary. */
function spotifyCheckLine(r) {
  const withIds = activeItems(r).filter((it) => spotifyTrackId(it.song.id));
  if (!withIds.length) return null;
  const c = r.check;
  if (c && c.running) return el("p", { class: "muted", id: "check-progress" }, `Checking songs on Spotify… ${c.done} of ${c.total}`);
  const again = (label) => el("button", { type: "button", class: "small", onclick: () => {
    if (isLoggedIn()) return checkPlaylistOnSpotify(r, true);
    r.checkAfterLogin = true;
    try {
      sessionStorage.setItem(PENDING_RESULT_KEY, JSON.stringify(r));
    } catch {
      /* too large or unavailable */
    }
    spotifyLogin();
  } }, label);
  if (!c) {
    return el("p", { class: "inline-fields muted" }, "These songs have not been checked on Spotify yet.",
      again(isLoggedIn() ? "Check on Spotify" : "Log in and check on Spotify"));
  }
  const unchecked = c.unchecked || 0;
  const parts = [`Checked on Spotify: ${c.total} songs.`];
  if (!c.replaced && !c.unresolved && !unchecked) parts.push("All of them can be played.");
  if (c.replaced) parts.push(`${c.replaced} unavailable song(s) were replaced with available ones of the same dance (marked below).`);
  if (c.unresolved) parts.push(`${c.unresolved} unavailable song(s) could not be replaced (marked below); swap or remove them.`);
  if (!unchecked) return el("p", { class: "inline-fields muted" }, parts.join(" "), again("Check again"));
  // Songs Spotify did not answer for are NOT known to be playable: say so clearly.
  // Spotify often does not say how long the limit lasts (browsers hide that part of its answer).
  const wait = c.rateLimited && c.rateLimited.retryAfter ? ` in about ${Math.ceil(c.rateLimited.retryAfter / 60)} minute(s)`
    : c.rateLimited ? " later; Spotify does not say how long the limit lasts, so an hour is a safe start" : " later";
  return el("ul", { class: "msgs" }, el("li", { class: "warning" },
    `${parts.join(" ")} ${unchecked} song(s) could not be checked` +
      (c.rateLimited ? " because Spotify is limiting requests right now" : "") +
      ` (marked below), so they may not play. Try “Check again”${wait}. `,
    again("Check again")));
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
  const active = activeItems(r);
  const diff = r.totalSec - r.targetSec;
  const removedCount = r.playlist.length - active.length;

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
    active.map((it, i) => `${i + 1}. ${it.song.title}${it.song.artist ? ` – ${it.song.artist}` : ""} (${it.dance})`).join("\n"));

  // Spotify links, in playlist order. Songs without a real Spotify ID are left out (and reported).
  const links = active.map((it) => spotifyLink(it.song.id));
  const linkCount = links.filter(Boolean).length;
  const missingLinks = active.filter((it, i) => !links[i]);
  const copyLinks = copyButton("Copy Spotify links", () => links.filter(Boolean).join("\n"), `Copied ${linkCount} links!`);
  if (!linkCount) {
    copyLinks.disabled = true;
    copyLinks.title = "No song in this playlist has a Spotify track ID.";
  }

  const download = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    downloadFile(`playlist-${stamp}.csv`, playlistToCSV(activeResult(r)), "text/csv");
  };

  const kindLabel = (it) =>
    it.blockTag ? `${it.blockTag} block${it.kind === "regular" && it.category ? ` (${it.category})` : ""}`
      : it.kind === "regular" ? it.category
      : it.kind === "excursion" ? "Excursion"
      : it.kind === "theme" ? it.source
      : it.kind === "fixed" ? it.source
      : it.kind === "inserted" ? "Added by you"
      : "Last dance";

  /** The generator's warnings name positions from generation time; show today's number instead. */
  const warningPrefix = (w) => {
    if (w.index < 0) return "";
    const now = r.playlist.find((x) => x.genIndex === w.index);
    if (!now) return `#${w.index + 1}: `;
    return now.removed ? "(removed song) " : `#${now.index + 1}: `;
  };

  const small = (label, title, onclick) => el("button", { type: "button", class: "small", title, "aria-label": title, onclick }, label);
  /** Buttons that undo a manual change (Reset, Remove an inserted song, Restore) look different. */
  const undo = (label, title, onclick) => el("button", { type: "button", class: "small undo", title, "aria-label": title, onclick }, label);
  const activeRow = (it) => {
    const name = `#${it.index + 1} ${it.song.title}`;
    return el("tr", { class: [it.kind, it.blockTag && "block", it.swapped && "swapped", it.inserted && "inserted"].filter(Boolean).join(" ") },
      el("td", { class: "num" }, String(it.index + 1)),
      el("td", { class: "num" }, hms(it.startSec)),
      el("td", { title: it.song.sourceDances ? `Tagged: ${it.song.sourceDances.join(", ")}` : null }, it.dance),
      el("td", { class: "type" }, kindLabel(it)),
      el("td", {}, it.song.title, it.song.artist && el("span", { class: "muted" }, ` – ${it.song.artist}`),
        it.swapped && el("span", { class: "swap-note", title: `The generator chose: ${it.original.song.title}` }, " (swapped)"),
        it.autoReplaced && !it.swapped && el("div", { class: "muted", style: "font-size:0.85em" },
          `Replaced “${it.autoReplaced.title}” (${it.autoReplaced.why}).`),
        isUnavailable(it.song.id) && el("div", { class: "swap-warning" }, `Warning: ${unavailableReason(it.song.id)}.`),
        checkFailed(it.song.id) && el("div", { class: "swap-warning" }, "Warning: could not be checked on Spotify, so it may not play.")),
      el("td", { class: "num" }, hms(it.song.lengthSec)),
      themed && el("td", { class: "theme-mark" }, it.isTheme ? "Yes" : ""),
      el("td", {}, el("div", { class: "row-actions" },
        small("Swap", `Choose a different song for ${name}`, () => openSongPicker({ item: it })),
        it.swapped && undo("Reset", `Put back the generator's song (${it.original.song.title})`, () => doResetSwap(it)),
        small("Insert before…", `Insert a song before ${name}`, () => openSongPicker({ insertAt: r.playlist.indexOf(it) })),
        small("Insert after…", `Insert a song after ${name}`, () => openSongPicker({ insertAt: r.playlist.indexOf(it) + 1 })),
        it.inserted
          ? undo("Remove", `Delete ${name} (added by you)`, () => doRemove(it))
          : small("Remove", `Take ${name} out (it can be restored)`, () => doRemove(it)))));
  };
  const removedRow = (it) =>
    el("tr", { class: "removed" },
      el("td", { class: "num" }, "–"),
      el("td", {}),
      el("td", {}, it.dance),
      el("td", { class: "type" }, kindLabel(it)),
      el("td", {}, el("s", {}, it.song.title), " (removed)"),
      el("td", { class: "num" }, hms(it.song.lengthSec)),
      themed && el("td", {}),
      el("td", {}, el("div", { class: "row-actions" },
        undo("Restore", `Put ${it.song.title} back in the playlist`, () => doRestore(it)))));

  fill(box,
    el("ul", { id: "stale", class: "msgs", hidden: !state.stale },
      el("li", { class: "warning" }, "Settings have changed since this playlist was generated.")),
    el("div", { class: "summary" },
      el("span", {}, "Songs: ", el("b", {}, String(active.length)), removedCount ? ` (${removedCount} removed)` : ""),
      el("span", {}, "Length: ", el("b", {}, hms(r.totalSec)), ` (target ${hms(r.targetSec)}, ${diff >= 0 ? "+" : ""}${hms(diff)})`),
      themed && el("span", {}, "Theme share: ", el("b", {}, pct(r.stats.themeFraction)))),
    spotifyCheckLine(r),
    el("div", { class: "result-actions" },
      el("button", { type: "button", class: "primary", onclick: generate, disabled: state.errors.length > 0 }, "Generate another"),
      copyLinks,
      copyList,
      el("button", { type: "button", onclick: download }, "Download CSV")),
    linkCount > 0 && saveToSpotifyBox(activeResult(r), links.filter(Boolean).map(spotifyTrackId)),
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
        r.warnings.map((w) => el("li", { class: "warning" }, warningPrefix(w) + w.message))),
    (r.editViolations || []).length > 0 &&
      el("ul", { class: "msgs" },
        r.editViolations.map((v) => el("li", { class: "warning" }, `After your changes: ${v.index >= 0 ? `#${v.index + 1}: ` : ""}${v.message}`))),
    el("div", { class: "edit-bar" },
      el("p", { class: "help" }, "Change the playlist with the buttons on each row. Every change can be undone: Reset puts back " +
        "the generator's song, and removed songs stay listed (small) so you can Restore them."),
      hasEdits(r) && el("button", { type: "button", class: "undo", onclick: doResetAll,
        title: "Undo every swap, insertion and removal: back to exactly the playlist the generator made" }, "Reset all")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {},
          ["#", "Start", "Dance", "Type", "Title", "Length"].map((h) => el("th", { scope: "col" }, h)),
          themed && el("th", { scope: "col" }, "Theme?"),
          el("th", { scope: "col" }, el("span", { class: "visually-hidden" }, "Change")))),
        el("tbody", {}, r.playlist.map((it) => (it.removed ? removedRow(it) : activeRow(it)))))));
}

/* ------------------------------------------------- edit the playlist by hand */

// The editing itself is in js/playlist-edit.js; these apply it to the current playlist and redraw.
const edited = () => renderResults();
const doSwap = (item, song, dance) => {
  swapSong(state.result, item, song, dance, state.settings);
  edited();
  checkChosenSong(song);
};
const doInsert = (position, song, dance) => {
  insertSong(state.result, position, song, dance, state.settings);
  edited();
  checkChosenSong(song);
};
const doResetSwap = (item) => (resetSwap(state.result, item, state.settings), edited());
const doRemove = (item) => (removeItem(state.result, item, state.settings), edited());
const doRestore = (item) => (restoreItem(state.result, item, state.settings), edited());
function doResetAll() {
  if (!confirm("Undo all your changes and go back to the playlist exactly as the generator made it?")) return;
  resetAll(state.result, state.settings);
  edited();
}

/**
 * Pick a song from the library, to swap into a row (`{ item }`) or to insert (`{ insertAt }`, a
 * position in the playlist). Songs that follow the settings come first; every other song is listed
 * after them with "Warning: <reason>" and can still be picked.
 */
function openSongPicker({ item = null, insertAt = null }) {
  const r = state.result;
  const s = state.settings;
  const m = associationMap(s.associations);
  const swapping = !!item;
  const current = swapping ? item.song : null;
  const position = new Map(activeItems(r).map((x) => [x.song.id, x.index]));
  const merged = (sg) => [...new Set(sg.dances.map(m))];

  // Inserting: optionally narrow to one dance. Swapping: the row's dance.
  const danceNames = [...new Set(state.songs.flatMap(merged))].sort();
  let dance = swapping ? item.dance : "";

  /** Why picking this song would not obey the generator settings (empty = it does). */
  const reasons = (sg) => {
    const out = [];
    if (swapping && !merged(sg).includes(item.dance)) out.push(`a different dance (${merged(sg).join(", ") || "none"})`);
    if (swapping && item.blockTag && !(sg.tags || []).includes(item.blockTag)) out.push(`no "${item.blockTag}" tag (this row is in the ${item.blockTag} block)`);
    if (position.has(sg.id)) out.push(`already in this playlist (#${position.get(sg.id) + 1})`);
    if (!withinLengthLimits(sg, s)) out.push("outside the song length limits");
    if (isUnavailable(sg.id)) out.push(unavailableReason(sg.id));
    return out;
  };
  const closeness = (sg) => (current ? Math.abs(sg.lengthSec - current.lengthSec) : 0);
  const all = state.songs.filter((sg) => !current || sg.id !== current.id).map((sg) => ({ sg, why: reasons(sg) }));
  const sameDanceFirst = (o) => (o.why.some((w) => w.startsWith("a different dance")) ? 1 : 0);
  const legal = all.filter((o) => !o.why.length).sort((a, b) => closeness(a.sg) - closeness(b.sg) || a.sg.title.localeCompare(b.sg.title));
  const illegal = all.filter((o) => o.why.length).sort((a, b) => sameDanceFirst(a) - sameDanceFirst(b) || a.sg.title.localeCompare(b.sg.title));

  const dialog = $("library-dialog");
  const pick = (sg) => {
    dialog.close();
    if (swapping) doSwap(item, sg, dance);
    else doInsert(insertAt, sg, dance);
  };
  const lengthNote = (sg) => {
    const d = sg.lengthSec - (current ? current.lengthSec : 0);
    return d === 0 ? "same length" : `${d > 0 ? "+" : "−"}${hms(Math.abs(d))} to the night`;
  };
  const search = el("input", { type: "text", placeholder: "search title / artist…", "aria-label": "Search songs", style: "flex:1 1 16em" });
  const danceFilter = !swapping && el("select", { "aria-label": "Only this dance" },
    el("option", { value: "" }, "Any dance"), danceNames.map((d) => el("option", { value: d }, d)));
  const tbody = el("tbody");
  const LIMIT = 300;
  const visible = (list) => {
    const q = search.value.toLowerCase();
    return list.filter((o) => (!dance || swapping || merged(o.sg).includes(dance)) && `${o.sg.title} ${o.sg.artist || ""}`.toLowerCase().includes(q));
  };
  const draw = () => {
    const shown = [...visible(legal), ...visible(illegal)];
    fill(tbody,
      shown.slice(0, LIMIT).map(({ sg, why }) =>
        el("tr", { class: why.length ? "not-allowed" : null },
          el("td", {}, el("button", { type: "button", class: "small", onclick: () => pick(sg) }, swapping ? "Use this" : "Insert")),
          el("td", {}, sg.title, why.length > 0 && el("div", { class: "swap-warning" }, `Warning: ${why.join("; ")}.`)),
          el("td", { class: "muted" }, sg.artist || ""),
          el("td", {}, sg.dances.join(", ")),
          el("td", { class: "num" }, hms(sg.lengthSec)),
          el("td", { class: "muted" }, lengthNote(sg)))),
      shown.length > LIMIT && el("tr", {}, el("td", { colspan: 6, class: "muted" }, `…and ${shown.length - LIMIT} more. Use the search box.`)));
  };
  search.addEventListener("input", draw);
  if (danceFilter) danceFilter.addEventListener("change", () => { dance = danceFilter.value; draw(); });
  draw();

  const songsBefore = swapping ? 0 : activeItems({ playlist: r.playlist.slice(0, insertAt) }).length;
  const where = songsBefore === 0 ? "at the start" : `after #${songsBefore}`;
  fill(dialog,
    el("div", { class: "dialog-head" },
      el("h2", {}, swapping ? `Swap #${item.index + 1}: ${item.dance}` : `Insert a song ${where}`),
      el("button", { type: "button", onclick: () => dialog.close() }, "Close")),
    current && el("p", {}, "Now: ", el("strong", {}, current.title), current.artist ? ` – ${current.artist}` : "", ` (${hms(current.lengthSec)})`),
    el("div", { class: "inline-fields" }, search, danceFilter,
      el("button", { type: "button", onclick: () => {
        const options = visible(legal);
        if (!options.length) return alert("No song that follows the settings matches; pick one from the list instead.");
        pick(options[Math.floor(Math.random() * options.length)].sg);
      } }, "Pick one for me")),
    el("p", { class: "help" },
      (swapping
        ? `Other ${item.dance} songs that follow the settings come first, closest in length first. `
        : "Songs that follow the settings (not already in the playlist, inside the length limits) come first. ") +
        "Every other song is listed after them with a warning; you can still pick one."),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["", "Title", "Artist", "Dances", "Length", "Change"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)));
  dialog.showModal();
  search.focus();
}

/* --------------------------------------------------------- save to Spotify */

const PENDING_RESULT_KEY = "dpg.pendingResult.v1";

/**
 * The "Save to Spotify" box: creates a playlist in the logged-in account with the generated songs,
 * in order. If not logged in, offers to log in first (the playlist is kept across the login trip).
 * Copy Spotify links remains the fallback if Spotify refuses.
 */
function saveToSpotifyBox(r, trackIds) {
  if (!isLoggedIn()) {
    return el("div", { class: "subbox" },
      el("div", { class: "subbox-title" }, "Save to Spotify"),
      el("p", { class: "help" }, "Log in to Spotify to create this playlist in your account. This playlist is kept while you log in."),
      el("div", {}, el("button", { type: "button", onclick: () => {
        try {
          sessionStorage.setItem(PENDING_RESULT_KEY, JSON.stringify(r));
        } catch {
          /* too large or unavailable: the playlist will need generating again */
        }
        spotifyLogin();
      } }, "Log in with Spotify")));
  }

  const today = new Date().toISOString().slice(0, 10);
  const name = el("input", { type: "text", value: `Dance social ${today}`, "aria-label": "Playlist name", style: "flex:1 1 16em" });
  const isPublic = el("input", { type: "checkbox" });
  const status = el("div", { "aria-live": "polite" });
  // Wait for the Spotify check (and its replacements) before the playlist can be created.
  const checking = !!(state.result && state.result.check && state.result.check.running);
  const create = el("button", { type: "button", class: "primary", disabled: checking,
    title: checking ? "Waiting for the Spotify check to finish" : null }, `Create playlist (${trackIds.length} songs)`);
  const say = (kind, ...content) => fill(status, el("ul", { class: "msgs" }, el("li", { class: kind }, ...content)));
  const openLink = (url) => url && el("a", { href: url, target: "_blank", rel: "noopener" }, "Open in Spotify");
  const fallback = " You can still use “Copy Spotify links” and paste them into a playlist by hand.";

  create.addEventListener("click", async () => {
    const title = name.value.trim();
    if (!title) return name.focus();
    create.disabled = true;
    fill(status, el("p", { class: "muted" }, "Creating the playlist…"));
    let playlist;
    try {
      playlist = await createPlaylist({
        name: title,
        isPublic: isPublic.checked,
        description: `Made with Dance Playlist Generator on ${today}: ${trackIds.length} songs, ${hms(r.totalSec)}.`,
      });
    } catch (err) {
      create.disabled = false;
      const hint = err.status === 403
        ? " Spotify refused (403). Check that your account is listed under User Management in the Spotify developer dashboard, then log out and in again."
        : "";
      return say("error", `Could not create the playlist: ${err.message}.${hint}${fallback}`);
    }
    try {
      await addTracksToPlaylist(playlist.id, trackIds, (n, total) => fill(status, el("p", { class: "muted" }, `Adding songs… ${n} of ${total}`)));
    } catch (err) {
      return say("error", `The playlist “${title}” was created, but adding its songs failed: ${err.message}.${fallback} `, openLink(playlist.url));
    }
    say("ok", `Created “${title}” in your Spotify account with ${trackIds.length} songs, in order. `, openLink(playlist.url));
  });

  return el("div", { class: "subbox" },
    el("div", { class: "subbox-title" }, "Save to Spotify"),
    el("div", { class: "inline-fields" }, "Name:", name),
    el("label", { class: "inline-fields" }, isPublic, "Public (shows on your Spotify profile); otherwise private"),
    el("div", { class: "inline-fields" }, create,
      checking && el("span", { class: "muted" }, "Waiting for the Spotify check to finish…")),
    status);
}

/**
 * After a login trip started from the results ("Save to Spotify" or "Log in and check"), bring the
 * generated playlist back, and check its songs on Spotify if that has not happened yet.
 */
function restorePendingResult() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PENDING_RESULT_KEY));
    sessionStorage.removeItem(PENDING_RESULT_KEY);
  } catch {
    /* nothing to restore */
  }
  if (saved && Array.isArray(saved.playlist)) {
    if (saved.check && saved.check.running) delete saved.check; // a check cut short by the login trip
    delete saved.checkAfterLogin;
    state.result = saved;
    state.stale = false;
    renderResults();
    if (isLoggedIn() && !saved.check) checkPlaylistOnSpotify(saved);
  }
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
  state.settings = workingSettings(last && last.settings, state.defaults);
  state.settingsLabel = (last && last.label) || DEFAULTS_LABEL;
  state.settingsModified = !!(last && last.modified);

  renderSettingsBar();
  renderForm();
  await loadStartingLibrary();
  restorePendingResult();
}

init();
