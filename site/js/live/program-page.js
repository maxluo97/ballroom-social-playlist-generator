// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * program.js — the printable program (program.html): the night's song order with each song's dance
 * and special block, to print or download as a Word document (the agreed spec, NOTES.md v0.4 "Live
 * view and program", rule 11).
 *
 * Song titles and artists are never included: a printed or saved copy of Spotify's details would be a
 * permanent one, which Spotify's Developer Terms do not allow. The Word document has an empty Song name
 * column instead, for the organizer to fill in by hand.
 */

import { el, fill, $ } from "../shared/dom.js";
import { LIVE_PLAN_KEY, loadLivePlan, programRows } from "./live-core.js";
import { tableDocx, DOCX_TYPE } from "./docx.js";

let plan = loadLivePlan();
let title = "Dance program";

function download() {
  const bytes = tableDocx({
    title,
    headers: ["#", "Dance", "Special block", "Song name"],
    rows: programRows(plan).map((row) => [...row, ""]),
    widths: [700, 2700, 2300, 3660],
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  const name = (title.trim() || "Dance program").replace(/[\\/:*?"<>|]+/g, "-");
  const link = el("a", { href: url, download: `${name}.docx` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function render() {
  const box = $("program");
  if (!plan) {
    fill(box, el("p", {}, "No playlist yet. Generate one on the ", el("a", { href: "index.html" }, "generator page"), ", then press ", el("strong", {}, "Program"), "."));
    return;
  }
  const heading = el("h1", { class: "program-title" }, title);
  const rows = programRows(plan);
  fill(box,
    el("div", { class: "program-tools no-print" },
      el("label", { class: "inline-fields" }, "Title:",
        el("input", { type: "text", value: title, style: "flex:1 1 20em", "aria-label": "Program title", oninput: (event) => {
          title = event.target.value;
          heading.textContent = title;
        } })),
      el("div", { class: "inline-fields" },
        el("button", { type: "button", class: "primary", onclick: () => window.print() }, "Print program"),
        el("button", { type: "button", onclick: download }, "Download program (Word)")),
      el("p", { class: "help" }, "The song order with each song's dance. The Word document adds an empty Song name column, " +
        "to fill in by hand if you want song names in the program (the app may not keep copies of Spotify's song details).")),
    heading,
    el("table", { class: "program" },
      el("thead", {}, el("tr", {}, ["#", "Dance", "Special block"].map((heading) => el("th", { scope: "col" }, heading)))),
      el("tbody", {}, rows.map((row) => el("tr", {}, row.map((text, iColumn) => el("td", { class: iColumn === 0 ? "num" : "" }, text)))))));
}

addEventListener("storage", (event) => {
  if (event.key === LIVE_PLAN_KEY || event.key === null) {
    plan = loadLivePlan();
    render();
  }
});
render();
