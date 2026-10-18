// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * review-step.js — step 5, the review: the whole library plus anything imported, in a table with filters,
 * a search and sortable columns. Each song's dances, tags and work can be changed; songs can be removed
 * (and restored), and songs removed before can be put back.
 *
 * Spotify's details (titles, lengths, whether a song can play) are read from the library playlist and
 * kept in this browser only temporarily (site/js/shared/song-details.js); songs.csv holds only IDs and
 * your data.
 */

import { isLoggedIn, getTrack } from "../../shared/spotify.js";
import { isUnavailable, unavailableReason, isChecked, rememberDetails, detailsAgeDays, reloadDetails } from "../../shared/song-details.js";
import { spotifyLink } from "../../shared/data.js";
import { workKey, recordingKey } from "../../shared/works.js";
import { formatTime } from "../../generator/generator.js";
import { el, fill, $, sortRows, sortHeader, spotifyCredit, spotifyListenLink } from "../../shared/dom.js";
import { state, redraw, freshDetails, danceChips, tagChips, REVIEW_PAGE_SIZE } from "./page-state.js";
import { groups, updateGroups, computeRows, refreshLibraryDetails } from "./library-data.js";
import { workNameOf, sameSongNotes, workEditor } from "./same-song.js";
import { previewButton } from "./song-preview.js";

/** What to show under a song's title about its details or availability (null = nothing to say). */
function availabilityNote(song) {
  if (isUnavailable(song.id)) return el("div", { class: "swap-warning" }, `Warning: ${unavailableReason(song.id)}. Consider removing it.`);
  if (song.unknown) {
    return el("div", { class: "muted", style: "font-size:0.85em" },
      isLoggedIn() ? "Its details are not known yet: saving puts it in the library playlist, then they are read." : "Log in (step 1) to read its details.");
  }
  return null;
}

/** The "Spotify details" box at the top of step 5. */
function detailsBox() {
  reloadDetails(); // the generator page may have read the details since this page opened
  const inLibrary = state.rows.filter((row) => !row.removedNow && !row.blocked);
  const knownCount = inLibrary.filter((row) => isChecked(row.song.id)).length;
  const unavailableCount = inLibrary.filter((row) => isUnavailable(row.song.id)).length;
  const ageDays = detailsAgeDays();
  const { refreshing, error } = state.details;
  return el("div", { class: "subbox" },
    el("div", { class: "subbox-title" }, "Spotify details"),
    el("p", { class: "help" },
      "Titles, lengths and whether songs can play come from Spotify (the library playlist) and are kept in this browser for a while only; " +
        "songs.csv holds just the song IDs and your dances, tags and corrections. " +
        `Details known for ${knownCount} of ${inLibrary.length} songs` + (ageDays !== null ? `, read ${ageDays < 1 ? "today" : `${Math.floor(ageDays)} day(s) ago`}` : "") +
        `; ${unavailableCount} cannot be played` + (unavailableCount ? " (filter “Not available on Spotify” below; consider removing them)." : ".")),
    error && el("ul", { class: "msgs" }, el("li", { class: "error" }, error)),
    refreshing
      ? el("p", { class: "muted", id: "details-progress" }, `Reading your library from Spotify… ${refreshing.done} of ${refreshing.total} songs`)
      : el("div", { class: "inline-fields" },
          !state.libraryPlaylistId ? el("span", { class: "muted" }, "Saving the library (step 6) creates the library playlist in your Spotify account.")
            : isLoggedIn() ? el("button", { type: "button", class: "small", onclick: () => refreshLibraryDetails() }, "Refresh from Spotify")
              : el("span", { class: "muted" }, "Log in (step 1) to read the details.")));
}

/** The review's filters: key -> [button label, which rows it shows]. */
const FILTERS = {
  all: ["All", () => true],
  new: ["New", (row) => row.status === "new"],
  updated: ["Updated", (row) => row.status === "updated"],
  multi: ["In several playlists", (row) => row.sources.length > 1],
  guessed: ["Keyword tags", (row) => row.guessed.tags.length],
  nodance: ["No dance", (row) => !row.song.dances.length],
  unchanged: ["Unchanged", (row) => row.status === "unchanged"],
  unavailable: ["Not available on Spotify", (row) => isUnavailable(row.song.id)],
  duplicates: ["Duplicates", (row) => groups.duplicates.has(row.song.id) || state.flagged.duplicates.has(row.song.id)],
  versions: ["Versions", (row) => groups.versions.has(row.song.id) || state.flagged.versions.has(row.song.id)],
  removed: ["Removed", (row) => row.removedNow],
  blocked: ["Removed earlier", (row) => row.blocked || row.reimported],
};

/** Blacklisted songs only show under "Removed earlier" (until restored); every other filter hides them. */
const shownIn = (filterKey, row) => (filterKey === "blocked" || !row.fromBlacklist || row.reimported) && FILTERS[filterKey][1](row);

