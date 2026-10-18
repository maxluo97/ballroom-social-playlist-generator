/**
 * live.js — the live view (live.html): what is playing now, what comes next, during the night itself
 * (the agreed spec, NOTES.md v0.4 "Live view and program").
 *
 * Two layouts of the same page: the Music runner's (live.html) and the Dancers' (live.html?screen=dancers,
 * full screen on a projector). The playlist comes from the generator page (the live plan, see
 * js/live-core.js), so edits made there show up here. About every 5 seconds the page asks Spotify what
 * is playing; between answers it counts the seconds itself. The windows share each answer, so two open
 * screens do not ask twice as often.
 */

import { isLoggedIn, hasScopes, login, getCurrentlyPlaying, syncLogin } from "./spotify.js";
import { SPOTIFY_SCOPES } from "./config.js";
import { el, fill, $, spotifyCredit, spotifyListenLink } from "./dom.js";
import { detailsOf, reloadDetails } from "./song-details.js";
import { spotifyLink } from "./data.js";
import {
  LIVE_PLAN_KEY, LIVE_MATCHES_KEY, LIVE_ADDED_KEY, loadLivePlan, loadMatches, saveMatch, loadAdded, saveAdded,
  liveState, progressNow, clock, inSongsText,
} from "./live-core.js";

const POLL_MS = 5000;
const LIMITED_WAIT_MS = 60000; // after Spotify says "too many requests"
const dancers = new URLSearchParams(location.search).get("screen") === "dancers";
const tone = dancers ? "white" : null; // the Dancers screen is always dark

let plan = loadLivePlan();
let matches = loadMatches(); // songs matched to the plan by hand (shared by the windows)
let added = loadAdded(); // songs added during the night, with their dances
let shown = ""; // what the page shows now (see render), so a new answer about the same song keeps the page as it is
let playing = null; // Spotify's latest answer (see getCurrentlyPlaying)
let lastId = null; // the last planned song played, by ID (indexes change when the playlist is edited)
let problem = null; // { text, login }
let polling = false;
let nextPollAt = 0;
let waitUntil = 0;
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("dpg-live") : null;

const ready = () => isLoggedIn() && hasScopes(SPOTIFY_SCOPES.live);
const lastIndexNow = () => (plan && lastId ? plan.songs.findIndex((x) => x.id === lastId) : -1);
const isrcOf = (id) => (detailsOf(id) || {}).isrc || "";
/** "14", the song's number in the playlist (as in the generator and the program). */
const num = (i) => el("span", { class: "live-num" }, String(i + 1));
const titleOf = (row) => {
  const d = detailsOf(row.id);
  return d ? `${d.title}${d.artist ? ` — ${d.artist}` : ""}` : "";
};

/* ------------------------------------------------------------ Spotify */

/** A new answer (ours, or another window's). Nothing playing: the last song stays, paused. */
function take(answer, mine) {
  if (!answer.song && playing && playing.song) {
    playing = { ...playing, at: answer.at, progressMs: progressNow(playing, answer.at), isPlaying: false, stopped: true };
  } else playing = answer;
  if (mine && channel) channel.postMessage({ answer });
  nextPollAt = Math.max(nextPollAt, answer.at + POLL_MS);
  render(false);
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const answer = await getCurrentlyPlaying();
    problem = null;
    take(answer, true);
  } catch (err) {
    if (err.status === 401) problem = { text: "Log in to Spotify so the live view can see what is playing.", login: true };
    else if (err.status === 403) {
      problem = { text: "Spotify refused (403). This account may not be on the Spotify key's list, or the live view's permission is missing.", login: true };
    } else if (err.status === 429) {
      problem = { text: `${err.message} The live view tries again in a minute.` };
      waitUntil = Date.now() + LIMITED_WAIT_MS;
    } else problem = { text: `Could not ask Spotify what is playing: ${err.message}` };
    render(false);
  } finally {
    polling = false;
    nextPollAt = Math.max(nextPollAt, Date.now() + POLL_MS);
  }
}

if (channel) channel.onmessage = (e) => e.data && e.data.answer && take(e.data.answer, false);

function tick() {
  const now = Date.now();
  if (plan && ready() && !document.hidden && now >= waitUntil) {
    // A song that should have ended: ask at once, rather than wait up to 5 seconds for the next one.
    const ended = playing && playing.song && playing.isPlaying && progressNow(playing, now) >= playing.song.durationMs && now - playing.at > 1500;
    if (now >= nextPollAt || ended) poll();
  }
  renderProgress();
}

/* ------------------------------------------------------------ page */

let progressBar = null;
let progressText = null;

