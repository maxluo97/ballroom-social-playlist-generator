// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * songs-step.js — step 4a, songs one by one: for songs that are not in a single-dance playlist. Songs
 * come from pasted links, a Spotify search, or one playlist taken song by song, into a worklist where
 * each gets its dance(s); ticked songs go into the review (step 5).
 */

import { isLoggedIn, getTrack, searchTracks, playlistIdFrom, getPlaylistTracks } from "../../shared/spotify.js";
import { spotifyTrackId } from "../../shared/data.js";
import { unknownDanceMessage } from "../../shared/dance-names.js";
import { formatTime } from "../../generator/generator.js";
import { el, fill, $, comboInput, spotifyCredit } from "../../shared/dom.js";
import { state, splitList, danceList, knownDances, knownTags, danceChips, tagChips } from "./page-state.js";
import { computeRows } from "./library-data.js";
import { loadPlaylists } from "./playlists-step.js";
import { defineDanceButton } from "./own-dances.js";

/** The starting library's entry for a song, or null. */
const libraryEntry = (id) => state.existing.find((song) => song.id === id) ?? null;

/** What the library says about a song: its dances, "removed on <date>" if removed before, else `fallback`. */
function libraryStatus(id, fallback) {
  const entry = libraryEntry(id);
  if (entry) return entry.dances.join(", ") || "(no dance)";
  const removed = state.blacklist.get(id);
  if (removed) return `removed from the library${removed.removed ? ` on ${removed.removed}` : ""}`;
  return fallback;
}

/** Add songs to the worklist (skipping ones already on it). Returns how many were new. */
function addToWorklist(songs, source, include) {
  const onList = new Set(state.manual.map((entry) => entry.song.id));
  let addedCount = 0;
  for (const song of songs) {
    if (onList.has(song.id)) continue;
    onList.add(song.id);
    state.manual.push({ song, include, dances: [], tags: [], source });
    addedCount++;
  }
  return addedCount;
}

/** Whether a worklist song has no dance at all (none given here, none in the library). */
const hasNoDance = (entry) => !entry.dances.length && !(libraryEntry(entry.song.id) || { dances: [] }).dances.length;