const statusText = (row) =>
  row.removedNow ? "Removed" : row.blocked ? "Removed earlier" : row.reimported ? "Restored" : row.status === "new" ? "New" : row.status === "updated" ? "Updated" : "";
/** The review table's sortable columns (heading -> the value to sort by). On-screen order only. */
const REVIEW_COLUMNS = {
  "Status": statusText,
  "Title": (row) => row.song.title,
  "Artist": (row) => row.song.artist,
  "Album": (row) => row.song.album,
  "Length": (row) => row.song.lengthSec,
  "Dances": (row) => row.song.dances.join(", "),
  "Tags": (row) => row.song.tags.join(", "),
  "Work": (row) => workNameOf(row.song),
  "From playlist(s)": (row) => row.sources.join(", "),
};

export function renderReview() {
  const rows = state.rows;
  if (!rows || !rows.length) {
    fill($("review"), el("p", { class: "muted" }, "The library is empty. Import playlists in step 4 or add songs in step 4a."));
    redraw.output();
    return;
  }
  updateGroups();
  const tbody = el("tbody");
  const search = el("input", { type: "text", placeholder: "search title / artist…", value: state.search, "aria-label": "Search songs" });
  // The Duplicates and Versions filters show each group together.
  const grouping = { duplicates: { key: "group", dir: 1 }, versions: { key: "group", dir: 1 } }[state.filter];
  const groupKey = state.filter === "duplicates" ? (row) => recordingKey(row.song) : (row) => workKey(row.song);
  const drawRows = () => {
    const query = state.search.toLowerCase();
    const matching = rows.filter((row) => shownIn(state.filter, row) && `${row.song.title} ${row.song.artist}`.toLowerCase().includes(query));
    const shown = state.reviewSort && state.reviewSort.key ? sortRows(matching, state.reviewSort, REVIEW_COLUMNS)
      : grouping ? sortRows(matching, grouping, { group: groupKey }) : matching;
    // Only the rows on screen are built (every change redraws them), so long libraries stay quick.
    const moreCount = shown.length - state.reviewLimit;
    fill(tbody, shown.slice(0, state.reviewLimit).map(reviewRow),
      moreCount > 0 && el("tr", {}, el("td", { colspan: 10, class: "muted" },
        `Showing ${state.reviewLimit} of ${shown.length} songs. `,
        el("button", { type: "button", class: "small", onclick: () => { state.reviewLimit += REVIEW_PAGE_SIZE; drawRows(); } }, `Show ${Math.min(REVIEW_PAGE_SIZE, moreCount)} more`),
        " ",
        el("button", { type: "button", class: "small", onclick: () => { state.reviewLimit = shown.length; drawRows(); } }, "Show all"),
        " (or narrow it down with a filter or the search)")));
  };
  search.addEventListener("input", () => { state.search = search.value; state.reviewLimit = REVIEW_PAGE_SIZE; drawRows(); });

  const filterButtons = Object.entries(FILTERS).map(([filterKey, [label]]) =>
    el("button", { type: "button", class: filterKey === state.filter ? "small primary" : "small", onclick: () => { state.filter = filterKey; state.reviewLimit = REVIEW_PAGE_SIZE; renderReview(); } },
      `${label} (${rows.filter((row) => shownIn(filterKey, row)).length})`));
  drawRows();

  fill($("review"),
    state.failures.length > 0 && el("ul", { class: "msgs" }, state.failures.map((failure) => el("li", { class: "error" }, failure))),
    el("p", { class: "help" }, "Your whole library is listed here, plus anything imported. Use × to take a dance or tag off a song, " +
      "and the dropdown to add one. Highlighted tags came from keyword rules, so check them. " +
      "Remove takes a song out of the library; the app remembers it, so a later import will not quietly bring it back. " +
      "Duplicates are the same recording under another Spotify ID; Versions are other recordings of the same song (by title). " +
      "Fix wrong matches with the Work box or the duplicate buttons; ▶ plays a song in a player at the bottom of the page. " +
      "Click a column heading to sort the table by it (click again to reverse)."),
    detailsBox(),
    el("div", { class: "attribution" }, spotifyCredit()),
    el("div", { class: "inline-fields" }, ...filterButtons, search),
    el("div", { class: "actions" },
      (state.imports || state.manual.length > 0) && el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Re-apply the tag rules from step 3? Edits you made in this table will be lost.")) computeRows();
      } }, "Re-apply tag rules"),
      // For long libraries: jump past the table and back.
      el("button", { type: "button", class: "small jump", onclick: () => jump("review-bottom") }, "Jump to bottom ↓")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {},
          Object.keys(REVIEW_COLUMNS).map((label) => sortHeader(label, label, state.reviewSort, (sort) => {
            state.reviewSort = sort;
            renderReview();
          })),
          el("th", { scope: "col" }))),
        tbody)),
    el("div", { id: "review-bottom", class: "actions" },
      el("button", { type: "button", class: "small jump", onclick: () => jump("review") }, "Jump to top ↑")));
  redraw.output();
}

