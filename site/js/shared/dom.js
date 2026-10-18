// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dom.js — small helpers for building page elements, shared by the app's pages: making elements,
 * sortable tables, dropdowns that suggest as you type ("combo boxes"), chip boxes, and Spotify's credit.
 */

/** Keep only real children: drops null, undefined and false, which `condition && el(...)` gives. */
const realChildren = (children) => children.flat().filter((child) => child != null && child !== false);

/** Replace a node's contents (use this, not replaceChildren, which would show "false"). */
export const fill = (node, ...children) => node.replaceChildren(...realChildren(children));

/**
 * el("tag", { props }, ...children): a new element. Props starting with "on" become event listeners
 * ("onclick"); "class" is the class name; other props are set as properties where the element has one,
 * else as attributes (true -> an empty attribute). null, undefined and false props are left out.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (name === "class") node.className = value;
    else if (name in node && name !== "list") node[name] = value;
    else node.setAttribute(name, value === true ? "" : value);
  }
  node.append(...realChildren(children));
  return node;
}

/** The element with this id. */
export const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ sortable tables */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * A sorted copy of `rows`. `sort` = { key, dir } (dir 1 = ascending, -1 = descending; key null = as
 * given); `columns[key]` is a function row -> value (number or text). Empty values always go last.
 */
export function sortRows(rows, sort, columns) {
  if (!sort || !sort.key || !columns[sort.key]) return rows;
  const valueOf = columns[sort.key];
  const isEmpty = (value) => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));
  return rows
    .map((row, iRow) => ({ row, iRow, value: valueOf(row) }))
    .sort((first, second) => {
      if (isEmpty(first.value) || isEmpty(second.value)) return isEmpty(first.value) - isEmpty(second.value) || first.iRow - second.iRow;
      const order = typeof first.value === "number" && typeof second.value === "number"
        ? first.value - second.value
        : collator.compare(String(first.value), String(second.value));
      return order * sort.dir || first.iRow - second.iRow; // ties keep their original order
    })
    .map((entry) => entry.row);
}

/** A column heading that sorts by its column when clicked (click again to reverse). */
export function sortHeader(label, key, sort, onSort) {
  const active = sort.key === key;
  return el("th", { scope: "col", "aria-sort": active ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
    el("button", { type: "button", class: "sort-button", title: `Sort by ${label.toLowerCase()}`,
      onclick: () => onSort(active ? { key, dir: -sort.dir } : { key, dir: 1 }) },
      label, el("span", { class: "sort-mark", "aria-hidden": "true" }, active ? (sort.dir > 0 ? " ▲" : " ▼") : "")));
}

/** A fresh id for a list that belongs to one input. */
let listCount = 0;
export const nextListId = () => `dl-auto-${++listCount}`;

/* ------------------------------------------------------------ combo boxes */

/**
 * Turn a text input into a dropdown that suggests as you type (a "combo box").
 * The browser's own <datalist> suggestions are unreliable (some browsers only show them after a
 * double-click or the down-arrow key, and scrolling tables can clip them), so this draws its own list.
 *   getOptions()  -> all choices (read each time the list opens)
 *   onPick(value) -> called when a choice is clicked, or chosen with the arrow keys + Enter
 * The list opens on click / focus and while typing, shows the choices that contain the typed text
 * (those that start with it first), and floats above everything (position: fixed).
 * Enter with nothing highlighted is left to the input's own handlers (e.g. "add what I typed").
 */
export function attachCombo(input, getOptions, onPick) {
  const list = el("ul", { class: "combo-list", role: "listbox", id: nextListId(), hidden: true });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";
  let shownOptions = [];
  let highlighted = -1; // the highlighted choice's place in shownOptions (-1: none)

  /** Put the list just under the input (it is fixed on the screen, so it follows scrolling by hand). */
  const place = () => {
    const box = input.getBoundingClientRect();
    list.style.left = `${box.left}px`;
    list.style.top = `${box.bottom + 2}px`;
    list.style.minWidth = `${box.width}px`;
  };
  const draw = () => {
    list.replaceChildren(...shownOptions.map((option, iOption) =>
      el("li", { role: "option", id: `${list.id}-${iOption}`, class: iOption === highlighted ? "active" : null, "aria-selected": iOption === highlighted ? "true" : "false",
        // mousedown (not click) so the input keeps the focus and does not lose it first.
        onmousedown: (event) => { event.preventDefault(); pick(option); } }, option)));
    if (highlighted >= 0) {
      input.setAttribute("aria-activedescendant", `${list.id}-${highlighted}`);
      list.children[highlighted].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const open = () => {
    const typed = input.value.trim().toLowerCase();
    const allOptions = getOptions();
    const startingWith = allOptions.filter((option) => option.toLowerCase().startsWith(typed));
    const containing = allOptions.filter((option) => !option.toLowerCase().startsWith(typed) && option.toLowerCase().includes(typed));
    shownOptions = [...startingWith, ...containing];
    highlighted = -1;
    list.hidden = shownOptions.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden) {
      openCombo = { place };
      place();
      draw();
    }
  };
  const close = () => {
    list.hidden = true;
    highlighted = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    if (openCombo && openCombo.place === place) openCombo = null;
  };
  const pick = (option) => {
    close();
    onPick(option);
  };

  input.addEventListener("focus", open);
  input.addEventListener("click", () => list.hidden && open());
  input.addEventListener("input", open);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) return open();
      if (!shownOptions.length) return;
      highlighted = event.key === "ArrowDown"
        ? (highlighted + 1) % shownOptions.length
        : (highlighted <= 0 ? shownOptions.length - 1 : highlighted - 1);
      draw();
    } else if (event.key === "Enter" && !list.hidden && highlighted >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation(); // the highlighted choice wins over "add what I typed"
      pick(shownOptions[highlighted]);
    } else if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      close();
    }
  });
  input.after(list); // the input must already be inside a container (comboInput does this)
  return list;
}