function renderProgress() {
  if (!progressBar || !playing || !playing.song) return;
  const p = progressNow(playing);
  const d = playing.song.durationMs;
  progressBar.style.width = `${d ? Math.min(100, (p / d) * 100) : 0}%`;
  progressText.textContent = `${clock(p)} / ${clock(d)}`;
}

const panel = (cls, ...children) => el("section", { class: `live-panel ${cls}` }, ...children);

/**
 * Draw the page. A new answer from Spotify about the same song (`force` false) only moves the timer,
 * so a dance being typed, or a song being picked, is not wiped out every 5 seconds.
 */
function render(force = true) {
  const box = $("live");
  const now0 = playing && playing.song;
  const sig = JSON.stringify([now0 && now0.id, playing && playing.isPlaying, !!playing, problem && problem.text, ready()]);
  if (!force && sig === shown) return renderProgress();
  shown = sig;
  progressBar = progressText = null;
  if (!plan) {
    fill(box, panel("live-message",
      el("p", {}, "No playlist yet. Generate one on the ", el("a", { href: "index.html" }, "generator page"),
        ", then press ", el("strong", {}, "Live view"), ".")));
    return;
  }
  const st = liveState(plan, playing, lastIndexNow(), { isrcOf, upcomingCount: 5, matches, added });
  if (st.lastIndex >= 0) lastId = plan.songs[st.lastIndex].id;
  const total = plan.songs.length;

  const notice = !ready()
    ? panel("live-message",
      el("p", {}, isLoggedIn()
        ? "The live view needs permission to see what is playing on Spotify (read only). Spotify asks once."
        : "Log in to Spotify so the live view can see what is playing."),
      el("button", { type: "button", class: "primary", onclick: () => login(SPOTIFY_SCOPES.live) }, isLoggedIn() ? "Allow" : "Log in with Spotify"))
    : problem && panel("live-message", el("p", {}, problem.text),
      problem.login && el("button", { type: "button", onclick: () => login(SPOTIFY_SCOPES.live) }, "Log in again"));

  // Now
  let now;
  if (playing && playing.song) {
    const sg = playing.song;
    const status = st.added ? "Added" : st.offPlan ? "Off the plan" : !playing.isPlaying ? "Paused" : "";
    const dance = st.current ? st.current.dance : st.offPlanDance || "—";
    progressBar = el("div", { class: "live-bar-fill" });
    progressText = el("span", { class: "live-time" });
    now = panel("live-now",
      el("div", { class: "live-label" }, "Now", status && el("span", { class: `live-status${st.offPlan && !st.added ? " off" : ""}` }, status)),
      el("div", { class: "live-dance" }, st.index >= 0 && num(st.index), dance,
        !dancers && st.index >= 0 && el("span", { class: "live-of" }, ` of ${total}`)),
      st.current && st.current.block && el("div", { class: "live-block" }, st.current.block),
      st.current && st.current.last && el("div", { class: "live-block" }, "Last dance of the night"),
      el("div", { class: "live-song" }, spotifyListenLink(spotifyLink(sg.id), sg.title, tone), el("span", {}, sg.title),
        sg.artist && el("span", { class: "live-artist" }, ` — ${sg.artist}`)),
      el("div", { class: "live-bar" }, progressBar),
      progressText,
      !dancers && st.offPlan && matchBox(sg, st));
  } else {
    now = panel("live-now",
      el("div", { class: "live-label" }, "Now"),
      el("div", { class: "live-waiting" }, !ready() ? "Not connected to Spotify" : playing ? "Nothing is playing on Spotify" : "Asking Spotify…"));
  }

  // Next dance (not after the last song); then, for the dancers the dance after it, for the music runner the next special block
  const next = st.next && panel("live-next",
    el("div", { class: "live-label" }, st.index < 0 && st.lastIndex < 0 && !st.offPlan ? "First" : "Next dance"),
    el("div", { class: "live-dance small" }, num(st.nextIndex), st.next.dance),
    !dancers && titleOf(st.next) && el("div", { class: "live-song" }, titleOf(st.next)));
  const then = dancers && st.following && panel("live-next",
    el("div", { class: "live-label" }, "Following dance"),
    el("div", { class: "live-dance small" }, num(st.nextIndex + 1), st.following.dance));
  const block = !dancers && st.nextBlock && panel("live-next-block",
    el("div", { class: "live-label" }, "Next special block"),
    el("div", { class: "live-dance small" }, st.nextBlock.label),
    el("div", { class: "live-song" }, inSongsText(st.nextBlock.inSongs)));

  const upcoming = !dancers && st.upcoming.length > 0 && panel("live-upcoming",
    el("div", { class: "live-label" }, "Coming up"),
    el("table", { class: "playlist" }, el("tbody", {},
      st.upcoming.map(({ index, row }) => el("tr", {},
        el("td", { class: "num" }, String(index + 1)),
        el("td", {}, row.dance),
        el("td", {}, titleOf(row)),
        el("td", { class: "muted" }, row.last ? "Last dance" : row.block || ""))))));

  const tools = el("div", { class: "live-tools" },
    !dancers && ready() && el("button", { type: "button", title: "Ask Spotify what is playing right now", onclick: checkNow }, "Check Spotify now"),
    !dancers && el("button", { type: "button", onclick: () => window.open("live.html?screen=dancers", "dpg-live-dancers") }, "Open the Dancers screen"),
    dancers && !document.fullscreenElement && el("button", { type: "button", onclick: () => document.documentElement.requestFullscreen().catch(() => {}) }, "Full screen"));

  fill(box,
    notice,
    now,
    el("div", { class: "live-row" }, next, then, block),
    upcoming,
    el("footer", { class: "live-footer" }, spotifyCredit("Song details from", tone), tools));
  renderProgress();
}