/** Scroll smoothly to an element of the page (by id), leaving a little space above it. */
function jump(id) {
  const target = $(id);
  if (!target) return;
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" });
}

/** Put a blacklisted song back into the library, as it was (it comes off the blacklist when saved). */
async function restoreFromBlacklist(row) {
  row.blocked = false;
  row.reimported = true;
  renderReview();
  if (row.song.unknown && isLoggedIn()) {
    try {
      const song = await getTrack(row.song.id);
      rememberDetails([song]);
      row.song = freshDetails(row.song);
      renderReview();
    } catch {
      /* stays "Unknown song" until the next refresh */
    }
  }
}

/** One row of the review table. */
function reviewRow(row) {
  const song = row.song;
  const button = (className, label, title, onclick) =>
    el("button", { type: "button", class: className, title, "aria-label": title, onclick: () => { onclick(); renderReview(); } }, label);

  // Taken out of the library in this session: small and faded, can be restored.
  if (row.removedNow) {
    return el("tr", { class: "removed" },
      el("td", {}, "Removed"),
      el("td", {}, previewButton(song), " ", el("s", {}, song.title)),
      el("td", {}, song.artist),
      el("td", {}, song.album || ""),
      el("td", { class: "num" }, formatTime(song.lengthSec)),
      el("td", {}, song.dances.join(", ")),
      el("td", {}, song.tags.join(", ")),
      el("td", { class: "muted" }, workNameOf(song)),
      el("td", { class: "muted" }, row.sources.join(", ")),
      el("td", {}, button("small undo", "Restore", `Keep ${song.title} in the library`, () => (row.removedNow = false))));
  }
  // An import of a song that was removed before: left out unless re-imported.
  if (row.blocked) {
    const when = row.removedEntry && row.removedEntry.removed ? ` on ${row.removedEntry.removed}` : "";
    return el("tr", { class: "removed blocked" },
      el("td", {}, row.fromBlacklist ? "Removed earlier" : "Removed before"),
      el("td", {}, previewButton(song), " ", song.title,
        row.fromBlacklist
          ? el("div", { class: "muted", style: "font-size:0.85em" }, `Removed from the library${when}.`)
          : el("div", { class: "swap-warning" }, `Warning: you removed this song from the library${when}. It is left out unless you re-import it.`)),
      el("td", {}, song.artist),
      el("td", {}, song.album || ""),
      el("td", { class: "num" }, song.lengthSec ? formatTime(song.lengthSec) : ""),
      el("td", {}, song.dances.join(", ")),
      el("td", {}, song.tags.join(", ")),
      el("td", { class: "muted" }, workNameOf(song)),
      el("td", { class: "muted" }, row.sources.join(", ")),
      el("td", {}, row.fromBlacklist
        ? button("small", "Restore", `Put ${song.title} back into the library`, () => restoreFromBlacklist(row))
        : button("small", "Re-import", `Bring ${song.title} back into the library`, () => {
            row.blocked = false;
            row.reimported = true;
          })));
  }

  let tableRow = null;
  const edited = () => {
    tableRow.className = song.dances.length ? "" : "nodance";
    redraw.output();
  };
  const cell = (editor, guessedTags) =>
    el("td", { class: guessedTags.length ? "guess" : null },
      editor,
      guessedTags.length > 0 && el("small", { class: "muted", style: "display:block" }, `from keywords: ${guessedTags.join(", ")}`));
  tableRow = el("tr", { class: !song.dances.length ? "nodance" : null },
    el("td", {}, row.reimported ? (row.fromBlacklist ? "Restored" : "Re-imported")
      : row.status === "new" ? "New" : row.status === "updated" ? `+ ${[...row.added.dances, ...row.added.tags].join(", ")}` : ""),
    el("td", {}, previewButton(song), " ", !song.unknown && spotifyListenLink(spotifyLink(song.id), song.title), song.title, availabilityNote(song), sameSongNotes(song)),
    el("td", {}, song.artist),
    el("td", {}, song.album || ""),
    el("td", { class: "num" }, formatTime(song.lengthSec)),
    cell(danceChips(song.dances, `Dances for ${song.title}`, edited), []),
    cell(tagChips(song.tags, `Tags for ${song.title}`, edited), row.guessed.tags),
    el("td", {}, workEditor(song)),
    el("td", { class: "muted" }, row.sources.join(", ")),
    el("td", {}, row.reimported
      ? button("small undo", row.fromBlacklist ? "Undo restore" : "Undo re-import", `Leave ${song.title} out again`, () => {
          row.reimported = false;
          row.blocked = true;
        })
      : button("small", "Remove", `Take ${song.title} out of the library`, () => (row.removedNow = true))));
  return tableRow;
}
