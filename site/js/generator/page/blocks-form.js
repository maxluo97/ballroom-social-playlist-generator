// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * blocks-form.js — the settings sections for special blocks (the agreed spec, docs/history.md, v0.4) and must-play
 * songs (docs/history.md, v0.2.5), and the "find songs" chooser they share.
 */

import { associationMap, BLOCK_DEFAULTS, blockLabel } from "../generator.js";
import { workKey, workName } from "../../shared/works.js";
import { clone } from "../../shared/settings.js";
import { el, fill, comboInput } from "../../shared/dom.js";
import { state, changed, live, formatDuration, resolvedDances, allTags, settingDances, onlyDances } from "./page-state.js";
import { numberInput, textInput, percentSlider, chipEditor, removeButton, section } from "./form-controls.js";

/**
 * A list of chosen songs (`owner[key]`: Spotify IDs), with a search to find and add more: by tag, dance,
 * category, work or title / artist. `ordered`: the order matters (a chosen-songs block plays them in
 * order), so songs can be moved up and down.
 */
function chosenSongsEditor(settings, owner, key = "songs", ordered = true) {
  const toGroup = associationMap(settings.associations);
  const dancesOf = (song) => [...new Set(song.dances.map(toGroup))];
  const songById = new Map(state.songs.map((song) => [song.id, song]));
  // The library's works, by name.
  const songsOfWork = new Map();
  for (const song of state.songs) {
    const work = workKey(song);
    if (!songsOfWork.has(work)) songsOfWork.set(work, []);
    songsOfWork.get(work).push(song);
  }
  const workByName = new Map([...songsOfWork].map(([work, songs]) => [workName(songs), work]));
  const filters = { tag: "", dance: "", category: "", work: "", text: "" };
  const filterSelect = (label, values, filterKey) => {
    const node = el("select", { "aria-label": label, onchange: () => { filters[filterKey] = node.value; drawResults(); } },
      el("option", { value: "" }, `Any ${label.toLowerCase()}`), values.map((value) => el("option", { value }, value)));
    return node;
  };
  const workBox = comboInput({ placeholder: "any work", "aria-label": "Work" }, () => [...workByName.keys()].sort(), (value) => {
    workBox.input.value = value;
    filters.work = value;
    drawResults();
  });
  workBox.input.addEventListener("input", () => { filters.work = workBox.input.value; drawResults(); });
  const textBox = el("input", { type: "text", placeholder: "title / artist…", "aria-label": "Search title or artist",
    oninput: () => { filters.text = textBox.value.toLowerCase(); drawResults(); } });
  const results = el("ul", { class: "pick-list" });
  const chosenList = el("ol", { class: "chosen-list" });
  const songName = (song) => `${song.title}${song.artist ? ` — ${song.artist}` : ""}`;

  const matches = (song) => {
    if (owner[key].includes(song.id)) return false;
    const dances = dancesOf(song);
    if (filters.tag && !(song.tags || []).includes(filters.tag)) return false;
    if (filters.dance && !dances.includes(filters.dance)) return false;
    if (filters.category) {
      const category = settings.categories.find((candidate) => candidate.name === filters.category);
      if (!category || !dances.some((dance) => category.dances.map(toGroup).includes(dance))) return false;
    }
    if (filters.work) {
      const work = workByName.get(filters.work);
      if (work ? workKey(song) !== work : !workName(songsOfWork.get(workKey(song))).toLowerCase().includes(filters.work.toLowerCase())) return false;
    }
    if (filters.text && !`${song.title} ${song.artist || ""}`.toLowerCase().includes(filters.text)) return false;
    return true;
  };
  const save = () => {
    drawChosen();
    drawResults();
    changed();
  };
  const MAX_RESULTS = 40;
  function drawResults() {
    const found = state.songs.filter(matches);
    fill(results, found.slice(0, MAX_RESULTS).map((song) =>
      el("li", {}, el("button", { type: "button", class: "small", "aria-label": `Add ${song.title}`, onclick: () => {
        owner[key].push(song.id);
        save();
      } }, "+"), " ", songName(song), el("span", { class: "muted" }, ` · ${dancesOf(song).join(", ")} · ${formatDuration(song.lengthSec)}`))),
      found.length > MAX_RESULTS && el("li", { class: "muted" }, `…and ${found.length - MAX_RESULTS} more: narrow the search.`),
      !found.length && el("li", { class: "muted" }, "No songs match."));
  }
  function drawChosen() {
    const move = (iSong, by) => {
      const [moved] = owner[key].splice(iSong, 1);
      owner[key].splice(iSong + by, 0, moved);
      save();
    };
    fill(chosenList, owner[key].length ? owner[key].map((id, iSong) => {
      const song = songById.get(id);
      return el("li", {},
        song ? songName(song) : el("span", { class: "swap-warning" }, `Warning: a song that is not in the library (${id})`),
        song && el("span", { class: "muted" }, ` · ${dancesOf(song).join(", ")}`), " ",
        ordered && el("button", { type: "button", class: "icon", title: "Move up", "aria-label": "Move up", disabled: iSong === 0, onclick: () => move(iSong, -1) }, "↑"),
        ordered && el("button", { type: "button", class: "icon", title: "Move down", "aria-label": "Move down", disabled: iSong === owner[key].length - 1, onclick: () => move(iSong, 1) }, "↓"),
        removeButton(song ? song.title : id, () => {
          owner[key].splice(iSong, 1);
          save();
        }));
    }) : [el("li", { class: "muted" }, "No songs chosen yet: find them below.")]);
  }
  drawChosen();
  drawResults();
  const categoryNames = settings.categories.map((category) => category.name).filter(Boolean);
  return el("div", { class: "subbox" },
    el("div", { class: "label" }, ordered ? `Chosen songs (${owner[key].length ? "in playing order" : "none yet"})` : `Songs (${owner[key].length})`),
    chosenList,
    el("div", { class: "label" }, "Find songs"),
    el("div", { class: "inline-fields" },
      filterSelect("Tag", allTags(), "tag"), filterSelect("Dance", resolvedDances(), "dance"), filterSelect("Category", categoryNames, "category"),
      workBox.wrap, textBox),
    results);
}

