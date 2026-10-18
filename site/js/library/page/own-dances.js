// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * own-dances.js — your own dances: "Define a new dance…" (the dances the app does not know), kept in
 * this browser. Once a song carries one in your library, it is known from the library anyway.
 */

import { el, fill, $, chipEditor } from "../../shared/dom.js";
import { guessDanceInfo, BALLROOM_STYLES, setCustomDances, newDanceProblem } from "../../shared/dance-names.js";
import { state, redraw, store, errorBox, libraryDances, updateLists } from "./page-state.js";

/** Your own dances: [{ name, style, spellings }]. Read now, so the dance-name guessing knows them from the start. */
const OWN_DANCES_KEY = "dpg.customDances.v1";
const ownDances = store.get(OWN_DANCES_KEY, []);
setCustomDances(ownDances);

function saveOwnDances() {
  store.set(OWN_DANCES_KEY, ownDances);
  setCustomDances(ownDances);
  updateLists();
  // Playlists that had no dance guessed yet may now match one of your dances.
  if (state.playlists) {
    for (const playlist of state.playlists) {
      const choice = state.choices.get(playlist.id);
      if (choice.dances.length || choice.ambiguous.length) continue;
      const { dances, ambiguous, checks } = guessDanceInfo(playlist.name, libraryDances());
      Object.assign(choice, { dances, ambiguous, checks, selected: choice.selected || (dances.length > 0 && !ambiguous.length) });
    }
  }
  redraw.playlists();
  redraw.manual();
}

/** The "Define a new dance…" window: add your own dances, or remove ones you defined. */
function openDanceDialog() {
  const dialog = $("dance-dialog");
  const nameBox = el("input", { type: "text", placeholder: "e.g. Peabody", "aria-label": "Dance name", style: "flex:1 1 14em" });
  const styleSelect = el("select", { "aria-label": "Ballroom style" },
    el("option", { value: "" }, "None (not a competitive ballroom dance)"),
    Object.entries(BALLROOM_STYLES).map(([styleName, style]) => el("option", { value: styleName }, `${styleName} (${style.family})`)));
  const spellings = [];
  const preview = el("p", { class: "help" });
  const message = el("div", { "aria-live": "polite" });
  const updatePreview = () => {
    const name = nameBox.value.trim();
    preview.textContent = name
      ? `It will be called “${styleSelect.value ? `${styleSelect.value} ${name}` : name}”` +
        (styleSelect.value ? `, and a playlist named “${name}” or “${BALLROOM_STYLES[styleSelect.value].family} ${name}” will be guessed as this dance.` : ".")
      : "";
  };
  nameBox.addEventListener("input", updatePreview);
  styleSelect.addEventListener("change", updatePreview);

  const add = () => {
    const entry = { name: nameBox.value.trim(), style: styleSelect.value || null, spellings: [...spellings] };
    const problem = newDanceProblem(entry, libraryDances());
    if (problem) return fill(message, errorBox(problem));
    ownDances.push(entry);
    saveOwnDances();
    openDanceDialog(); // redraw with the new dance listed and an empty form
  };

  const list = ownDances.length
    ? el("ul", { class: "plain-list" }, ownDances.map((dance, iDance) =>
        el("li", {},
          el("strong", {}, dance.style ? `${dance.style} ${dance.name}` : dance.name),
          dance.spellings.length > 0 && el("span", { class: "muted" }, ` (also: ${dance.spellings.join(", ")})`),
          " ",
          el("button", { type: "button", class: "small", onclick: () => {
            if (!confirm(`Remove “${dance.name}” from your dances? Songs already tagged with it keep the tag.`)) return;
            ownDances.splice(iDance, 1);
            saveOwnDances();
            openDanceDialog();
          } }, "Remove"))))
    : el("p", { class: "muted" }, "You have not defined any dances yet.");

  fill(dialog,
    el("h2", {}, "Your own dances"),
    el("p", { class: "help" }, "Add a dance the app does not know yet. It appears in every dance box on this page and is remembered " +
      "in this browser. Once songs with this dance are saved in songs.csv, it is known everywhere."),
    list,
    el("h3", {}, "Define a new dance"),
    el("div", { class: "inline-fields" }, "Name:", nameBox),
    el("div", { class: "inline-fields" }, "Ballroom style:", styleSelect),
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
  nameBox.focus();
}

/** The "Define a new dance…" button (in steps 4 and 4a). */
export const defineDanceButton = () =>
  el("button", { type: "button", class: "small", onclick: openDanceDialog }, "Define a new dance…");
