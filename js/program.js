/**
 * program.js — the printable program (program.html): the night's song order with each song's dance
 * and special block, to print or download as a Word document (the agreed spec, NOTES.md v0.4 "Live
 * view and program", rule 11).
 *
 * Song titles and artists are never included: a printed or saved copy of Spotify's details would be a
 * permanent one, which Spotify's Developer Terms do not allow. The Word document has an empty Song name
 * column instead, for the organizer to fill in by hand.
 */

import { el, fill, $ } from "./dom.js";
import { LIVE_PLAN_KEY, loadLivePlan, programRows } from "./live-core.js";
import { tableDocx, DOCX_TYPE } from "./docx.js";

let plan = loadLivePlan();
let title = "Dance program";

function download() {
  const bytes = tableDocx({
    title,
    headers: ["#", "Dance", "Special block", "Song name"],
    rows: programRows(plan).map((r) => [...r, ""]),
    widths: [700, 2700, 2300, 3660],
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  const name = (title.trim() || "Dance program").replace(/[\\/:*?"<>|]+/g, "-");
  const a = el("a", { href: url, download: `${name}.docx` });
  document.body.append(a);
  a.click();
  a.remove();
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
        el("input", { type: "text", value: title, style: "flex:1 1 20em", "aria-label": "Program title", oninput: (e) => {
          title = e.target.value;
          heading.textContent = title;
        } })),
      el("div", { class: "inline-fields" },
        el("button", { type: "button", class: "primary", onclick: () => window.print() }, "Print program"),
        el("button", { type: "button", onclick: download }, "Download program (Word)")),
      el("p", { class: "help" }, "The song order with each song's dance. The Word document adds an empty Song name column, " +
        "to fill in by hand if you want song names in the program (the app may not keep copies of Spotify's song details).")),
    heading,
    el("table", { class: "program" },
      el("thead", {}, el("tr", {}, ["#", "Dance", "Special block"].map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: i === 0 ? "num" : "" }, c)))))));
}

addEventListener("storage", (e) => {
  if (e.key === LIVE_PLAN_KEY || e.key === null) {
    plan = loadLivePlan();
    render();
  }
});
render();
