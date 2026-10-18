// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * playlists-step.js — step 4: your Spotify playlists (the ones you own or collaborate on), each one's
 * dance guessed from its name (confirm it, answer style questions), optional tags, and the import.
 * Imports only add to the library; see site/js/library/library-merge.js for the exact rules.
 */

import { isLoggedIn, getMyPlaylists, getPlaylistTracks } from "../../shared/spotify.js";
import { guessDanceInfo, BALLROOM_STYLES } from "../../shared/dance-names.js";
import { el, fill, $ } from "../../shared/dom.js";
import { state, redraw, errorBox, libraryDances, danceChips, tagChips } from "./page-state.js";
import { computeRows } from "./library-data.js";
import { defineDanceButton } from "./own-dances.js";

/** Read your playlists from Spotify, and guess each new one's dance from its name. */
export async function loadPlaylists() {
  fill($("playlists"), el("p", { class: "muted" }, "Loading your playlists…"));
  try {
    const allPlaylists = await getMyPlaylists((done, total) => fill($("playlists"), el("p", { class: "muted" }, `Loading your playlists… ${done} of ${total}`)));
    state.playlists = allPlaylists.filter((playlist) => playlist.ownedByMe || playlist.collaborative);
    state.hiddenCount = allPlaylists.length - state.playlists.length;
    for (const playlist of state.playlists) {
      if (state.choices.has(playlist.id)) continue;
      const { dances, ambiguous, checks } = guessDanceInfo(playlist.name, libraryDances());
      state.choices.set(playlist.id, { selected: dances.length > 0 && !ambiguous.length, dances, tags: [], ambiguous, checks });
    }
  } catch (err) {
    state.playlists = null;
    fill($("playlists"), errorBox(err.message));
    return;
  }
  renderPlaylists();
  redraw.manual(); // its playlist chooser lists these playlists too
}

/** "Rhythm Rumba" -> "Rhythm = American" (to explain a style choice). */
const familyOf = (option) => {
  const style = option.split(" ")[0];
  return BALLROOM_STYLES[style] ? `${style} = ${BALLROOM_STYLES[style].family}` : option;
};