export function renderManual(message) {
  const box = $("manual");
  if (!isLoggedIn()) return fill(box, el("p", { class: "muted" }, "Log in first (step 1)."));
  const status = el("p", { class: "muted" }, message || "");

  /* --- single songs: paste links --- */
  const linksBox = el("textarea", { rows: 3, placeholder: "https://open.spotify.com/track/…  (one per line)", "aria-label": "Spotify song links",
    style: "width:100%" });
  const addLinks = async () => {
    const lines = linksBox.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const notLinks = lines.filter((line) => !spotifyTrackId(line));
    const ids = [...new Set(lines.map(spotifyTrackId).filter(Boolean))];
    const songs = [];
    const failed = [];
    for (const [iId, id] of ids.entries()) {
      status.textContent = `Looking up song ${iId + 1} of ${ids.length}…`;
      try {
        songs.push(await getTrack(id));
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
      }
    }
    const addedCount = addToWorklist(songs, "Added by hand", true);
    linksBox.value = notLinks.join("\n");
    renderManual([
      `${addedCount} song(s) added to the worklist below.`,
      notLinks.length ? `${notLinks.length} line(s) are not Spotify song links and were left in the box.` : "",
      failed.length ? `Could not look up: ${failed.join("; ")}` : "",
    ].filter(Boolean).join(" "));
  };

  /* --- single songs: search --- */
  const queryBox = el("input", { type: "text", value: state.spotifySearch.query, placeholder: "title and/or artist", "aria-label": "Search Spotify", style: "flex:1 1 16em" });
  const runSearch = async (offset = 0) => {
    state.spotifySearch.query = queryBox.value.trim();
    if (!state.spotifySearch.query) return;
    status.textContent = "Searching…";
    try {
      const found = await searchTracks(state.spotifySearch.query, offset);
      state.spotifySearch.results = offset ? [...state.spotifySearch.results, ...found.songs] : found.songs;
      state.spotifySearch.total = found.total;
      state.spotifySearch.nextOffset = found.nextOffset;
      renderManual();
    } catch (err) {
      status.textContent = err.message;
    }
  };
  queryBox.addEventListener("keydown", (event) => event.key === "Enter" && (event.preventDefault(), runSearch(0)));
  const onList = new Set(state.manual.map((entry) => entry.song.id));
  const searchResults = state.spotifySearch.results.length > 0 &&
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["", "Title", "Artist", "Album", "Length", "In library"].map((heading) => el("th", { scope: "col" }, heading)))),
        el("tbody", {}, state.spotifySearch.results.map((song) => {
          return el("tr", {},
            el("td", {}, onList.has(song.id)
              ? el("span", { class: "muted" }, "on list")
              : el("button", { type: "button", class: "small", onclick: () => { addToWorklist([song], "Added by hand", true); renderManual(); } }, "Add")),
            el("td", {}, song.title), el("td", {}, song.artist), el("td", {}, song.album),
            el("td", { class: "num" }, formatTime(song.lengthSec)),
            el("td", { class: "muted" }, libraryStatus(song.id, "")));
        }))),
      el("p", { class: "muted" }, `Showing ${state.spotifySearch.results.length} of ${state.spotifySearch.total}. `,
        state.spotifySearch.nextOffset != null && el("button", { type: "button", class: "small", onclick: () => runSearch(state.spotifySearch.nextOffset) }, "More results")));

  /* --- one playlist, song by song --- */
  const playlistSelect = el("select", { "aria-label": "Playlist to go through" },
    el("option", { value: "" }, state.playlists ? "Choose one of your playlists…" : "(load your playlists first)"),
    (state.playlists || []).map((playlist) => el("option", { value: playlist.id }, `${playlist.name} (${playlist.trackCount ?? "?"} songs)`)));
  const playlistLinkBox = el("input", { type: "text", placeholder: "…or paste a playlist link", "aria-label": "Playlist link", style: "flex:1 1 16em" });
  const loadOnePlaylist = async () => {
    const id = playlistSelect.value || playlistIdFrom(playlistLinkBox.value);
    if (!id) return alert("Choose a playlist or paste a playlist link.");
    const known = (state.playlists || []).find((playlist) => playlist.id === id);
    const name = known ? known.name : "Pasted playlist";
    status.textContent = `Reading “${name}”…`;
    try {
      const songs = await getPlaylistTracks(id, (done, total) => (status.textContent = `Reading “${name}”… ${done} of ${total}`));
      const addedCount = addToWorklist(songs, `${name} (song by song)`, false);
      renderManual(`${addedCount} song(s) from “${name}” added to the worklist, unticked. Give each one its dance(s); typing a dance ticks the song.`);
    } catch (err) {
      renderManual(err.status === 403
        ? "Spotify refused (403): apps can only read playlists you own or collaborate on. Copy the songs into a playlist of your own first."
        : err.message);
    }
  };

  fill(box,
    el("div", { class: "attribution" }, spotifyCredit()),
    el("p", { class: "help" },
      "For songs that are not in a single-dance playlist. A song's dance cannot be guessed from the song alone, so you choose it here. " +
        "Added songs go into the worklist below; ticked songs are added to the review (step 5)."),
    el("h3", {}, "Single songs"),
    el("div", {}, el("div", { class: "label" }, "Paste Spotify song links (Share → Copy song link):"), linksBox,
      el("div", { class: "actions" }, el("button", { type: "button", onclick: addLinks }, "Add these songs"))),
    el("div", { class: "inline-fields" }, "Or search Spotify:", queryBox,
      el("button", { type: "button", onclick: () => runSearch(0) }, "Search")),
    searchResults,
    el("h3", {}, "One playlist, song by song"),
    el("div", { class: "inline-fields" }, playlistSelect, playlistLinkBox,
      el("button", { type: "button", onclick: loadOnePlaylist }, "Load its songs"),
      !state.playlists && el("button", { type: "button", class: "small", onclick: loadPlaylists }, "Load my playlists")),
    status,
    el("h3", {}, `Worklist (${state.manual.length} song${state.manual.length === 1 ? "" : "s"})`),
    renderWorklist());
}

