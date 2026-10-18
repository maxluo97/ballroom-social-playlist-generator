// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * tag-rules-step.js — step 3, automatic tags: keyword rules ("soundtrack" -> Hollywood) that tag a song
 * during import when its title or album contains the words, with a box to try them on a title.
 */

import { el, fill, $, comboInput } from "../../shared/dom.js";
import { DEFAULT_RULES, loadRules, saveRules, knownTags, updateLists } from "./page-state.js";

export function renderRules() {
  const rules = loadRules();
  const save = () => {
    saveRules(rules);
    updateLists();
    updateTryResult();
  };

  const tbody = el("tbody");
  const drawRules = () =>
    fill(tbody, rules.map((rule, iRule) => {
      const keywordBox = el("input", { type: "text", value: rule.keyword, placeholder: "e.g. soundtrack", "aria-label": "Words to look for",
        oninput: () => { rule.keyword = keywordBox.value.trim(); save(); } });
      const { wrap: tagWrap, input: tagBox } = comboInput(
        { value: rule.tag, placeholder: "e.g. Hollywood", "aria-label": "Tag to add", oninput: () => { rule.tag = tagBox.value.trim(); save(); } },
        knownTags,
        (value) => { tagBox.value = value; rule.tag = value; save(); });
      return el("tr", {},
        el("td", {}, keywordBox),
        el("td", {}, tagWrap),
        el("td", {}, el("button", { type: "button", class: "icon", title: "Remove rule", "aria-label": "Remove rule",
          onclick: () => { rules.splice(iRule, 1); save(); drawRules(); } }, "×")));
    }));
  drawRules();

  // The "Try it" box: which tags a title / album would get.
  const tryBox = el("input", { type: "text", placeholder: "e.g. Moon River (From \"Breakfast at Tiffany's\" Soundtrack)", "aria-label": "Try a title or album", style: "flex:1 1 20em" });
  const tryResult = el("strong", {});
  const updateTryResult = () => {
    const text = tryBox.value.toLowerCase();
    const tags = [...new Set(rules.filter((rule) => rule.keyword && rule.tag && text.includes(rule.keyword.toLowerCase())).map((rule) => rule.tag))];
    tryResult.textContent = !text ? "" : tags.length ? `→ tags: ${tags.join(", ")}` : "→ no tags";
  };
  tryBox.addEventListener("input", updateTryResult);

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
        rules.splice(0, rules.length, ...DEFAULT_RULES.map((rule) => ({ ...rule })));
        save();
        drawRules();
      } }, "Restore default rules")),
    el("div", { class: "inline-fields" }, "Try a title or album:", tryBox, tryResult),
    el("p", { class: "help" }, "Capitals are ignored. Tags added by keyword are highlighted in step 5 so you can check them. " +
      "If you change the rules after importing, press “Re-apply tag rules” in step 5."));
}