export function renderPlaylists() {
  const box = $("playlists");
  if (!isLoggedIn()) return fill(box, el("p", { class: "muted" }, "Log in first (step 1)."));
  if (!state.playlists) {
    return fill(box,
      el("p", { class: "help" }, "Lists the playlists you own or collaborate on (Spotify only lets apps read those). " +
        "Each playlist's dance is guessed from its name; check it before importing."),
      el("button", { type: "button", class: "primary", onclick: loadPlaylists }, "Load my playlists"));
  }

  const search = el("input", { type: "text", placeholder: "filter by name…", value: state.playlistSearch, "aria-label": "Filter playlists" });
  const tbody = el("tbody");
  const selectedCount = el("span", { class: "muted" });
  const updateCount = () => {
    const selected = state.playlists.filter((playlist) => state.choices.get(playlist.id).selected);
    const songCount = selected.reduce((total, playlist) => total + (playlist.trackCount || 0), 0);
    selectedCount.textContent = `${selected.length} playlist(s) selected, about ${songCount} songs.`;
  };

  const drawRows = () => {
    const query = state.playlistSearch.toLowerCase();
    fill(tbody, state.playlists.filter((playlist) => playlist.name.toLowerCase().includes(query)).map((playlist) => {
      const choice = state.choices.get(playlist.id);
      const tick = el("input", { type: "checkbox", checked: choice.selected, "aria-label": `Import ${playlist.name}`, onchange: () => { choice.selected = tick.checked; updateCount(); } });
      const dances = danceChips(choice.dances, `Dances for ${playlist.name}`, () => {
        // Giving a playlist a dance selects it for import.
        if (choice.dances.length && !choice.selected) (choice.selected = true), (tick.checked = true);
        updateCount();
      });
      const tags = tagChips(choice.tags, `Tags for ${playlist.name}`);
      // A bare "Rumba" could be American (Rhythm) or International (Latin): ask.
      const questions = choice.ambiguous.map((question) =>
        el("div", { class: "ask" }, `“${question.dance}”: which style? `,
          question.options.map((option) => el("button", { type: "button", class: "small", onclick: () => {
            if (!choice.dances.includes(option)) choice.dances.push(option);
            choice.ambiguous = choice.ambiguous.filter((other) => other !== question);
            choice.selected = true;
            drawRows();
            updateCount();
          } }, `${option} (${familyOf(option)})`))));
      // A bare "Tango" is guessed as ballroom Tango, but flagged: it could be Argentine.
      const flags = choice.checks.map((check) =>
        el("div", { class: "ask" }, `⚠ ${check.message} `,
          el("button", { type: "button", class: "small", onclick: () => {
            choice.dances = [...choice.dances.filter((dance) => !check.guessed.includes(dance)), check.alternative]
              .filter((dance, iDance, all) => all.indexOf(dance) === iDance);
            choice.checks = choice.checks.filter((other) => other !== check);
            drawRows();
          } }, `It's ${check.alternative}`),
          el("button", { type: "button", class: "small", onclick: () => {
            choice.checks = choice.checks.filter((other) => other !== check);
            drawRows();
          } }, "Ballroom is right")));
      return el("tr", {},
        el("td", {}, tick),
        el("td", {}, playlist.name),
        el("td", { class: "num" }, playlist.trackCount ?? "?"),
        el("td", { class: choice.ambiguous.length || choice.checks.length ? "guess" : null }, dances, questions, flags),
        el("td", {}, tags));
    }));
  };
  search.addEventListener("input", () => { state.playlistSearch = search.value; drawRows(); });
  const selectAll = (shouldSelect) => {
    for (const playlist of state.playlists) state.choices.get(playlist.id).selected = shouldSelect(state.choices.get(playlist.id));
    drawRows();
    updateCount();
  };
  drawRows();
  updateCount();

  fill(box,
    el("p", { class: "help" },
      `${state.playlists.length} playlists can be read.` +
        (state.hiddenCount ? ` ${state.hiddenCount} playlists you follow are hidden; to import one, copy its songs into a playlist of your own.` : "")),
    el("ul", { class: "help" },
      el("li", {}, "Each playlist's dance is guessed from its name. Check it, and add more dances if a playlist fits several."),
      el("li", {}, "Ballroom dances are named by style: Smooth or Rhythm (American), Standard or Latin (International). " +
        "Typing “American Rumba” or “Intl Cha Cha” is converted for you."),
      el("li", {}, "Tags are optional; a tag here goes on every song in that playlist.")),
    el("div", { class: "inline-fields" }, search,
      el("button", { type: "button", class: "small", onclick: () => selectAll((choice) => choice.dances.length > 0) }, "Select all with a dance"),
      el("button", { type: "button", class: "small", onclick: () => selectAll(() => false) }, "Select none"),
      el("button", { type: "button", class: "small", onclick: loadPlaylists }, "Reload playlists"),
      defineDanceButton()),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Import?", "Playlist", "Songs", "Dance(s)", "Tags"].map((heading) => el("th", { scope: "col" }, heading)))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: runImport }, "Import selected playlists"),
      selectedCount));
}

/** Import the selected playlists (after asking about unanswered questions), then rebuild the review. */
async function runImport() {
  const chosen = state.playlists.filter((playlist) => state.choices.get(playlist.id).selected);
  if (!chosen.length) return alert("Select at least one playlist.");
  const unanswered = chosen.filter((playlist) => state.choices.get(playlist.id).ambiguous.length);
  if (unanswered.length && !confirm(
    `These playlists still have a style question (e.g. which Rumba):\n${unanswered.map((playlist) => "• " + playlist.name).join("\n")}\n\n` +
      "The unanswered dance will not be added. Continue?")) return;
  const unchecked = chosen.filter((playlist) => state.choices.get(playlist.id).checks.length);
  if (unchecked.length && !confirm(
    `These playlists have a guess you have not confirmed:\n` +
      unchecked.map((playlist) => `• ${playlist.name}: ${state.choices.get(playlist.id).checks.map((check) => check.message).join(" ")}`).join("\n") +
      "\n\nImport them with the guess as it stands?")) return;
  const withoutDance = chosen.filter((playlist) => !state.choices.get(playlist.id).dances.length);
  if (withoutDance.length && !confirm(
    `These playlists have no dance set:\n${withoutDance.map((playlist) => "• " + playlist.name).join("\n")}\n\n` +
      "Their songs only get tags. Songs that end up with no dance at all are flagged in the review. Continue?")) return;

  const imports = [];
  const failures = [];
  for (const [iPlaylist, playlist] of chosen.entries()) {
    fill($("review"), el("p", { class: "muted" }, `Reading “${playlist.name}” (${iPlaylist + 1} of ${chosen.length})…`));
    try {
      const songs = await getPlaylistTracks(playlist.id);
      const choice = state.choices.get(playlist.id);
      imports.push({ playlistName: playlist.name, dances: [...choice.dances], tags: [...choice.tags], songs });
    } catch (err) {
      failures.push(`${playlist.name}: ${err.message}`);
    }
  }
  state.imports = imports;
  state.failures = failures;
  computeRows();
}
