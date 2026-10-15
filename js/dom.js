/**
 * dom.js — tiny helpers for building page elements, shared by the app's pages.
 */

/** Keep only real children: drops null/undefined/false, which `cond && el(...)` produces. */
const realChildren = (children) => children.flat().filter((c) => c != null && c !== false);

/** Replace a node's contents (use this, not replaceChildren, which would print "false"). */
export const fill = (node, ...children) => node.replaceChildren(...realChildren(children));

/** el("tag", {props}, ...children). Props starting with "on" become event listeners. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...realChildren(children));
  return node;
}

export const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ sortable tables */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * A sorted copy of `rows`. `sort` = { key, dir } (dir 1 = ascending, -1 = descending; key null = as
 * given); `columns[key]` is a function row -> value (number or text). Empty values always go last.
 */
export function sortRows(rows, sort, columns) {
  if (!sort || !sort.key || !columns[sort.key]) return rows;
  const value = columns[sort.key];
  const empty = (v) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      if (empty(a.v) || empty(b.v)) return empty(a.v) - empty(b.v) || a.i - b.i;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c * sort.dir || a.i - b.i; // ties keep their original order
    })
    .map((x) => x.row);
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
let listCounter = 0;
export const nextListId = () => `dl-auto-${++listCounter}`;

/**
 * Turn a text input into an autocompleting dropdown ("combo box").
 * The browser's own <datalist> suggestions are unreliable (some browsers only show them after a
 * double-click or the down-arrow key, and scrolling tables can clip them), so this draws its own list.
 *   getOptions()  -> all choices (read each time the list opens)
 *   onPick(value) -> called when a choice is clicked, or chosen with the arrow keys + Enter
 * The list opens on click/focus and while typing, shows choices that contain the typed text
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
  let items = [];
  let active = -1;

  const place = () => {
    const r = input.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 2}px`;
    list.style.minWidth = `${r.width}px`;
  };
  const draw = () => {
    list.replaceChildren(...items.map((o, i) =>
      el("li", { role: "option", id: `${list.id}-${i}`, class: i === active ? "active" : null, "aria-selected": i === active ? "true" : "false",
        // mousedown (not click) so the input keeps focus and does not blur first.
        onmousedown: (e) => { e.preventDefault(); pick(o); } }, o)));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      list.children[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const open = () => {
    const q = input.value.trim().toLowerCase();
    const all = getOptions();
    const starts = all.filter((o) => o.toLowerCase().startsWith(q));
    const contains = all.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
    items = [...starts, ...contains];
    active = -1;
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden) {
      openCombo = { place };
      place();
      draw();
    }
  };
  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    if (openCombo && openCombo.place === place) openCombo = null;
  };
  const pick = (o) => {
    close();
    onPick(o);
  };

  input.addEventListener("focus", open);
  input.addEventListener("click", () => list.hidden && open());
  input.addEventListener("input", open);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) return open();
      if (!items.length) return;
      active = e.key === "ArrowDown" ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1);
      draw();
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation(); // the highlighted choice wins over "add what I typed"
      pick(items[active]);
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
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

/** A text input with an attached dropdown, wrapped so it can be placed anywhere. */
export function comboInput(props, getOptions, onPick) {
  const input = el("input", { type: "text", ...props });
  const wrap = el("span", { class: "combo" }, input);
  attachCombo(input, getOptions, onPick);
  return { wrap, input };
}

/**
 * Editable list of names shown as removable chips, with an autocompleting dropdown for adding more.
 *   list      the array to edit (changed in place)
 *   source    a function returning the suggestions, or the id of a shared <datalist> to copy them from.
 *             Each editor keeps its own dropdown (refreshed on focus) and leaves out items already added.
 *   options   placeholder, label (for screen readers),
 *             check(value)     -> an error message to refuse a value, or null
 *             normalize(value) -> the form to store (e.g. "American Rumba" -> "Rhythm Rumba")
 *             allowed()        -> if given, only these values can be added (typed text is matched
 *                                 ignoring capitals); anything else is refused with `notAllowed`
 *             notAllowed(v)    -> the message for a refused value
 *             onChange()       -> called after every add or remove
 * Enter or "," adds what was typed; picking a suggestion adds it at once; Backspace in an empty box
 * removes the last chip.
 */
export function chipEditor(list, source, {
  placeholder = "add…", label = "Add", check = null, normalize = null, onChange = () => {},
  allowed = null, notAllowed = (v) => `“${v}” is not in the list.`,
} = {}) {
  const chips = el("span", { class: "chips-list" });
  const suggestions = typeof source === "function" ? source : () => [...$(source).options].map((o) => o.value);
  // Dropdown of suggestions, leaving out items already added. Picking one adds it at once.
  const { wrap, input } = comboInput({ placeholder, "aria-label": label },
    () => suggestions().filter((v) => !list.includes(v)),
    (v) => { input.value = v; add(true); });
  const draw = () => {
    chips.replaceChildren(
      ...list.map((d, i) =>
        el("span", { class: "chip" }, d,
          el("button", { type: "button", title: `Remove ${d}`, "aria-label": `Remove ${d}`, onclick: () => {
            list.splice(i, 1);
            draw();
            onChange();
          } }, "×")))
    );
  };
  /** `explain`: show the reason if the value is refused (on Enter; not when leaving the box). */
  const add = (explain) => {
    let v = input.value.replace(/,$/, "").trim();
    if (!v) return;
    if (normalize) v = normalize(v);
    if (allowed) {
      const match = allowed().find((a) => a.toLowerCase() === v.toLowerCase());
      if (!match) {
        input.setCustomValidity(notAllowed(v));
        if (explain) input.reportValidity();
        return;
      }
      v = match; // use the list's spelling and capitals
    }
    const problem = list.includes(v) ? `${v} is already in this list.` : check && check(v);
    if (problem) {
      input.setCustomValidity(problem);
      if (explain) input.reportValidity();
      return;
    }
    input.value = "";
    list.push(v);
    draw();
    onChange();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(true);
    } else if (e.key === "Backspace" && !input.value && list.length) {
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