/** The worklist: each song with its tick, dance(s) and tags; bulk adding; and sending ticked songs to the review. */
function renderWorklist() {
  if (!state.manual.length) return el("p", { class: "muted" }, "Empty. Add songs above.");
  const tbody = el("tbody");
  const tickedCount = el("span", { class: "muted" });
  const updateCount = () => {
    const ticked = state.manual.filter((entry) => entry.include);
    const withoutDance = ticked.filter(hasNoDance);
    tickedCount.textContent = `${ticked.length} ticked` + (withoutDance.length ? `, ${withoutDance.length} of them without a dance` : "");
  };
  const visible = () => state.manual.filter((entry) => !(state.manualHideKnown && libraryEntry(entry.song.id)));
  const drawRows = () => {
    fill(tbody, visible().map((entry) => {
      const tick = el("input", { type: "checkbox", checked: entry.include, "aria-label": `Include ${entry.song.title}`,
        onchange: () => { entry.include = tick.checked; updateCount(); } });
      const dances = danceChips(entry.dances, `Dances for ${entry.song.title}`, () => {
        // Giving a song a dance ticks it.
        if (entry.dances.length && !entry.include) (entry.include = true), (tick.checked = true);
        updateCount();
      });
      const tags = tagChips(entry.tags, `Tags for ${entry.song.title}`);
      return el("tr", {},
        el("td", {}, tick),
        el("td", {}, entry.song.title),
        el("td", {}, entry.song.artist),
        el("td", { class: "num" }, formatTime(entry.song.lengthSec)),
        el("td", { class: "muted" }, libraryStatus(entry.song.id, "new")),
        el("td", {}, dances),
        el("td", {}, tags),
        el("td", { class: "muted" }, entry.source),
        el("td", {}, el("button", { type: "button", class: "icon", title: "Remove from worklist", "aria-label": `Remove ${entry.song.title}`,
          onclick: () => { state.manual = state.manual.filter((other) => other !== entry); renderManual(); } }, "×")));
    }));
    updateCount();
  };

  // Bulk: add a dance or a tag to every ticked song.
  const { wrap: bulkDanceWrap, input: bulkDanceBox } = comboInput({ placeholder: "dance", "aria-label": "Dance to add to ticked songs" },
    knownDances, (value) => (bulkDanceBox.value = value));
  const { wrap: bulkTagWrap, input: bulkTagBox } = comboInput({ placeholder: "tag", "aria-label": "Tag to add to ticked songs" },
    knownTags, (value) => (bulkTagBox.value = value));
  const addToTicked = (key, input, parse) => {
    let values = parse(input.value);
    if (!values.length) return;
    if (key === "dances") {
      // Only known dances (spelled as in the list).
      const known = knownDances();
      const unknown = values.filter((value) => !known.some((name) => name.toLowerCase() === value.toLowerCase()));
      if (unknown.length) return alert(unknownDanceMessage(unknown[0]));
      values = values.map((value) => known.find((name) => name.toLowerCase() === value.toLowerCase()));
    }
    for (const entry of state.manual) if (entry.include) for (const value of values) if (!entry[key].includes(value)) entry[key].push(value);
    input.value = "";
    drawRows();
  };
  const setTicks = (value) => {
    for (const entry of visible()) entry.include = value;
    drawRows();
  };
  const hideKnownBox = el("input", { type: "checkbox", checked: state.manualHideKnown,
    onchange: () => { state.manualHideKnown = hideKnownBox.checked; drawRows(); } });
  drawRows();

  return el("div", {},
    el("div", { class: "inline-fields" },
      el("button", { type: "button", class: "small", onclick: () => setTicks(true) }, "Tick all shown"),
      el("button", { type: "button", class: "small", onclick: () => setTicks(false) }, "Tick none"),
      el("label", { class: "inline-fields" }, hideKnownBox, "Hide songs already in the library"),
      el("button", { type: "button", class: "small", onclick: () => {
        if (confirm("Empty the worklist?")) { state.manual = []; renderManual(); }
      } }, "Empty worklist"),
      defineDanceButton()),
    el("div", { class: "inline-fields" }, "For all ticked songs:",
      bulkDanceWrap, el("button", { type: "button", class: "small", onclick: () => addToTicked("dances", bulkDanceBox, danceList) }, "Add dance"),
      bulkTagWrap, el("button", { type: "button", class: "small", onclick: () => addToTicked("tags", bulkTagBox, splitList) }, "Add tag")),
    el("div", { class: "table-wrap" },
      el("table", { class: "playlist" },
        el("thead", {}, el("tr", {}, ["Include?", "Title", "Artist", "Length", "In library", "Dance(s)", "Tags", "From", ""].map((heading) => el("th", { scope: "col" }, heading)))),
        tbody)),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: () => {
        const ticked = state.manual.filter((entry) => entry.include);
        if (!ticked.length) return alert("Tick at least one song.");
        const withoutDance = ticked.filter(hasNoDance);
        if (withoutDance.length && !confirm(`${withoutDance.length} ticked song(s) have no dance yet. Add them to the review anyway (they will be flagged “No dance”)?`)) return;
        computeRows();
        $("review").scrollIntoView({ behavior: "smooth" });
      } }, "Add ticked songs to the review (step 5)"),
      tickedCount));
}