// One open dropdown at a time; keep it next to its input when the page or a table scrolls.
let openCombo = null;
if (typeof window !== "undefined") {
  window.addEventListener("scroll", () => openCombo && openCombo.place(), true);
  window.addEventListener("resize", () => openCombo && openCombo.place());
}

/** A text input with an attached dropdown, wrapped so it can be placed anywhere. Returns { wrap, input }. */
export function comboInput(props, getOptions, onPick) {
  const input = el("input", { type: "text", ...props });
  const wrap = el("span", { class: "combo" }, input);
  attachCombo(input, getOptions, onPick);
  return { wrap, input };
}

/* ------------------------------------------------------------ chip boxes */

/**
 * An editable list of names shown as removable chips, with a dropdown for adding more.
 *   list      the array to edit (changed in place)
 *   source    a function giving the suggestions, or the id of a shared <datalist> to copy them from.
 *             Each box keeps its own dropdown (refreshed on focus) and leaves out items already added.
 *   options   placeholder, label (for screen readers),
 *             check(value)     -> an error message to refuse a value, or null
 *             normalize(value) -> the form to store (e.g. "American Rumba" -> "Rhythm Rumba")
 *             allowed()        -> if given, only these values can be added (typed text is matched
 *                                 ignoring capitals); anything else is refused with `notAllowed`
 *             notAllowed(value) -> the message for a refused value
 *             onChange()       -> called after every add or remove
 * Enter or "," adds what was typed; picking a suggestion adds it at once; Backspace in an empty box
 * removes the last chip.
 */
export function chipEditor(list, source, {
  placeholder = "add…", label = "Add", check = null, normalize = null, onChange = () => {},
  allowed = null, notAllowed = (value) => `“${value}” is not in the list.`,
} = {}) {
  const chips = el("span", { class: "chips-list" });
  const suggestions = typeof source === "function" ? source : () => [...$(source).options].map((option) => option.value);
  // A dropdown of suggestions, leaving out items already added. Picking one adds it at once.
  const { wrap, input } = comboInput({ placeholder, "aria-label": label },
    () => suggestions().filter((value) => !list.includes(value)),
    (value) => { input.value = value; add(true); });
  const draw = () => {
    chips.replaceChildren(
      ...list.map((item, iItem) =>
        el("span", { class: "chip" }, item,
          el("button", { type: "button", title: `Remove ${item}`, "aria-label": `Remove ${item}`, onclick: () => {
            list.splice(iItem, 1);
            draw();
            onChange();
          } }, "×")))
    );
  };
  /** Add what was typed. `explain`: show the reason if it is refused (on Enter; not when leaving the box). */
  const add = (explain) => {
    let value = input.value.replace(/,$/, "").trim();
    if (!value) return;
    if (normalize) value = normalize(value);
    if (allowed) {
      const match = allowed().find((name) => name.toLowerCase() === value.toLowerCase());
      if (!match) {
        input.setCustomValidity(notAllowed(value));
        if (explain) input.reportValidity();
        return;
      }
      value = match; // use the list's spelling and capitals
    }
    const problem = list.includes(value) ? `${value} is already in this list.` : check && check(value);
    if (problem) {
      input.setCustomValidity(problem);
      if (explain) input.reportValidity();
      return;
    }
    input.value = "";
    list.push(value);
    draw();
    onChange();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(true);
    } else if (event.key === "Backspace" && !input.value && list.length) {
      list.pop();
      draw();
      onChange();
    }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("blur", () => add(false));
  draw();
  return el("div", { class: "chips" }, chips, wrap);
}

/* ------------------------------------------------------- Spotify attribution */
/*
 * Spotify's design guidelines (developer.spotify.com/documentation/design): content from Spotify is
 * always credited with Spotify's logo — the full logo where there is room (at least 70 px wide), the
 * icon alone where there is not (at least 21 px) — in black on light backgrounds and white on dark
 * ones, unchanged, with clear space around it; and song details always link back to Spotify
 * ("LISTEN ON SPOTIFY"). The official files are in images/spotify/.
 */

/** Spotify's logo ("full-logo" or "icon"). `tone` "white" or "black" fixes its color; otherwise it follows the system's light / dark setting. */
function spotifyLogo(kind, alt, tone = null) {
  if (tone) return el("img", { src: `images/spotify/${kind}-${tone}.svg`, alt, class: `spotify-${kind}` });
  return el("picture", {},
    el("source", { srcset: `images/spotify/${kind}-white.svg`, media: "(prefers-color-scheme: dark)" }),
    el("img", { src: `images/spotify/${kind}-black.svg`, alt, class: `spotify-${kind}` }));
}

/** "Song details from <Spotify logo>": the credit next to anything that shows Spotify's song details. */
export const spotifyCredit = (text = "Song details from", tone = null) =>
  el("span", { class: "spotify-credit" }, text, " ", spotifyLogo("full-logo", "Spotify", tone));

/** A Spotify icon linking to the song on Spotify ("Listen on Spotify"), or null without a real ID. */
export function spotifyListenLink(url, name, tone = null) {
  if (!url) return null;
  const label = `Listen on Spotify: ${name}`;
  return el("a", { href: url, target: "_blank", rel: "noopener", class: "spotify-listen", title: label, "aria-label": label }, spotifyLogo("icon", "", tone));
}
