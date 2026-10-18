// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * settings-form.js — the generator page's settings form, section by section, and the settings check's
 * errors and warnings below it. (Special blocks and must-play songs are in blocks-form.js.)
 */

import { validateSettings, withinLengthLimits, themeMinGapFor, themeMinGapApplies } from "../generator.js";
import { THEME_TEMPLATE, clone } from "../../shared/settings.js";
import { el, $, comboInput } from "../../shared/dom.js";
import { canonicalDance, unknownDanceMessage } from "../../shared/dance-names.js";
import {
  state, changed, live, addLiveUpdater, resetLiveUpdaters, formatDuration,
  rawDances, resolvedDances, allTags, referencedDances, associationOf, dancesNotInAnAssociation, dancesNotInACategory,
  categoryOf, dancesForExcursions, associationNameIdeas, renameEverywhere, settingDances, libraryDanceNames, onlyDances,
} from "./page-state.js";
import { field, numberInput, textInput, percentSlider, lengthInput, selectInput, chipEditor, removeButton, section } from "./form-controls.js";
import { blocksSection, mustPlaySection } from "./blocks-form.js";

/** Draw the whole settings form (again), from state.settings. */
export function renderForm() {
  resetLiveUpdaters();
  const settings = state.settings;
  $("settings-form").replaceChildren(
    basicsSection(settings),
    associationsSection(settings),
    categoriesSection(settings),
    repetitionSection(settings),
    excursionsSection(settings),
    blocksSection(settings),
    mustPlaySection(settings),
    themeSection(settings),
    openingSection(settings)
  );
}

/** The settings check: errors (generating is then off) and warnings, below the form. */
export function renderValidation() {
  const { errors, warnings } = state.songs.length
    ? validateSettings(state.songs, state.settings)
    : { errors: ["No song library is loaded."], warnings: [] };
  state.errors = errors;
  $("generate").disabled = errors.length > 0 || !state.songs.length;
  $("validation").replaceChildren(
    ...(errors.length || warnings.length
      ? [el("ul", { class: "msgs" },
          errors.map((error) => el("li", { class: "error" }, error)),
          warnings.map((warning) => el("li", { class: "warning" }, warning)))]
      : [])
  );
}

/* --------------------------------------------------------------- sections */

function basicsSection(settings) {
  return section(
    "Event basics",
    null,
    field(
      "Event length",
      el("span", { class: "inline-fields" },
        numberInput(() => settings.eventLengthMinutes, (value) => (settings.eventLengthMinutes = value), { min: 10, max: 720, step: 5 }),
        "minutes",
        live(() => `(${formatDuration(settings.eventLengthMinutes * 60)})`, "span", "muted"))
    ),
    field("Shortest song allowed", lengthInput(() => settings.minSongSec, (value) => (settings.minSongSec = value))),
    field("Longest song allowed", lengthInput(() => settings.maxSongSec, (value) => (settings.maxSongSec = value)),
      live(() => {
        const how = "Type minutes:seconds (2:30) or just seconds (150 becomes 2:30). Leave blank for no limit.";
        if (!(settings.minSongSec > 0) && !(settings.maxSongSec > 0)) return how;
        const fitCount = state.songs.filter((song) => withinLengthLimits(song, settings)).length;
        return `${how} ${fitCount} of ${state.songs.length} songs in the library fit these limits.`;
      }, "span", ""))
  );
}