/** Must-play songs (the agreed spec, docs/history.md, v0.2.5). */
export function mustPlaySection(settings) {
  settings.mustPlay ??= [];
  return section(
    "Must-play songs",
    live(() => `${settings.mustPlay.length} song(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "Songs that must play, spread evenly through the night after the opening, in random order. " +
        "Each plays where it fits the rules; a song plays only if its dance is in a category or is an excursion. " +
        "They may break the song length limits."),
    chosenSongsEditor(settings, settings, "mustPlay", false)
  );
}

/** Special blocks (the agreed spec, docs/history.md, v0.4): from dances, a tag, or chosen songs. */
export function blocksSection(settings) {
  settings.specialBlocks ??= [];
  const rows = settings.specialBlocks.map((block, iBlock) => {
    // A block from an older settings file may lack some fields: fill them in.
    block.placement = { ...BLOCK_DEFAULTS.placement, ...(block.placement || {}) };
    block.interruptBy = { ...BLOCK_DEFAULTS.interruptBy, ...(block.interruptBy || {}) };
    block.dances ??= [];
    block.songs ??= [];
    block.notAfter ??= [];
    block.inTurns ??= true;
    const placement = block.placement;
    const interruptBy = block.interruptBy;
    const select = (value, options, onChange, label) => {
      const node = el("select", { "aria-label": label, onchange: () => onChange(node.value) },
        options.map(([optionValue, text]) => el("option", { value: optionValue, selected: optionValue === value }, text)));
      return node;
    };
    const tick = (checked, onChange, text) =>
      el("label", { class: "inline-fields" }, el("input", { type: "checkbox", checked, onchange: (event) => onChange(event.target.checked) }), text);
    const placementFields =
      placement.mode === "at" ? el("div", { class: "inline-fields" }, "At", percentSlider(() => placement.at, (value) => (placement.at = value)), "of the night")
        : placement.mode === "window" ? el("div", {},
          el("div", { class: "inline-fields" }, "From", percentSlider(() => placement.from, (value) => (placement.from = value))),
          el("div", { class: "inline-fields" }, "to", percentSlider(() => placement.to, (value) => (placement.to = value)), "of the night"))
          : el("p", { class: "help" }, "Somewhere after the opening songs and before the last 15% of the night, different every time.");
    const source = block.source || "tag";
    const songCount = el("div", { class: "inline-fields" },
      el("label", {}, "Songs", numberInput(() => block.count, (value) => (block.count = value), { min: 1, max: 20 })));
    const songsFrom =
      source === "songs" ? chosenSongsEditor(settings, block)
        : source === "dances" ? el("div", {},
          el("div", { class: "inline-fields" }, "Dance(s):",
            chipEditor(block.dances, resolvedDances, { ...onlyDances(settingDances), placeholder: "add a dance…", label: `Add a dance to ${blockLabel(block)}` })),
          songCount)
          : el("div", {},
            el("div", { class: "inline-fields" }, "Tag:",
              textInput(() => block.tag, (value) => (block.tag = value), { placeholder: "e.g. Hollywood", suggest: allTags })),
            songCount,
            tick(!!block.inTurns, (value) => {
              block.inTurns = value;
              changed(true);
            }, "Takes part in the category turns"));
    const help =
      source === "dances" ? "Songs of these dances (each song one of them, varied when it can), outside the category turns; e.g. a line-dance break, or one Paso Doble. They are never theme songs."
        : source === "songs" ? "Plays exactly these songs, in this order, outside the category turns. They may break the song length limits."
          : block.inTurns ? "The next songs in the normal category turns, each with the tag."
            : "Any dance with the tag, outside the category turns.";
    const otherBlockNames = () => settings.specialBlocks.filter((other) => other !== block).map(blockLabel);
    return el("div", { class: "row" },
      el("div", { class: "row-head" },
        textInput(() => block.name, (value) => (block.name = value), { placeholder: `Block name, e.g. Line dance break (empty: "${blockLabel({ ...block, name: "" })}")` }),
        removeButton(`special block ${blockLabel(block)}`, () => {
          settings.specialBlocks.splice(iBlock, 1);
          changed(true);
        })),
      el("div", { class: "inline-fields" }, "Songs from:",
        select(source, [["dances", "dances"], ["tag", "a tag"], ["songs", "songs I choose"]], (value) => {
          block.source = value;
          block.keepApart = value === "dances"; // the default for each kind of block
          changed(true);
        }, "Songs from")),
      songsFrom,
      el("p", { class: "help" }, help),
      el("div", { class: "inline-fields" }, "Placement:",
        select(placement.mode, [["at", "At a point"], ["random", "At a random point"], ["window", "At a random point between"]], (value) => {
          placement.mode = value;
          changed(true);
        }, "Placement")),
      placementFields,
      tick(!!block.keepApart, (value) => ((block.keepApart = value), changed()), "Keep apart from other special blocks"),
      el("div", { class: "inline-fields" }, "Never directly after:",
        chipEditor(block.notAfter, () => [...otherBlockNames(), ...resolvedDances()], {
          allowed: () => [...otherBlockNames(), ...settingDances()],
          notAllowed: (value) => `“${value}” is not a known dance or special block.`,
          placeholder: "dance or block…",
          label: `Never directly after (${blockLabel(block)})`,
        })),
      el("div", { class: "inline-fields" }, "May be interrupted by:",
        tick(!!interruptBy.excursions, (value) => ((interruptBy.excursions = value), changed()), "excursions"),
        tick(!!interruptBy.theme, (value) => ((interruptBy.theme = value), changed()), "theme dances in no category")),
      el("div", { class: "inline-fields" }, "After an interruption:",
        select(block.afterInterruption, [["continue", "continue the block"], ["end", "end the block"]], (value) => {
          block.afterInterruption = value;
          changed();
        }, "After an interruption")));
  });
  return section(
    "Special blocks",
    live(() => `${settings.specialBlocks.length} block(s)`, "span", "summary-note"),
    el("p", { class: "help" },
      "A run of songs at one point in the night: songs of chosen dances (e.g. a line-dance break halfway through), songs with a tag " +
        "(e.g. 4 Hollywood songs at 40%), or songs you choose. If too few songs fit, a block is shorter. " +
        "Special blocks never interrupt each other; anything else that may not interrupt a block waits until it ends."),
    el("div", { class: "rows" }, rows),
    el("div", {}, el("button", { type: "button", class: "small", onclick: () => {
      settings.specialBlocks.push({ ...clone(BLOCK_DEFAULTS), source: "dances", count: 3, keepApart: true });
      changed(true);
    } }, "+ Add special block"))
  );
}
