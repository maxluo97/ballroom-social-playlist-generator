// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * form-controls.js — the building blocks of the settings form. Each control reads its value with
 * `get()`, writes it with `set(value)`, and reports the change (see changed() in page-state.js).
 */

import { parseLength } from "../../shared/data.js";
import { el, comboInput, chipEditor as sharedChipEditor } from "../../shared/dom.js";
import { state, changed, addLiveUpdater } from "./page-state.js";

/** A labeled field: the label, the control, and an optional help line. */
export function field(label, control, help) {
  return el("label", { class: "field" }, el("span", { class: "label" }, label), control, help && el("small", {}, help));
}

/** A number box (whole numbers by default). */
export function numberInput(get, set, { min, max, step = 1 } = {}) {
  const input = el("input", { type: "number", value: String(get()), min, max, step });
  input.addEventListener("input", () => {
    const value = input.valueAsNumber;
    if (Number.isFinite(value)) {
      set(value);
      changed();
    }
  });
  return input;
}

/**
 * A text box. It updates the settings on every keystroke, unless `commitOnly` (then on Enter or on
 * leaving the box). `suggest`: a function giving suggestions for a dropdown; picking one counts as
 * committing it. `onCommit(value)`: called instead of `set` when the text is committed.
 */
export function textInput(get, set, { placeholder, suggest, commitOnly = false, onCommit } = {}) {
  const combo = suggest
    ? comboInput({ value: get() ?? "", placeholder }, suggest, (value) => {
        combo.input.value = value;
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

/** A slider and a number box, together, for a 0..1 fraction shown as a percentage. */
export function percentSlider(get, set) {
  const range = el("input", { type: "range", min: 0, max: 100, step: 1, value: String(Math.round(get() * 100)) });
  const numberBox = el("input", { type: "number", min: 0, max: 100, step: 1, value: String(Math.round(get() * 100)) });
  const apply = (value, otherControl) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(100, Math.max(0, value));
    otherControl.value = String(clamped);
    set(clamped / 100);
    changed();
  };
  range.addEventListener("input", () => apply(range.valueAsNumber, numberBox));
  numberBox.addEventListener("input", () => apply(numberBox.valueAsNumber, range));
  return el("span", { class: "inline-fields" }, range, numberBox, "%");
}

/** A song length typed as m:ss (or seconds). Blank = no limit (null). */
export function lengthInput(get, set) {
  const show = (lengthSec) => (lengthSec > 0 ? `${Math.floor(lengthSec / 60)}:${String(lengthSec % 60).padStart(2, "0")}` : "");
  const input = el("input", { type: "text", value: show(get()), placeholder: "no limit", size: 7, "aria-label": "Length (m:ss)" });
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("change", () => {
    const text = input.value.trim();
    const lengthSec = text ? Math.round(parseLength(text)) : null;
    if (text && !(lengthSec > 0)) {
      input.setCustomValidity("Type a length like 2:30 (minutes:seconds), or leave it blank.");
      input.reportValidity();
      return;
    }
    set(lengthSec);
    input.value = show(lengthSec);
    changed();
  });
  return input;
}

/**
 * A dropdown with no free typing. `options()` is read again after every settings change, so the list
 * follows the song library and associations. `noneLabel` is the "nothing chosen" entry (its value is
 * null). A current value missing from the options is kept, marked "(no songs)".
 */
export function selectInput(get, set, options, noneLabel) {
  const select = el("select", {});
  const update = () => {
    const current = get();
    const values = options();
    select.replaceChildren(
      el("option", { value: "" }, noneLabel),
      ...values.map((value) => el("option", { value }, value)),
      current && !values.includes(current) && el("option", { value: current }, `${current} (no songs)`)
    );
    select.value = current ?? "";
  };
  select.addEventListener("change", () => {
    set(select.value || null);
    changed();
  });
  addLiveUpdater(update);
  update();
  return select;
}

/** A chip box (see site/js/shared/dom.js) whose changes count as settings changes. */
export const chipEditor = (list, source, options = {}) => sharedChipEditor(list, source, { ...options, onChange: () => changed() });

/** The "×" button that removes a row. */
export function removeButton(what, onclick) {
  return el("button", { type: "button", class: "icon", title: `Remove ${what}`, "aria-label": `Remove ${what}`, onclick }, "×");
}

/** A section of the settings form that opens and closes (and stays as it was when the form is redrawn). */
export function section(title, note, ...body) {
  const details = el(
    "details",
    { class: "section", open: state.openSections.has(title) },
    el("summary", {}, title, note),
    el("div", { class: "section-body" }, ...body)
  );
  details.addEventListener("toggle", () => (details.open ? state.openSections.add(title) : state.openSections.delete(title)));
  return details;
}