function associationsSection(settings) {
  const rows = settings.associations.map((association, iAssociation) =>
    el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => association.name, (value) => (association.name = value.trim()), {
          placeholder: "Merged name, e.g. Waltz",
          suggest: associationNameIdeas,
          commitOnly: true,
          onCommit: (value) => {
            const oldName = association.name;
            association.name = value.trim();
            if (oldName && association.name && oldName !== association.name) renameEverywhere(oldName, association.name);
            // By default an association includes its own name (e.g. "Waltz" also covers songs
            // tagged plain "Waltz"). Keep that chip in step with renames; it can be removed.
            if (!oldName || association.dances.includes(oldName)) {
              association.dances = association.dances.filter((dance) => dance !== oldName);
              if (association.name && !association.dances.includes(association.name)) association.dances.unshift(association.name);
            }
            changed(true);
          },
        }),
        removeButton(`association ${association.name}`, () => {
          settings.associations.splice(iAssociation, 1);
          changed(true);
        })),
      chipEditor(association.dances, dancesNotInAnAssociation, {
        ...onlyDances(libraryDanceNames),
        placeholder: "add a dance…",
        label: `Add a dance to ${association.name}`,
        check: (dance) => {
          const owner = associationOf(dance);
          return owner && owner !== association ? `${dance} is already in the association “${owner.name}”.` : null;
        },
      }))
  );
  return section(
    "Dance associations",
    live(() => `${settings.associations.length} group(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "Treat several dances as one. Example: “Waltz” = Smooth Waltz + Standard Waltz: a song tagged with any of them " +
        "can play as a Waltz, and the generator counts them as the same dance when it spaces out repeats. " +
        "Dances not in a group keep their own names. A group with a single dance just renames it."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      settings.associations.push({ name: "", dances: [] });
      state.openSections.add("Dance associations");
      changed(true);
    } }, "+ Add association")),
    live(() => {
      const libraryDances = rawDances();
      const inAGroup = new Set(settings.associations.flatMap((association) => [association.name, ...association.dances]));
      const loose = libraryDances.filter((dance) => !inAGroup.has(dance));
      return `The library has ${libraryDances.length} dances; after associations there are ${resolvedDances().length}. ` +
        (loose.length ? `Not in any association: ${loose.join(", ")}.` : "");
    })
  );
}

function categoriesSection(settings) {
  const rows = settings.categories.map((category, iCategory) =>
    el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => category.name, (value) => (category.name = value), { placeholder: "Category name, e.g. Latin" }),
        removeButton(`category ${category.name}`, () => {
          settings.categories.splice(iCategory, 1);
          changed(true);
        })),
      chipEditor(category.dances, dancesNotInACategory, {
        ...onlyDances(settingDances),
        placeholder: "add a dance…",
        label: `Add a dance to ${category.name}`,
        check: (dance) => {
          const owner = categoryOf(dance);
          return owner ? `${dance} is already in ${owner === category ? "this category" : `“${owner.name}”`}.` : null;
        },
      }))
  );
  return section(
    "Categories and dances",
    live(() => `${settings.categories.length} categor${settings.categories.length === 1 ? "y" : "ies"}`, "span", "summary-note"),
    el("p", { class: "help" }, "The night alternates between categories in short blocks (see Repetition). Within a category, " +
      "every dance plays once before any of them repeats. Each dance can belong to only one category."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      settings.categories.push({ name: `Category ${settings.categories.length + 1}`, dances: [] });
      changed(true);
    } }, "+ Add category")),
    live(() => {
      const used = referencedDances();
      const unused = resolvedDances().filter((dance) => !used.has(dance));
      return unused.length
        ? `Not used anywhere (categories, excursions, special blocks, final dance): ${unused.join(", ")}.`
        : "Every dance in the library is used somewhere.";
    })
  );
}

function repetitionSection(settings) {
  return section(
    "Repetition",
    null,
    field("Max in a row", numberInput(() => settings.maxInARow, (value) => (settings.maxInARow = value), { min: 1, max: 10 }),
      "The most songs in a row from one category before switching. Each block is a random length from 1 up to this."),
    field("Songs between repeats", numberInput(() => settings.minToRepeat, (value) => (settings.minToRepeat = value), { min: 0, max: 20 }),
      "At least this many other songs between two songs of the same dance."),
    el("label", { class: "inline-fields" },
      el("input", { type: "checkbox", checked: settings.noRepeatWorks ?? true, onchange: (event) => {
        settings.noRepeatWorks = event.target.checked;
        changed();
      } }),
      "No two versions of the same song in one night"),
    el("p", { class: "help" },
      "Versions are recognized by title (e.g. a cover, a live version or a remaster); fix mistakes in the library builder. " +
        "The same recording under another Spotify ID never plays twice, whatever this says.")
  );
}

function excursionsSection(settings) {
  const excursions = settings.excursions;
  // The dropdown leaves out dances that are already excursions or belong to a category; picking one adds it.
  const { wrap: addWrap, input: addBox } = comboInput({ placeholder: "dance to add…", "aria-label": "Excursion dance to add" },
    dancesForExcursions, (value) => { addBox.value = value; addDance(); });
  const addDance = () => {
    const typed = canonicalDance(addBox.value);
    if (!typed) return;
    const dance = settingDances().find((known) => known.toLowerCase() === typed.toLowerCase());
    if (!dance) {
      addBox.setCustomValidity(unknownDanceMessage(typed));
      addBox.reportValidity();
      return;
    }
    if (!(dance in excursions.pool)) {
      excursions.pool[dance] = 1;
      changed(true);
    }
  };
  addBox.addEventListener("input", () => addBox.setCustomValidity(""));
  addBox.addEventListener("keydown", (event) => event.key === "Enter" && (event.preventDefault(), addDance()));
  const rows = Object.keys(excursions.pool).map((dance) =>
    el("tr", {},
      el("td", {}, dance),
      el("td", {}, numberInput(() => excursions.pool[dance], (value) => (excursions.pool[dance] = value), { min: 0, max: 50 })),
      el("td", {}, removeButton(`excursion ${dance}`, () => {
        delete excursions.pool[dance];
        changed(true);
      })))
  );
  return section(
    "Excursions",
    live(() => `${Object.keys(excursions.pool).length} dance(s), every ${excursions.intervalMinutes} min`, "span", "summary-note"),
    el("p", { class: "help" },
      "Dances outside the categories, played every so often. Max count is how many times a dance can play before " +
        "all the counts start over; a higher count also makes that dance more likely to be picked."),
    field("Every", el("span", { class: "inline-fields" },
      numberInput(() => excursions.intervalMinutes, (value) => (excursions.intervalMinutes = value), { min: 0, max: 240 }), "minutes"),
      "0 turns excursions off."),
    field("Random variation", el("span", { class: "inline-fields" },
      "±", numberInput(() => excursions.jitterMinutes ?? 0, (value) => (excursions.jitterMinutes = value), { min: 0, max: 60 }), "minutes"),
      // The same range the generator uses: interval ± variation, never under 1 minute.
      live(() => {
        const everyMinutes = excursions.intervalMinutes;
        const jitterMinutes = excursions.jitterMinutes || 0;
        if (!(everyMinutes > 0)) return "Excursions are off.";
        if (!jitterMinutes) return `Every ${everyMinutes} minutes`;
        return `Every ${Math.max(1, everyMinutes - jitterMinutes)} to ${everyMinutes + jitterMinutes} minutes`;
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

function themeSection(settings) {
  const toggle = el("input", { type: "checkbox", checked: !!settings.theme, onchange: () => {
    if (toggle.checked) settings.theme = state.themeStash ?? clone(THEME_TEMPLATE);
    else {
      state.themeStash = settings.theme;
      settings.theme = null;
    }
    changed(true);
  } });
  const body = [el("label", { class: "inline-fields" }, toggle, "This event has a theme")];
  if (settings.theme) {
    const theme = settings.theme;
    theme.tags ??= [];
    const shareButton = (label, fractionMin, fractionMax) =>
      el("button", { type: "button", class: "small", onclick: () => {
        theme.fractionMin = fractionMin;
        theme.fractionMax = fractionMax;
        changed(true);
      } }, label);
    body.push(
      field("Theme name", textInput(() => theme.name, (value) => (theme.name = value), { placeholder: "e.g. Roarin' Twenties" })),
      el("div", {}, el("div", { class: "label" }, "Theme dances"), chipEditor(theme.dances, resolvedDances, { ...onlyDances(settingDances), placeholder: "add a dance…", label: "Add a theme dance" })),
      el("div", {}, el("div", { class: "label" }, "Theme song tags"), chipEditor(theme.tags, allTags, { placeholder: "add a tag…", label: "Add a theme tag" })),
      live(() => {
        const tags = allTags();
        return tags.length ? `Tags in the library: ${tags.join(", ")}.` : "No songs in the library have tags.";
      }),
      el("p", { class: "help" }, "A song is a theme song if it is played as a theme dance or has a theme tag. " +
        "The theme share is the part of the night's songs that are theme songs, not counting the opening songs (which are theme songs anyway)."),
      el("div", { class: "inline-fields" }, "Theme share at least", percentSlider(() => theme.fractionMin, (value) => (theme.fractionMin = value))),
      el("div", { class: "inline-fields" }, "Theme share at most", percentSlider(() => theme.fractionMax, (value) => (theme.fractionMax = value))),
      el("div", { class: "inline-fields" }, "Quick set:", shareButton("Broad theme (50–70%)", 0.5, 0.7), shareButton("Dance-focused theme (20–25%)", 0.2, 0.25)),
      el("p", { class: "help" },
        "Broad themes (e.g. Hollywood) match songs of any dance, so a high share is easy to reach. " +
          "Dance-focused themes (e.g. Hustle night) should stay lower so that one dance does not dominate."),
      themeMinGapField(settings, theme)
    );
  }
  return section("Theme", live(() => (settings.theme ? settings.theme.name || "on" : "off"), "span", "summary-note"), ...body);
}

/**
 * The theme minimum gap: only shown when it matters (the theme has tags, or is one dance that is in no
 * category and not an excursion). Until set, it follows the normal gap (minus 2).
 */
function themeMinGapField(settings, theme) {
  const input = numberInput(() => themeMinGapFor(settings), (value) => (theme.minGap = value), { min: 0, max: 20 });
  const node = field("Theme songs may repeat after at least", el("span", { class: "inline-fields" }, input, "songs"),
    "When no theme song fits the normal gap between repeats, the gap may shrink down to this. " +
      "Also the gap for a theme of one dance that is in no category. Default: the normal gap minus 2.");
  addLiveUpdater(() => {
    node.hidden = !themeMinGapApplies(settings);
    if (theme.minGap == null && document.activeElement !== input) input.value = String(themeMinGapFor(settings));
  });
  node.hidden = !themeMinGapApplies(settings);
  return node;
}

function openingSection(settings) {
  return section(
    "Opening and closing",
    null,
    field("Opening length", el("span", { class: "inline-fields" },
      numberInput(() => settings.opening.earlyCount, (value) => (settings.opening.earlyCount = value), { min: 0, max: 30 }), "songs"),
      "The first songs of the night, which avoid the dances listed below (e.g. fast or demanding ones). " +
        "With a theme, they are theme songs too. Theme dances take turns there (never the same one twice in a row, unless there is only one) " +
        "and may open even if listed below."),
    el("div", {}, el("div", { class: "label" }, "Not allowed in the opening"),
      chipEditor(settings.opening.blacklist, "dl-dances", { ...onlyDances(settingDances), placeholder: "add a dance…", label: "Add a dance to the opening blacklist" })),
    field("Last dance of the night",
      selectInput(() => settings.closing.finalDance, (value) => (settings.closing.finalDance = value), resolvedDances, "(none)"))
  );
}
