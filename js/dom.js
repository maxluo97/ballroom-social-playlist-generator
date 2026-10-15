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