/** Ask Spotify at once (e.g. when the screen seems behind). */
function checkNow() {
  waitUntil = 0;
  nextPollAt = 0;
  poll();
}

/**
 * A song off the plan. Either it is really a planned one (e.g. Spotify played another copy of it):
 * match it by hand (the next planned song is suggested; any other can be picked). Or it was added
 * during the night: give its dance (title and artist come from Spotify). Both are remembered for
 * the night; an added song never changes the order.
 */
function matchBox(sg, st) {
  if (!sg.id) return null;
  const listId = "live-dance-names";
  const names = [...new Set([...plan.songs.map((x) => x.dance), ...Object.values(plan.dances || {}).flatMap((d) => d.split(" / "))])].filter(Boolean).sort();
  const dance = el("input", { type: "text", value: st.offPlanDance, placeholder: "Dance, e.g. Rumba", "aria-label": "Its dance", list: listId });
  const add = () => {
    const d = dance.value.trim();
    if (!d) return dance.focus();
    saveAdded(sg.id, d);
    added = loadAdded();
    render();
  };
  dance.addEventListener("keydown", (e) => e.key === "Enter" && add());
  const addBox = el("div", { class: "live-match" },
    el("p", { class: "help" }, st.added
      ? "Added during the night. Change its dance if needed:"
      : "Or, if it was added during the night, give its dance (the title and artist come from Spotify). The playlist's order does not change."),
    el("div", { class: "inline-fields" }, dance,
      el("datalist", { id: listId }, names.map((n) => el("option", { value: n }))),
      el("button", { type: "button", class: st.added ? "" : "primary", onclick: add }, st.added ? "Change dance" : "Add to the night")));
  if (st.added) return addBox;
  const match = (i) => {
    saveMatch(sg.id, plan.songs[i].id);
    matches = loadMatches();
    render();
  };
  const pick = el("select", { "aria-label": "The planned song this is" },
    plan.songs.map((row, i) => el("option", { value: String(i), selected: i === st.nextIndex }, `${i + 1}  ${row.dance}${titleOf(row) ? ` — ${titleOf(row)}` : ""}`)));
  return el("div", { class: "live-match" },
    el("p", { class: "help" }, "If this is a song from the playlist, say which, and the live view will follow it from here:"),
    el("div", { class: "inline-fields" },
      st.next && el("button", { type: "button", class: "primary", onclick: () => match(st.nextIndex) }, `It's #${st.nextIndex + 1} ${st.next.dance} (the next song)`),
      pick,
      el("button", { type: "button", onclick: () => match(Number(pick.value)) }, "It's this one")),
    addBox,
    el("p", { class: "help" }, `Spotify's ID for it: ${sg.id}`));
}

/* ------------------------------------------------------------ start */

document.body.classList.add(dancers ? "live-dancers" : "live-runner");
document.title = dancers ? "Dancers screen" : "Live view";
addEventListener("storage", (e) => {
  if (e.key === LIVE_PLAN_KEY || e.key === null) plan = loadLivePlan(); // edited or regenerated in the generator
  if (e.key === LIVE_MATCHES_KEY || e.key === null) matches = loadMatches(); // matched by hand in the other window
  if (e.key === LIVE_ADDED_KEY || e.key === null) added = loadAdded(); // a song added in the other window
  if (e.key === "dpg.songDetails.v1" || e.key === null) reloadDetails();
  if (e.key === "dpg.spotify.tokens.v1" || e.key === null) syncLogin(); // logged in or out in another window
  render();
});
document.addEventListener("fullscreenchange", render);
render();
setInterval(tick, 500);
