/**
 * generator.js — rule-based random playlist generator for dance events.
 *
 * Pure logic: no browser, DOM, or Spotify code. Runs in Node and in the browser
 * (load with <script type="module">).
 *
 * VOCABULARY
 *   Song       { id, title, lengthSec, dances: [..], tags: [..] }   (a song may serve several dances)
 *   Dance      a label such as "Waltz" or "Bachata"
 *   Association a group of dances treated as one, e.g. "Waltz" = Smooth Waltz + Standard Waltz.
 *              Applied first: song tags and every dance named in the settings are renamed to the
 *              group name, so the rules below only ever see the merged dances.
 *   Category   a named group of dances ("Ballroom", "Latin", "Swing", ...). Any number (N >= 1).
 *   Excursion  a dance outside the categories, drawn on a timer from a reducing-weight pool
 *   Fixed event a dance placed at a set fraction of the night (line-dance break, Paso Doble, ...)
 *   Theme      dances and/or song tags that should appear at an elevated rate. A song is a
 *              "theme song" if it is played as a theme dance OR carries a theme tag
 *              ("Hollywood night" = tag; "Hustle night" = dance; both may be combined).
 *
 * SETTINGS (all optional except `categories`; see DEFAULT_SETTINGS)
 *   eventLengthMinutes   target length of the night
 *   minSongSec, maxSongSec  songs shorter / longer than this are never played (null = no limit)
 *   associations         [{ name, dances: [...] }, ...]        each dance in at most one association
 *   categories           [{ name, dances: [...] }, ...]        each dance in at most one category
 *   maxInARow            longest block of one category in a row (blocks are 1..maxInARow)
 *   minToRepeat          songs that must separate two songs of the same dance
 *   excursions           { intervalMinutes, jitterMinutes, pool: { dance: maxOccurrences } }
 *   fixedEvents          [{ name, dances: [...], count, at: 0..1, notAfter: [names or dances] }]
 *                        each of the `count` songs is one of `dances`
 *   theme                { name, dances, tags, fractionMin, fractionMax, minGap } or null
 *   themedBlocks         [{ name, source: "tag"|"songs", tag, count, songs: [Spotify IDs], fixedEvent,
 *                           placement: { mode: "at"|"random"|"window", at, from, to },
 *                           interruptBy: { excursions, theme, fixed }, afterInterruption: "continue"|"end" }]
 *   opening              { earlyCount, blacklist: [dances] }
 *   closing              { finalDance }   (null = no designated last dance)
 *   noRepeatWorks        no two versions of the same song (work) in one night (default true)
 *   mustPlay             [Spotify IDs]: songs spread evenly through the night (see NOTES.md v0.2.5)
 *   seed                 integer for reproducible output (null = random)
 *
 * RULES IMPLEMENTED (numbers follow the README where possible)
 *   1. Categories alternate in blocks of 1..maxInARow. One block length is rolled per cycle,
 *      and it is rerolled only after every category has had its turn (cycle order is shuffled,
 *      and a cycle never starts with the category that just ended the previous one).
 *   2. Excursions fire on a timer (every interval ± jitter, the first one too); each draw is weighted
 *      and removes one entry from the pool. When every counter reaches 0, the pool resets to its
 *      starting weights. The theme does not steer which excursion plays.
 *   3/4. Fixed events fire once when the clock passes `at` * length. Two different fixed events
 *      are never back to back, and an event also waits if the previous song matches its `notAfter`.
 *   5. Theme songs (dance or tag) are steered to make up fractionMin..fractionMax of the regular,
 *      hidden-theme and excursion songs: before each regular song, the share decides whether a theme
 *      song is due. Mixed themes then roll between the tag group (one theme tag at random; a song with
 *      it from the current category, shuffle-bag kept, gap lowered step by step down to theme.minGap)
 *      and the dance group (standalone theme dances, i.e. in no category and not excursions, form a
 *      hidden theme category chosen with chance n/(m+n), with its own shuffle-bag and gap n, or
 *      theme.minGap for a theme of one standalone dance; otherwise a theme dance of the current
 *      category, which skips the shuffle-bag but keeps minToRepeat). If neither group can supply a
 *      song, a normal song plays. Hidden theme songs (kind 'theme') do not take category turns.
 *      With a theme, the opening songs (opening.earlyCount) are theme songs. When the theme has dances, those openers are theme
 *      dances that ignore spacing, blocks, the shuffle-bag and the opening blacklist. The theme dances
 *      take turns equally, never the same dance twice in a row (A, B, 4 openers: ABAB or BABA), and
 *      leftover theme dances (more than openers) do not open; standalone theme dances open too. For a tag-only theme, excursion songs with
 *      a theme tag may open too, without using up their excursion counts.
 *   6. (blocks, see 1)
 *   7. Within a category, non-theme dances are drawn from a shuffle-bag (Tetris-style):
 *      no repeat until all the category's non-theme dances have occurred. minToRepeat applies
 *      to every dance, except the designated final song and fixed events.
 *   8. Closing: the final song is reserved up front. Songs are added while the shortest song in
 *      the library would still fit, so the night ends within
 *      (target - shortest song, target + longest song - shortest song].
 *   9. Opening: the first `earlyCount` songs avoid the blacklist.
 *  9b. Duplicates (same recording under another Spotify ID) never play in one night; with
 *      noRepeatWorks, neither do two versions of the same work (relaxed as a last resort). See js/works.js.
 *  10. Movable blocks: a run of `count` songs with one tag, from a fixed point, a random point or a
 *      window (never inside the opening). Turn-taking blocks are regular songs in the normal turns;
 *      fixed-event blocks (kind 'block') play any dance the settings use, outside the turns, never
 *      back to back with a fixed event. Shuffle-bag and spacing apply; too few tagged songs shrink
 *      the block. Excursions, hidden theme songs and fixed events wait during a block unless it may
 *      be interrupted by them; then it continues or ends. Block rows carry blockTag and blockId.
 *
 * If a rule set cannot be satisfied (e.g. too few songs), rules are relaxed in a fixed order
 * (see LEVELS) and a warning is recorded, instead of failing.
 */

import { DANCE_ALIASES, BALLROOM_DANCE_NAMES } from "./dance-names.js";
import { workKey, recordingKey } from "./works.js";

/** Dance names the app knows (plain and ballroom-styled), for spotting typos. */
const KNOWN_DANCE_NAMES = new Set([...Object.keys(DANCE_ALIASES), ...BALLROOM_DANCE_NAMES]);

export const DEFAULT_SETTINGS = {
  eventLengthMinutes: 180,
  minSongSec: null,
  maxSongSec: null,
  associations: [],
  categories: [],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: { intervalMinutes: 25, jitterMinutes: 0, pool: {} },
  fixedEvents: [],
  theme: null,
  themedBlocks: [],
  opening: { earlyCount: 6, blacklist: [] },
  closing: { finalDance: null },
  noRepeatWorks: true,
  mustPlay: [],
  seed: null,
};

const THEME_DEFAULTS = {
  name: "",
  dances: [],
  tags: [],
  fractionMin: 0.5, // broad-theme default; dance-focused themes should use about 0.2-0.25
  fractionMax: 0.7,
  minGap: null, // theme minimum gap; null = the normal gap (minToRepeat) - 2
};

/** A movable block's settings, filled in (see the themed-block spec, NOTES.md v0.2.4). */
export const BLOCK_DEFAULTS = {
  name: "", // shown in the playlist; empty = "<tag> block" or "Chosen songs block"
  source: "tag", // "tag": songs with the tag; "songs": exactly the chosen songs, in their order
  tag: "",
  songs: [],
  count: 4,
  fixedEvent: false,
  placement: { mode: "at", at: 0.5, from: 0.3, to: 0.6 },
  interruptBy: { excursions: false, theme: false, fixed: false },
  afterInterruption: "continue",
};
/** A movable block's name: the user's, else "<tag> block" or "Chosen songs block". */
export const blockLabel = (b) =>
  (b.name && b.name.trim()) || (b.source === "songs" ? "Chosen songs block" : `${b.tag || "Tag"} block`);

/** A random block point is never in the last part of the night. */
const BLOCK_LATEST = 0.85;

/** Order in which rules are relaxed when no legal choice exists. */
const LEVELS = [
  { name: "strict",                    bag: true,  themeOpener: true,  longBlock: false, gapFactor: 1,   blacklist: true,  works: false, reuse: false },
  { name: "shuffle-bag rule relaxed",  bag: false, themeOpener: true,  longBlock: false, gapFactor: 1,   blacklist: true,  works: false, reuse: false },
  { name: "theme opener dropped",      bag: false, themeOpener: false, longBlock: false, gapFactor: 1,   blacklist: true,  works: false, reuse: false },
  { name: "maxInARow exceeded",        bag: false, themeOpener: false, longBlock: true,  gapFactor: 1,   blacklist: true,  works: false, reuse: false },
  { name: "spacing halved",            bag: false, themeOpener: false, longBlock: true,  gapFactor: 0.5, blacklist: true,  works: false, reuse: false },
  { name: "spacing ignored",           bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: true,  works: false, reuse: false },
  { name: "opening blacklist ignored", bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: false, works: false, reuse: false },
  { name: "versions of the same song allowed", bag: false, themeOpener: false, longBlock: true, gapFactor: 0, blacklist: false, works: true, reuse: false },
  { name: "song reuse allowed",        bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: false, works: true,  reuse: true },
];

/* ------------------------------------------------------------------ helpers */

/** Small seedable PRNG so a run can be reproduced from its seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(sec) {
  const sign = sec < 0 ? "-" : "";
  sec = Math.abs(sec);
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

export function mergeSettings(user = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...user,
    associations: user.associations ?? d.associations,
    categories: user.categories ?? d.categories,
    // An event without a name is called after its dances.
    fixedEvents: (user.fixedEvents ?? d.fixedEvents).map((e) => ({ ...e, name: e.name || (e.dances || []).join(" / ") })),
    excursions: { ...d.excursions, ...(user.excursions || {}) },
    opening: { ...d.opening, ...(user.opening || {}) },
    closing: { ...d.closing, ...(user.closing || {}) },
    mustPlay: [...(user.mustPlay ?? d.mustPlay)],
    theme: user.theme ? { ...THEME_DEFAULTS, ...user.theme } : null,
    themedBlocks: (user.themedBlocks ?? d.themedBlocks).map((b) => ({
      ...BLOCK_DEFAULTS,
      ...b,
      placement: { ...BLOCK_DEFAULTS.placement, ...(b.placement || {}) },
      interruptBy: { ...BLOCK_DEFAULTS.interruptBy, ...(b.interruptBy || {}) },
    })),
  };
}

/** Songs always have `dances`; `tags` may be left out. */
function normalizeSong(sg) {
  return { ...sg, dances: sg.dances || [], tags: sg.tags || [] };
}

/* ------------------------------------------------------------- associations */

/** Returns a function mapping a dance to its association name (or itself if unassociated). */
export function associationMap(associations = []) {
  const alias = new Map();
  for (const a of associations) for (const d of a.dances || []) alias.set(d, a.name);
  return (d) => alias.get(d) ?? d;
}

const mapUnique = (list, m) => [...new Set((list || []).map(m))];

/** Settings with associations applied (every dance reference renamed to its group). */
function resolveSettings(userSettings) {
  const s = mergeSettings(userSettings);
  if (!s.associations.length) return s;
  const m = associationMap(s.associations);
  const pool = {};
  for (const [d, w] of Object.entries(s.excursions.pool)) pool[m(d)] = (pool[m(d)] || 0) + w;
  return {
    ...s,
    categories: s.categories.map((c) => ({ ...c, dances: mapUnique(c.dances, m) })),
    excursions: { ...s.excursions, pool },
    fixedEvents: s.fixedEvents.map((e) => ({ ...e, dances: mapUnique(e.dances, m), notAfter: mapUnique(e.notAfter, m) })),
    theme: s.theme ? { ...s.theme, dances: mapUnique(s.theme.dances, m) } : null,
    opening: { ...s.opening, blacklist: mapUnique(s.opening.blacklist, m) },
    closing: { ...s.closing, finalDance: s.closing.finalDance ? m(s.closing.finalDance) : null },
  };
}

/** Songs with associations applied. The original tags are kept in `sourceDances`. */
function resolveSongs(rawSongs, s) {
  const m = associationMap(s.associations);
  return rawSongs.map((raw) => {
    const sg = normalizeSong(raw);
    return { ...sg, sourceDances: sg.dances, dances: mapUnique(sg.dances, m) };
  });
}

/** Whether a song's length is inside the settings' song-length limits (null = no limit). */
export function withinLengthLimits(song, settings) {
  const len = song.lengthSec;
  if (settings.minSongSec > 0 && len < settings.minSongSec) return false;
  if (settings.maxSongSec > 0 && len > settings.maxSongSec) return false;
  return true;
}

/** Distinct dance names in a song list, after associations (for UI pick lists). */
export function listDances(rawSongs, userSettings = {}) {
  const s = mergeSettings(userSettings);
  const set = new Set();
  for (const sg of resolveSongs(rawSongs, s)) sg.dances.forEach((d) => set.add(d));
  return [...set].sort();
}

function validateAssociations(s, rawDances, errors, warnings) {
  const owner = new Map();
  const names = new Set();
  for (const a of s.associations) {
    if (!a.name || !a.name.trim()) {
      errors.push("Every association needs a name.");
      continue;
    }
    if (names.has(a.name)) errors.push(`Two associations are both named "${a.name}".`);
    names.add(a.name);
    if (!a.dances || !a.dances.length) warnings.push(`Association "${a.name}" has no dances.`);
    for (const d of a.dances || []) {
      if (owner.has(d)) errors.push(`Dance "${d}" is in both associations "${owner.get(d)}" and "${a.name}".`);
      owner.set(d, a.name);
      // Members without songs are harmless (the association's own name, or a dance the library may
      // gain later, e.g. plain "Jive"); only unrecognized names are reported, as likely typos.
      if (!rawDances.has(d) && d !== a.name && !KNOWN_DANCE_NAMES.has(d)) {
        warnings.push(`Association "${a.name}": no songs are tagged "${d}" (typo?).`);
      }
    }
  }
  for (const n of names) {
    if (owner.has(n) && owner.get(n) !== n) errors.push(`"${n}" is an association name and also a member of "${owner.get(n)}".`);
  }
}

/** Theme lookups shared by the generator, stats and rule checker. */
function themeInfo(s) {
  const dances = new Set(s.theme ? s.theme.dances : []);
  const tags = new Set(s.theme ? s.theme.tags : []);
  const hasTag = (sg) => (sg.tags || []).some((t) => tags.has(t));
  return {
    active: dances.size > 0 || tags.size > 0,
    dances,
    tags,
    hasTag,
    isThemeSong: (sg, dance) => dances.has(dance) || hasTag(sg),
  };
}

/** The theme minimum gap: how close two theme songs of the same dance may come (see themePlan). */
function themeMinGap(s) {
  const g = s.theme && s.theme.minGap;
  return Number.isFinite(g) && g >= 0 ? g : Math.max(0, s.minToRepeat - 2);
}

/**
 * How the theme's dances are played (the agreed theme spec, NOTES.md v0.2.4):
 *   catDances        theme dances in a category
 *   standalone       theme dances in no category and not excursions: the "hidden theme category"
 *   singleStandalone the theme is one standalone dance and nothing else
 *   standaloneGap    their repeat gap: the theme minimum gap for a single standalone dance, else n
 *   openerDances     the dances that take turns opening a theme with dances
 */
function themePlan(s, th = themeInfo(s)) {
  const inCategory = new Set(s.categories.flatMap((c) => c.dances));
  const pool = s.excursions.pool || {};
  const catDances = [...th.dances].filter((d) => inCategory.has(d));
  const standalone = [...th.dances].filter((d) => !inCategory.has(d) && !(pool[d] > 0));
  const singleStandalone = !th.tags.size && th.dances.size === 1 && standalone.length === 1;
  const minGap = themeMinGap(s);
  return {
    catDances,
    standalone,
    singleStandalone,
    minGap,
    standaloneGap: singleStandalone ? minGap : standalone.length,
    openerDances: [...catDances, ...standalone],
  };
}

/** The theme minimum gap for these settings (default: the normal gap - 2). */
export function themeMinGapFor(userSettings) {
  return themeMinGap(mergeSettings(userSettings));
}

/** Whether the theme minimum gap matters: the theme has tags, or is one standalone dance. */
export function themeMinGapApplies(userSettings) {
  const s = resolveSettings(userSettings);
  if (!s.theme) return false;
  const th = themeInfo(s);
  return th.tags.size > 0 || themePlan(s, th).singleStandalone;
}

/* --------------------------------------------------------------- validation */

/**
 * Check settings against a song list before generating. Returns { errors, warnings }.
 * Errors mean generation would be meaningless; warnings mean it will work but may
 * not satisfy every preference.
 */
export function validateSettings(rawSongs, userSettings) {
  const errors = [];
  const warnings = [];
  const rawDances = new Set(rawSongs.flatMap((sg) => normalizeSong(sg).dances));
  validateAssociations(mergeSettings(userSettings), rawDances, errors, warnings);
  const s = resolveSettings(userSettings);
  const allSongs = resolveSongs(rawSongs, s);
  const songs = allSongs.filter((sg) => withinLengthLimits(sg, s)); // the songs that can actually play
  const merged = s.associations.length ? " (after associations)" : "";
  const countFor = (d) => songs.filter((sg) => sg.dances.includes(d)).length;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

  if (!(s.eventLengthMinutes > 0)) errors.push("Event length must be positive.");
  if (s.minSongSec > 0 && s.maxSongSec > 0 && s.minSongSec > s.maxSongSec) {
    errors.push(`The shortest allowed song (${fmt(s.minSongSec)}) is longer than the longest allowed song (${fmt(s.maxSongSec)}).`);
  }
  const skipped = allSongs.length - songs.length;
  if (skipped > 0) {
    warnings.push(`${skipped} of ${allSongs.length} songs are outside the song length limits and will not be played.`);
  }
  if (!s.categories.length) errors.push("At least one category is required.");
  if (!(s.maxInARow >= 1)) errors.push("maxInARow must be at least 1.");
  if (!(s.minToRepeat >= 0)) errors.push("minToRepeat cannot be negative.");
  if (songs.some((sg) => !(sg.lengthSec > 0))) errors.push("Every song needs a positive lengthSec.");

  const seen = new Map();
  for (const c of s.categories) {
    if (!c.dances || !c.dances.length) errors.push(`Category "${c.name}" has no dances.`);
    for (const d of c.dances || []) {
      if (seen.has(d)) errors.push(`Dance "${d}" is in both "${seen.get(d)}" and "${c.name}"${merged}.`);
      seen.set(d, c.name);
      if (countFor(d) === 0) {
        const outside = allSongs.filter((sg) => sg.dances.includes(d)).length;
        warnings.push(outside
          ? `All ${outside} song(s) tagged "${d}" are outside the song length limits.`
          : `No songs are tagged "${d}".`);
      }
    }
  }

  // Spacing feasibility: with too few dances, minToRepeat forces (or breaks) the order.
  const regular = [...seen.keys()].filter((d) => countFor(d) > 0);
  const black = new Set(s.opening.blacklist);
  if (regular.length && regular.length <= s.minToRepeat) {
    warnings.push(`Only ${regular.length} dances are available but minToRepeat=${s.minToRepeat}; spacing will often be relaxed.`);
  } else if (regular.length && regular.length === s.minToRepeat + 1) {
    warnings.push(
      `With ${regular.length} dances and minToRepeat=${s.minToRepeat}, the dance order is almost fixed; ` +
        `rules will sometimes be relaxed. Consider a lower minToRepeat.`
    );
  }
  const openable = regular.filter((d) => !black.has(d));
  if (s.opening.earlyCount > 1 && openable.length && openable.length <= Math.min(s.minToRepeat, s.opening.earlyCount - 1)) {
    warnings.push(`Only ${openable.length} dances are allowed in the opening but minToRepeat=${s.minToRepeat}; spacing will be relaxed there.`);
  }

  const pool = s.excursions.pool;
  const th = themeInfo(s);
  if (s.theme) {
    if (!th.active) warnings.push("The theme has no dances or tags, so it has no effect.");
    if (s.theme.fractionMin > s.theme.fractionMax) errors.push("Theme fractionMin exceeds fractionMax.");
    for (const d of th.dances) {
      // A theme dance is meant to be played a lot, so it belongs in a category, not among the excursions.
      if (pool[d] > 0) warnings.push(`Theme dance "${d}" is still an excursion. A theme dance belongs in a category; consider removing it from the excursions.`);
      if (!seen.has(d) && !(pool[d] > 0) && countFor(d) === 0) warnings.push(`No songs are tagged "${d}" (theme dance).`);
    }
    for (const t of th.tags) {
      if (!songs.some((sg) => sg.tags.includes(t))) warnings.push(`No songs carry the theme tag "${t}".`);
    }
    if (s.theme.minGap != null && !(s.theme.minGap >= 0)) errors.push("The theme minimum gap cannot be negative.");
    const plan = themePlan(s, th);

    if (!th.tags.size) {
      // Each theme dance can fill at most 1 slot in every (gap + 1): the normal gap for theme dances in a
      // category, the standalone gap for the hidden theme category. Excursions are not steered by the theme.
      const inCats = plan.catDances.filter((d) => countFor(d) > 0);
      const inPool = [...th.dances].filter((d) => !seen.has(d) && pool[d] > 0 && countFor(d) > 0);
      const standalone = plan.standalone.filter((d) => countFor(d) > 0);
      const ceiling = Math.min(1, inCats.length / (s.minToRepeat + 1) + standalone.length / (plan.standaloneGap + 1));
      // Theme dances in no category have a shorter repeat gap (the hidden theme category), so taking
      // them out of their categories can raise the ceiling: suggest it when it would.
      const all = inCats.length + standalone.length;
      const outGap = all === 1 ? plan.minGap : all;
      const outCeiling = Math.min(1, all / (outGap + 1));
      const moveOutHint = inCats.length && outCeiling > ceiling + 1e-9
        ? ` To allow more, remove ${inCats.map((d) => `"${d}"`).join(", ").replace(/, ([^,]*)$/, " and $1")} from ${inCats.length > 1 ? "their categories" : "its category"}: ` +
          `theme dances in no category have a shorter repeat gap, which allows up to about ${pct(outCeiling)}.`
        : "";
      if (inCats.length + standalone.length && s.theme.fractionMin >= ceiling - 1e-9) {
        warnings.push(
          `With ${inCats.length + standalone.length} playable theme dance(s) and their repeat gaps, theme songs can make up ` +
            `at most about ${pct(ceiling)} of songs; the requested minimum (${pct(s.theme.fractionMin)}) will often be missed.` +
            moveOutHint
        );
      }
      // Theme dances only in the excursion pool are limited by how often excursions fire.
      if (!inCats.length && inPool.length && s.excursions.intervalMinutes > 0 && songs.length) {
        const avgLen = songs.reduce((t, sg) => t + sg.lengthSec, 0) / songs.length;
        const share = s.eventLengthMinutes / s.excursions.intervalMinutes / ((s.eventLengthMinutes * 60) / avgLen);
        if (share < s.theme.fractionMin) {
          warnings.push(
            `Theme dances are only excursions, which fire about ${pct(share)} of the time; ` +
              `the requested minimum (${pct(s.theme.fractionMin)}) cannot be reached. Shorten the excursion interval.`
          );
        }
      }
      // Openers are theme dances from the categories and standalone ones (the other rules do not apply to them).
      if (s.opening.earlyCount > 0 && th.dances.size && !inCats.length && !standalone.length) {
        warnings.push(
          `The first ${s.opening.earlyCount} songs should be theme songs, but every theme dance with songs is an excursion, ` +
            `so the openers cannot be theme dances.`
        );
      }
    }
  }

  // Movable blocks: a turn-taking block plays category dances; a fixed-event block any dance the
  // settings use (categories, excursions, standalone theme dances).
  const blockPlan = themePlan(s);
  const usedDances = new Set([...seen.keys(), ...Object.keys(pool).filter((d) => pool[d] > 0), ...blockPlan.standalone]);
  s.themedBlocks.forEach((b, i) => {
    const chosen = b.source === "songs";
    const name = b.name && b.name.trim() ? `Movable block "${b.name.trim()}"`
      : chosen ? `Movable block ${i + 1} (chosen songs)` : b.tag ? `Movable block "${b.tag}"` : `Movable block ${i + 1}`;
    if (chosen) {
      if (!b.songs.length) errors.push(`${name} has no songs chosen.`);
      const ids = new Set(allSongs.map((sg) => sg.id));
      const missing = b.songs.filter((id) => !ids.has(id)).length;
      if (missing) warnings.push(`${name}: ${missing} chosen song(s) are not in the library and will be left out.`);
    } else {
      if (!b.tag) errors.push(`${name} has no tag.`);
      if (!(b.count >= 1)) errors.push(`${name} needs at least 1 song.`);
    }
    const p = b.placement;
    if (p.mode === "at" && !(p.at >= 0 && p.at <= 1)) errors.push(`${name}: its point must be between 0% and 100%.`);
    if (p.mode === "window" && !(p.from >= 0 && p.to <= 1 && p.from <= p.to)) {
      errors.push(`${name}: the window must run from an earlier point to a later one.`);
    }
    if (chosen || !b.tag) return;
    const playable = (sg) => sg.dances.some((d) => (b.fixedEvent ? usedDances.has(d) : seen.has(d)));
    const tagged = songs.filter((sg) => sg.tags.includes(b.tag) && playable(sg)).length;
    if (tagged < b.count) {
      warnings.push(`${name} needs ${b.count} songs with the tag, but only ${tagged} can play in it; it will be shorter.`);
    }
  });

  // Must-play songs: in the library, and with a dance the settings let play.
  for (const id of s.mustPlay) {
    const sg = allSongs.find((x) => x.id === id);
    if (!sg) warnings.push(`A must-play song (${id}) is not in the library and will be left out.`);
    else if (!sg.dances.some((d) => usedDances.has(d))) {
      warnings.push(`Must-play song "${sg.title}" will never play: its dance (${sg.dances.join(", ")}) is not in a category, an excursion or a theme dance.`);
    }
  }

  for (const [d, w] of Object.entries(pool)) {
    if (!(w >= 0)) errors.push(`Excursion weight for "${d}" must be 0 or more.`);
    if (w > 0 && countFor(d) === 0) warnings.push(`No songs are tagged "${d}" (excursion).`);
  }
  for (const ev of s.fixedEvents) {
    if (!(ev.at >= 0 && ev.at <= 1)) errors.push(`Fixed event "${ev.name}": 'at' must be between 0 and 1.`);
    if (!ev.dances.length) errors.push(`Fixed event "${ev.name}" has no dances.`);
    const available = songs.filter((sg) => sg.dances.some((d) => ev.dances.includes(d))).length;
    if (ev.dances.length && available < (ev.count ?? 1)) {
      warnings.push(`Fixed event "${ev.name}" needs ${ev.count ?? 1} song(s) tagged ${ev.dances.map((d) => `"${d}"`).join(" or ")}; only ${available} found.`);
    }
  }
  if (s.closing.finalDance && countFor(s.closing.finalDance) === 0) {
    warnings.push(`No songs are tagged "${s.closing.finalDance}" (final dance).`);
  }
  for (const c of s.categories) {
    if (c.dances && c.dances.length && c.dances.every((d) => black.has(d))) {
      warnings.push(`Every dance in "${c.name}" is on the opening blacklist.`);
    }
  }
  return { errors, warnings };
}

/* ---------------------------------------------------------------- generator */

/**
 * @param rawSongs     array of songs (see vocabulary above)
 * @param userSettings settings object (merged over DEFAULT_SETTINGS)
 * @param options      { songFilter(song, {dance, elapsed, index}) => boolean }  optional hook for
 *                     extra tag-based rules (e.g. "no tempo-change songs in the opening");
 *                     { locked: { keep: [{ position, row }], skipFixed: [event names], skipBlocks: [block ids] } }
 *                     regenerates around locked rows (see lockedForRegeneration in js/playlist-edit.js)
 * @returns { playlist, totalSec, targetSec, overtimeSec, seed, warnings, stats }
 */
export function generatePlaylist(rawSongs, userSettings = {}, options = {}) {
  const s = resolveSettings(userSettings);
  const seed = s.seed ?? ((Math.random() * 2 ** 32) >>> 0);
  const rng = mulberry32(seed);
  const rand = (n) => Math.floor(rng() * n);
  const choice = (arr) => arr[rand(arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const songFilter = options.songFilter || null;

  // Songs outside the length limits are left out entirely, so every rule (including the
  // end-of-night timing, which uses the shortest song) only sees the songs that can play.
  const allSongs = resolveSongs(rawSongs, s);
  const songs = allSongs.filter((sg) => withinLengthLimits(sg, s));
  const songById = new Map(allSongs.map((sg) => [sg.id, sg])); // chosen songs may break the length limits
  const byDance = new Map();
  for (const sg of songs) {
    for (const d of sg.dances) {
      if (!byDance.has(d)) byDance.set(d, []);
      byDance.get(d).push(sg);
    }
  }
  const minLen = songs.length ? Math.min(...songs.map((sg) => sg.lengthSec)) : 0;

  const targetSec = s.eventLengthMinutes * 60;
  const cats = s.categories.map((c) => ({ name: c.name, dances: [...c.dances] }));
  const danceToCat = new Map();
  cats.forEach((c, i) => c.dances.forEach((d) => danceToCat.set(d, i)));
  const th = themeInfo(s);
  const plan = themePlan(s, th);
  const themeLabel = (s.theme && s.theme.name) || "Theme";
  const themeMid = th.active ? (s.theme.fractionMin + s.theme.fractionMax) / 2 : 0;
  const notThemeTag = (sg) => !th.hasTag(sg);
  const blackSet = new Set(s.opening.blacklist);

  const warnings = [];
  const warn = (index, message) => warnings.push({ index, message });

  const playlist = [];
  const history = []; // dance label per slot, used for spacing
  const used = new Set();
  // Duplicates never play in one night; with noRepeatWorks, nor do two versions of one work.
  const recOf = new Map(allSongs.map((sg) => [sg.id, recordingKey(sg)]));
  const workOf = new Map(allSongs.map((sg) => [sg.id, workKey(sg)]));
  // Chosen songs of movable blocks are kept for their block, and so are their duplicates.
  const reservedIds = new Set();
  const reservedRecordings = new Set();
  let placingChosen = false; // a chosen song's work does not count toward the works rule
  const usedRecordings = new Set();
  const usedWorks = new Set();
  let worksRelaxed = false; // set while a relaxation level allows versions of the same song
  const markUsed = (sg) => {
    used.add(sg.id);
    usedRecordings.add(recOf.get(sg.id));
    if (!placingChosen) usedWorks.add(workOf.get(sg.id));
  };
  const fresh = (sg) =>
    !used.has(sg.id) && !usedRecordings.has(recOf.get(sg.id)) &&
    !reservedIds.has(sg.id) && !reservedRecordings.has(recOf.get(sg.id)) &&
    (!s.noRepeatWorks || worksRelaxed || !usedWorks.has(workOf.get(sg.id)));
  // Locked rows ("Regenerate unlocked songs", the agreed spec, NOTES.md v0.2.5): each keeps its place
  // and counts as played from the start (no repeats of it; the repeat gap is kept around it).
  const lockedPlan = options.locked || null;
  const lockedAt = new Map(); // position -> row
  let lockedFinal = null;
  for (const { position, row } of (lockedPlan && lockedPlan.keep) || []) {
    if (row.kind === "final") lockedFinal = row;
    else lockedAt.set(position, row);
    placingChosen = !!(row.chosen || row.mustPlay);
    markUsed(row.song);
    placingChosen = false;
  }
  // A dance with a locked song skips the shuffle-bag tonight (like a theme dance; it keeps the gap),
  // so a locked song coming up never leaves its category's bag stuck.
  const lockedDances = new Set([...lockedAt.values()].filter((row) => row.kind !== "final").map((row) => row.dance));
  /** Whether a locked song of this dance comes up within the next `gap` places. */
  const lockedAhead = (dance, gap, from) => {
    for (let k = 1; k <= gap; k++) {
      const row = lockedAt.get(from + k);
      if (row && row.dance === dance) return true;
    }
    return false;
  };
  /** Whether the next `n` places are free of locked rows (fixed events and blocks need room). */
  const freeFor = (n) => {
    for (let k = 0; k < n; k++) if (lockedAt.has(playlist.length + k)) return false;
    return true;
  };
  let elapsed = 0;
  // The theme share is measured over regular, hidden-theme and excursion songs after the opening (the
  // opening songs are theme songs anyway, so counting them would hold the theme back afterwards).
  const openingCount = th.active ? s.opening.earlyCount : 0;
  let themeBase = 0;
  let themeCount = 0;

  /* ---- song selection ---- */
  const availableSongs = (dance, reuse, require = null) =>
    (byDance.get(dance) || []).filter(
      (sg) =>
        (reuse || fresh(sg)) &&
        (!require || require(sg)) &&
        (!songFilter || songFilter(sg, { dance, elapsed, index: playlist.length }))
    );
  const hasSong = (dance, reuse, require = null) => availableSongs(dance, reuse, require).length > 0;
  /** `require` is a hard song filter; `prefer` is soft (ignored if nothing matches). */
  const pickSong = (dance, reuse = false, { require = null, prefer = null } = {}) => {
    let list = availableSongs(dance, reuse, require);
    if (prefer) {
      const p = list.filter(prefer);
      if (p.length) list = p;
    }
    return list.length ? choice(list) : null;
  };
  const gapAllowed = (dance, gap) => gap <= 0 || (!history.slice(-gap).includes(dance) && !lockedAhead(dance, gap, playlist.length));
  const isEarly = () => playlist.length < s.opening.earlyCount;

  /** Theme steering for the next slot: 'want' | 'avoid' | 'neutral'. */
  function themeMood() {
    if (!th.active) return "neutral";
    const f = themeBase ? themeCount / themeBase : 0;
    if (f < s.theme.fractionMin) return "want";
    if (f > s.theme.fractionMax) return "avoid";
    return rng() < themeMid ? "want" : "neutral";
  }

  function push(dance, song, kind, category, source) {
    const isTheme = kind !== "fixed" && th.isThemeSong(song, dance);
    playlist.push({
      index: playlist.length,
      startSec: elapsed,
      song,
      dance,
      kind, // 'regular' | 'excursion' | 'theme' (hidden theme category) | 'block' (fixed-event movable block) | 'fixed' | 'final'
      category,
      source,
      isTheme,
    });
    history.push(dance);
    markUsed(song);
    elapsed += song.lengthSec;
    if (SHARE_KINDS.has(kind) && playlist.length > openingCount) {
      themeBase++;
      if (isTheme) themeCount++;
    }
  }

  /* ---- category block state ---- */
  const bags = cats.map(() => []);
  let cycleOrder = [];
  let cyclePos = 0;
  let blockLen = 1;
  let blockCount = 0;
  let lastRegularCategory = -1;
  let runLen = 0; // regular songs in a row from lastRegularCategory

  function newCycle() {
    blockLen = rand(Math.max(1, s.maxInARow)) + 1;
    cycleOrder = shuffle(cats.map((_, i) => i));
    if (cats.length > 1 && cycleOrder[0] === lastRegularCategory) {
      const j = 1 + rand(cycleOrder.length - 1);
      [cycleOrder[0], cycleOrder[j]] = [cycleOrder[j], cycleOrder[0]];
    }
    cyclePos = 0;
    blockCount = 0;
  }

  /**
   * Choose a dance within category c under relaxation level L, or null.
   * Returns { dance, require?, prefer? } where require/prefer are song filters for pickSong.
   */
  function selectDance(c, L, mood, openerForced) {
    const cat = cats[c];
    const themeInC = cat.dances.filter((d) => th.dances.has(d));
    const normalC = cat.dances.filter((d) => !th.dances.has(d) && !lockedDances.has(d));
    const lockedInC = cat.dances.filter((d) => !th.dances.has(d) && lockedDances.has(d));
    if (L.bag && normalC.length && bags[c].length === 0) bags[c] = normalC.slice();
    const early = isEarly();
    const gap = Math.floor(s.minToRepeat * L.gapFactor);
    const avoid = L.gapFactor === 1 ? upcomingDances() : null; // a chosen-songs block's dances, unless relaxing
    const ok = (d) =>
      hasSong(d, L.reuse) &&
      !(L.blacklist && early && blackSet.has(d)) &&
      gapAllowed(d, gap) &&
      !(avoid && avoid.has(d));

    // Non-theme dances this level may draw from (the bag, unless the bag rule is relaxed).
    const normalPool = L.bag ? bags[c] : normalC;

    if (mood === "want") {
      const opts = themeInC.filter(ok).map((d) => ({ dance: d }));
      if (th.tags.size) {
        for (const d of normalPool) {
          if (ok(d) && hasSong(d, L.reuse, th.hasTag)) opts.push({ dance: d, require: th.hasTag });
        }
      }
      if (opts.length) return choice(opts);
      if (openerForced) return null; // let another category supply the opener
    }

    const prefer = mood === "avoid" ? notThemeTag : null;
    const pool = !L.bag ? cat.dances : normalC.length || lockedInC.length ? [...bags[c], ...lockedInC] : themeInC;
    const p = pool.filter(ok);
    return p.length ? { dance: choice(p), prefer } : null;
  }

  function commitRegular(c, dance, song) {
    const pos = cycleOrder.indexOf(c);
    if (pos !== cyclePos) {
      cyclePos = pos;
      blockCount = 0;
    }
    push(dance, song, "regular", cats[c].name, null);
    if (!th.dances.has(dance)) bags[c] = bags[c].filter((d) => d !== dance); // (no effect for bag-free dances)
    runLen = c === lastRegularCategory ? runLen + 1 : 1;
    lastRegularCategory = c;
    blockCount++;
    if (blockCount >= blockLen) {
      cyclePos++;
      blockCount = 0;
      if (cyclePos >= cycleOrder.length) newCycle();
    }
  }

  /* ---- theme openers for a theme with dances: the rules (spacing, blocks, shuffle-bag, opening
   * blacklist) do not apply to them. The theme dances take turns in shuffled rounds, so each one
   * opens equally often and no dance opens twice in a row (A and B with 4 openers: ABAB or BABA);
   * with more theme dances than openers, the ones left over simply do not open. Standalone theme
   * dances (the hidden theme category) open too. ---- */
  const openerDances = plan.openerDances;
  const danceOpeners = s.theme && openerDances.length ? s.opening.earlyCount : 0;
  let openerRound = [];
  let lastOpener = null;

  function placeOpener() {
    openerRound = openerRound.filter((d) => hasSong(d, false));
    if (!openerRound.length) {
      openerRound = shuffle(openerDances.filter((d) => hasSong(d, false)));
      if (!openerRound.length) return false;
      // A new round never starts with the dance that ended the last one.
      if (openerRound.length > 1 && openerRound[0] === lastOpener) {
        const j = 1 + rand(openerRound.length - 1);
        [openerRound[0], openerRound[j]] = [openerRound[j], openerRound[0]];
      }
    }
    const dance = openerRound.shift();
    lastOpener = dance;
    const c = danceToCat.get(dance);
    if (c === undefined) push(dance, pickSong(dance, false), "theme", null, themeLabel);
    else {
      push(dance, pickSong(dance, false), "regular", cats[c].name, null);
      // Normal rules resume after the openers: a new block cycle, not starting with the openers' category.
      lastRegularCategory = c;
      runLen = 0;
    }
    if (playlist.length >= danceOpeners) newCycle();
    return true;
  }

  /* ---- theme openers for a tag-only theme: they follow the rules, and excursion songs with a theme
   * tag may open too, without using up their excursion counts. ---- */
  const tagOpeners = th.tags.size && !danceOpeners ? s.opening.earlyCount : 0;

  function tryTagOpenerExcursion() {
    const early = isEarly();
    const allowed = (d) => hasSong(d, false, th.hasTag) && !(early && blackSet.has(d)) && gapAllowed(d, s.minToRepeat);
    const exc = Object.keys(initialPool).filter((d) => initialPool[d] > 0 && allowed(d));
    if (!exc.length) return false;
    // Every dance with a theme song is equally likely to open, excursion or not.
    const inCats = cats.flatMap((c) => c.dances).filter(allowed);
    if (rng() * (exc.length + inCats.length) >= exc.length) return false;
    const dance = choice(exc);
    push(dance, pickSong(dance, false, { require: th.hasTag }), "excursion", null, null);
    return true;
  }

  /* ---- a theme song, when the theme share says one is due (the agreed theme spec, NOTES.md v0.2.4).
   * Mixed themes roll between the tag group and the dance group (weighted by how many tags and theme
   * dances there are); if that group cannot supply a song the other one is tried, and if neither can,
   * the caller plays a normal song. ---- */
  const tagWeight = th.tags.size;
  const danceWeight = plan.catDances.length + plan.standalone.length;
  let hiddenBag = []; // the hidden theme category's shuffle-bag

  function placeThemeSong() {
    const tagFirst = rng() * (tagWeight + danceWeight) < tagWeight;
    return tagFirst ? placeTagSong() || placeThemeDance() : placeThemeDance() || placeTagSong();
  }

  /** The category whose turn it is, or null if its block would run too long. */
  function currentCategory() {
    const c = cycleOrder[cyclePos];
    return cats.length > 1 && c === lastRegularCategory && runLen >= s.maxInARow ? null : c;
  }

  /** Tag group: one theme tag at random; a song with it from the current category, obeying the
   * shuffle-bag; the gap is lowered step by step down to the theme minimum gap if needed. */
  function placeTagSong() {
    if (!tagWeight) return false;
    const c = currentCategory();
    if (c === null) return false;
    const tag = choice([...th.tags]);
    const withTag = (sg) => (sg.tags || []).includes(tag);
    const normalC = cats[c].dances.filter((d) => !th.dances.has(d));
    if (normalC.length && bags[c].length === 0) bags[c] = normalC.slice();
    const candidates = [...bags[c], ...cats[c].dances.filter((d) => th.dances.has(d))];
    const early = isEarly();
    const floor = Math.min(plan.minGap, s.minToRepeat);
    for (let gap = s.minToRepeat; gap >= floor; gap--) {
      // Theme dances (which skip the shuffle-bag) always keep the normal gap.
      const opts = candidates.filter((d) =>
        !(early && blackSet.has(d)) && gapAllowed(d, th.dances.has(d) ? s.minToRepeat : gap) && hasSong(d, false, withTag));
      if (!opts.length) continue;
      const dance = choice(opts);
      commitRegular(c, dance, pickSong(dance, false, { require: withTag }));
      return true;
    }
    return false;
  }

  /** Dance group: the hidden theme category with chance n/(m+n) (always, if no theme dance is in a
   * category), otherwise a theme dance of the current category (no shuffle-bag, normal gap). */
  /** Whether the dance group's roll picks the hidden theme category (n/(m+n); always without category theme dances). */
  const hiddenChosen = () => {
    const n = plan.standalone.length;
    return n > 0 && (!plan.catDances.length || rng() * (cats.length + n) < n);
  };

  /** A song from the hidden theme category: its own shuffle-bag, its own gap. */
  function placeHidden() {
    const early = isEarly();
    hiddenBag = hiddenBag.filter((d) => hasSong(d, false));
    if (!hiddenBag.length) hiddenBag = plan.standalone.filter((d) => hasSong(d, false));
    const avoid = upcomingDances();
    const opts = hiddenBag.filter((d) => !(early && blackSet.has(d)) && gapAllowed(d, plan.standaloneGap) && !(avoid && avoid.has(d)));
    if (!opts.length) return false;
    const dance = choice(opts);
    hiddenBag = hiddenBag.filter((d) => d !== dance);
    push(dance, pickSong(dance, false), "theme", null, themeLabel);
    return true;
  }

  function placeThemeDance() {
    if (!danceWeight) return false;
    const early = isEarly();
    if (hiddenChosen()) return placeHidden();
    const c = currentCategory();
    if (c === null) return false;
    const opts = cats[c].dances.filter((d) =>
      th.dances.has(d) && hasSong(d, false) && !(early && blackSet.has(d)) && gapAllowed(d, s.minToRepeat));
    if (!opts.length) return false;
    const dance = choice(opts);
    commitRegular(c, dance, pickSong(dance, false));
    return true;
  }

  function placeRegular(mood) {
    const tryOrder = [...cycleOrder.slice(cyclePos), ...cycleOrder.slice(0, cyclePos)];
    for (let li = 0; li < LEVELS.length; li++) {
      const L = LEVELS[li];
      // (A theme with dances has its openers placed by placeOpener; this covers tag-only themes.)
      const openerForced = th.active && L.themeOpener && playlist.length < s.opening.earlyCount;
      for (const c of tryOrder) {
        // Falling back to another category is fine, unless it makes that category's run too long.
        const tooLong = cats.length > 1 && c === lastRegularCategory && runLen >= s.maxInARow;
        if (tooLong && !L.longBlock) continue;
        worksRelaxed = L.works;
        const ch = selectDance(c, L, openerForced ? "want" : mood, openerForced);
        const song = ch && pickSong(ch.dance, L.reuse, ch);
        worksRelaxed = false;
        if (!song) continue;
        if (li > 0) warn(playlist.length, `Rule relaxed (${L.name}) to place a ${ch.dance} song.`);
        commitRegular(c, ch.dance, song);
        return true;
      }
    }
    return false;
  }

  /* ---- excursions ---- */
  const initialPool = { ...s.excursions.pool };
  let pool = { ...initialPool };
  const excInterval = s.excursions.intervalMinutes * 60;
  const excActive = excInterval > 0 && Object.values(pool).some((w) => w > 0);
  const excursionGap = () => Math.max(60, excInterval + (rng() * 2 - 1) * (s.excursions.jitterMinutes || 0) * 60);
  let nextExcAt = excActive ? excursionGap() : Infinity;

  function tryExcursion() {
    // README: once every counter has reached 0, the pool resets to its starting weights.
    if (!Object.values(pool).some((w) => w > 0)) pool = { ...initialPool };
    const early = isEarly();
    const avoid = upcomingDances();
    const cands = Object.entries(pool).filter(
      ([d, w]) =>
        w > 0 &&
        !(avoid && avoid.has(d)) &&
        hasSong(d, false) &&
        !(early && blackSet.has(d)) &&
        gapAllowed(d, s.minToRepeat)
    );
    if (!cands.length) return false;
    // The theme is not a deciding factor: just the weighted die.

    const total = cands.reduce((sum, [, w]) => sum + w, 0);
    let r = rng() * total;
    let pick = cands[cands.length - 1][0];
    for (const [d, w] of cands) {
      r -= w;
      if (r < 0) {
        pick = d;
        break;
      }
    }
    pool[pick]--;
    push(pick, pickSong(pick, false), "excursion", null, null);
    do nextExcAt += excursionGap();
    while (nextExcAt <= elapsed);
    return true;
  }

  /* ---- fixed events ---- */
  const fixed = s.fixedEvents
    .map((e) => ({ ...e, count: e.count ?? 1, notAfter: e.notAfter ?? [], triggered: !!lockedPlan && lockedPlan.skipFixed.includes(e.name) }))
    .sort((a, b) => a.at - b.at);
  const queue = [];

  function dueFixedEvent() {
    const last = playlist[playlist.length - 1];
    for (const ev of fixed) {
      if (ev.triggered || elapsed < ev.at * targetSec) continue;
      if (fixedLike(last)) continue; // README: fixed events are never back to back
      if (last && ev.notAfter.some((x) => x === last.source || x === last.dance)) continue;
      return ev;
    }
    return null;
  }

  /* ---- movable blocks (the agreed spec, NOTES.md v0.2.4) ----
   * Each block gets its start time once per night: a fixed point, a random point after the opening
   * songs and before the last 15% of the night, or a random point in a window. It starts at the first
   * song after that time, and never inside the opening (it then waits until the opening is over).
   * A turn-taking block is the next `count` regular songs, each with the tag (category turns as
   * normal); a fixed-event block plays any dance the settings use, with the tag, outside the turns.
   * Both keep the shuffle-bag and the repeat gap; if no tagged song fits, the block shrinks.
   * A chosen-songs block plays exactly its songs, in their order, outside the category turns; they
   * ignore the shuffle-bag, the repeat gap among themselves and the length limits. Songs around them
   * keep the normal gap: the block waits a few songs (at most minToRepeat + 1) until none of its songs
   * would come too soon after the same dance, and anything that interrupts it avoids the dances of
   * its next songs. */
  const avgLen = songs.length ? songs.reduce((sum, sg) => sum + sg.lengthSec, 0) / songs.length : 0;
  const openingFrac = targetSec ? Math.min(BLOCK_LATEST, (s.opening.earlyCount * avgLen) / targetSec) : 0;
  const blockDances = [...new Set([...danceToCat.keys(), ...Object.keys(initialPool).filter((d) => initialPool[d] > 0), ...plan.standalone])];
  const blocks = s.themedBlocks
    .map((b, id) => {
      const p = b.placement;
      const at = p.mode === "random" ? openingFrac + rng() * (BLOCK_LATEST - openingFrac)
        : p.mode === "window" ? p.from + rng() * Math.max(0, p.to - p.from)
          : p.at;
      const interruptBy = { ...b.interruptBy, fixed: b.interruptBy.fixed && !b.fixedEvent };
      const kept = !!lockedPlan && lockedPlan.skipBlocks.includes(id); // already in the playlist (locked)
      const block = { ...b, id, interruptBy, label: blockLabel(b), atSec: at * targetSec, started: kept, placed: 0 };
      if (b.source === "songs") {
        block.list = [];
        for (const raw of b.songs) {
          const sg = songById.get(raw);
          if (!sg) warn(-1, `${block.label}: a chosen song (${raw}) is not in the library, so it was left out.`);
          else if (songFilter && !songFilter(sg, { dance: null, elapsed: 0, index: -1 })) {
            warn(-1, `${block.label}: "${sg.title}" cannot be played, so it was left out.`);
          } else block.list.push(sg);
        }
        block.count = block.list.length;
        for (const sg of block.list) {
          reservedIds.add(sg.id);
          reservedRecordings.add(recOf.get(sg.id));
        }
      }
      return block;
    })
    .filter((b) => (b.source === "songs" ? b.list.length > 0 : b.tag && b.count > 0))
    .sort((a, b) => a.atSec - b.atSec);
  /** Whether a chosen-songs block could start now without any of its songs coming too soon after the same dance. */
  function chosenFit(b) {
    return b.list.slice(0, s.minToRepeat).every((sg, k) => gapAllowed(chosenDance(sg), s.minToRepeat - k));
  }
  /**
   * The dances other songs should avoid now: while a chosen-songs block plays, those of its next songs
   * (for interruptions); while one waits to start, those of its first songs (so the wait ends soon).
   */
  const upcomingDances = () => {
    if (active && active.source === "songs") return new Set(active.list.slice(active.placed, active.placed + s.minToRepeat).map(chosenDance));
    const waiting = !active && blocks.find((b) => b.source === "songs" && !b.started && b.dueSince !== undefined);
    return waiting ? new Set(waiting.list.slice(0, s.minToRepeat).map(chosenDance)) : null;
  };
  /** The dance a chosen song is played as: the first of its dances the settings use. */
  const chosenDance = (sg) => sg.dances.find((d) => blockDances.includes(d)) || sg.dances[0] || "";
  let active = null; // the block being played

  function dueBlock() {
    if (active || playlist.length < s.opening.earlyCount) return null;
    const last = playlist[playlist.length - 1];
    return blocks.find((b) => {
      if (b.started || elapsed < b.atSec || (b.fixedEvent && fixedLike(last))) return false;
      if (b.source !== "songs") return true;
      // A chosen-songs block waits (a few songs at most) until its songs keep the normal gap.
      b.dueSince ??= playlist.length;
      if (chosenFit(b)) return true;
      if (playlist.length - b.dueSince <= s.minToRepeat) return false;
      warn(playlist.length, `Rule relaxed (spacing) to start "${b.label}": a dance in it played too recently.`);
      return true;
    }) || null;
  }

  /** Something interrupted the active block: it goes on afterwards, or ends, as the block says. */
  function interrupted() {
    if (active && active.afterInterruption === "end") active = null;
  }

  function placeBlockSong(b) {
    if (b.source === "songs") {
      const sg = b.list[b.placed];
      const dance = chosenDance(sg);
      const c = danceToCat.get(dance);
      placingChosen = true;
      push(dance, sg, "block", c === undefined ? null : cats[c].name, b.label);
      placingChosen = false;
      Object.assign(playlist[playlist.length - 1], { blockId: b.id, blockLabel: b.label, fixedBlock: !!b.fixedEvent, chosen: true });
      return true;
    }
    const withTag = (sg) => (sg.tags || []).includes(b.tag);
    const bagOrTheme = (c) => {
      const normalC = cats[c].dances.filter((d) => !th.dances.has(d));
      if (normalC.length && bags[c].length === 0) bags[c] = normalC.slice();
      return [...bags[c], ...cats[c].dances.filter((d) => th.dances.has(d))];
    };
    const fits = (d) => gapAllowed(d, s.minToRepeat) && hasSong(d, false, withTag);
    const mark = () =>
      Object.assign(playlist[playlist.length - 1], { blockTag: b.tag, blockId: b.id, blockLabel: b.label, fixedBlock: !!b.fixedEvent });
    if (!b.fixedEvent) {
      // The category whose turn it is; another one only if the turn's category has no tagged song.
      const tryOrder = [...cycleOrder.slice(cyclePos), ...cycleOrder.slice(0, cyclePos)];
      for (const c of tryOrder) {
        if (cats.length > 1 && c === lastRegularCategory && runLen >= s.maxInARow) continue;
        const opts = bagOrTheme(c).filter(fits);
        if (!opts.length) continue;
        const dance = choice(opts);
        commitRegular(c, dance, pickSong(dance, false, { require: withTag }));
        mark();
        return true;
      }
      return false;
    }
    // Fixed-event block: category dances from their shuffle-bags, other dances the settings use as they are.
    const inBags = new Set(cats.flatMap((_, c) => bagOrTheme(c)));
    const opts = blockDances.filter((d) => (!danceToCat.has(d) || inBags.has(d)) && fits(d));
    if (!opts.length) return false;
    const dance = choice(opts);
    const c = danceToCat.get(dance);
    push(dance, pickSong(dance, false, { require: withTag }), "block", c === undefined ? null : cats[c].name, b.label);
    if (c !== undefined && !th.dances.has(dance)) bags[c] = bags[c].filter((d) => d !== dance);
    mark();
    return true;
  }

  /* ---- must-play songs (the agreed spec, NOTES.md v0.2.5) ----
   * Spread evenly after the opening, in random order: song i of k is due at (i+1)/(k+1) of the night.
   * When due, it plays where it fits the rules (its category's turn, shuffle-bag, gap; excursion and
   * standalone theme dances: the gap only); after a few songs it plays anyway, with a warning.
   * Kept for that moment (like chosen songs): never elsewhere, nor its duplicates; versions may play. */
  const inChosenBlocks = new Set(blocks.flatMap((b) => (b.list || []).map((sg) => sg.id)));
  const mustPlay = [];
  for (const raw of s.mustPlay) {
    const sg = songById.get(raw);
    if (!sg) {
      warn(-1, `A must-play song (${raw}) is not in the library, so it was left out.`);
      continue;
    }
    if (inChosenBlocks.has(sg.id)) continue; // it plays in its chosen-songs block, which counts for both
    if (used.has(sg.id)) continue; // a locked row already plays it
    const dance = sg.dances.find((d) => blockDances.includes(d));
    if (!dance) {
      warn(-1, `Must-play song "${sg.title}" never plays: none of its dances is in a category, an excursion or a theme dance.`);
      continue;
    }
    if (songFilter && !songFilter(sg, { dance, elapsed: 0, index: -1 })) {
      warn(-1, `Must-play song "${sg.title}" cannot be played, so it was left out.`);
      continue;
    }
    mustPlay.push({ song: sg, dance, placed: false });
    reservedIds.add(sg.id);
    reservedRecordings.add(recOf.get(sg.id));
  }
  const mustOrder = shuffle(mustPlay);
  mustOrder.forEach((m, i) => (m.dueAt = Math.max(openingFrac, (i + 1) / (mustOrder.length + 1)) * targetSec));
  const MUST_PLAY_WAIT = s.minToRepeat + s.maxInARow * Math.max(1, cats.length); // songs, before it plays anyway

  function placeMustPlay() {
    if (playlist.length < s.opening.earlyCount) return false;
    const m = mustOrder.find((x) => !x.placed && elapsed >= x.dueAt);
    if (!m) return false;
    m.dueSince ??= playlist.length;
    const c = danceToCat.get(m.dance);
    let fits = gapAllowed(m.dance, s.minToRepeat);
    if (fits && c !== undefined) {
      const normalC = cats[c].dances.filter((d) => !th.dances.has(d));
      if (normalC.length && bags[c].length === 0) bags[c] = normalC.slice();
      fits = currentCategory() === c && (th.dances.has(m.dance) || bags[c].includes(m.dance));
    }
    // It plays anyway after a few songs, or when the night is nearly over (so it is never left out).
    const nearlyOver = targetSec - elapsed - finalReserve < m.song.lengthSec + 2 * avgLen;
    if (!fits && !nearlyOver && playlist.length - m.dueSince <= MUST_PLAY_WAIT) return false;
    if (!fits) warn(playlist.length, `Rule relaxed to play must-play song "${m.song.title}" (it was due ${playlist.length - m.dueSince} songs earlier).`);
    placingChosen = true; // other versions of it may play elsewhere
    if (c !== undefined) commitRegular(c, m.dance, m.song);
    else if (plan.standalone.includes(m.dance)) push(m.dance, m.song, "theme", null, themeLabel);
    else push(m.dance, m.song, "excursion", null, null); // does not use up an excursion count
    placingChosen = false;
    playlist[playlist.length - 1].mustPlay = true;
    m.placed = true;
    return true;
  }

  /* ---- closing song (reserved first so nothing else takes it) ---- */
  let finalSong = lockedFinal ? lockedFinal.song : null;
  if (!lockedFinal && s.closing.finalDance) {
    finalSong = pickSong(s.closing.finalDance, false) ?? pickSong(s.closing.finalDance, true);
    if (finalSong) markUsed(finalSong);
    else warn(-1, `No song available for final dance "${s.closing.finalDance}".`);
  }
  const finalReserve = finalSong ? finalSong.lengthSec : 0;

  /**
   * Put a locked row in its place, as it was (block, chosen / must-play marks and all). Locked songs are
   * the user's choice: they stand outside the category turns, the shuffle-bags and the excursion counts
   * (the repeat gap is still kept around them, see lockedAhead).
   */
  const KEPT_FIELDS = ["blockId", "blockLabel", "blockTag", "fixedBlock", "chosen", "mustPlay", "groupLabel", "disbanded", "disbandedFrom", "inserted"];
  function placeLocked(row) {
    const c = row.kind === "regular" ? danceToCat.get(row.dance) : undefined;
    placingChosen = !!(row.chosen || row.mustPlay);
    push(row.dance, row.song, row.kind, c !== undefined ? cats[c].name : row.category ?? null, row.source ?? null);
    placingChosen = false;
    const it = playlist[playlist.length - 1];
    for (const k of KEPT_FIELDS) if (row[k] !== undefined) it[k] = row[k];
    it.locked = true;
  }

  /* ---- main loop: keep adding songs while even the shortest song would still fit ---- */
  newCycle();
  while (playlist.length < 5000 && elapsed + finalReserve + minLen <= targetSec) {
    if (lockedAt.has(playlist.length)) {
      const row = lockedAt.get(playlist.length);
      lockedAt.delete(playlist.length);
      placeLocked(row);
      continue;
    }
    if (queue.length === 0) {
      const ev = dueFixedEvent();
      const bl = dueBlock();
      // A fixed event and a block due together: the one set earlier in the night goes first.
      if (ev && (!bl || ev.at * targetSec <= bl.atSec)) {
        // During a block, a fixed event waits unless the block may be interrupted by it.
        // (A fixed event that would land on a locked place waits for the next free place.)
        if ((!active || active.interruptBy.fixed) && freeFor(ev.count)) {
          ev.triggered = true;
          for (let i = 0; i < ev.count; i++) queue.push(ev);
          interrupted();
        }
      } else if (bl && freeFor(bl.count)) {
        bl.started = true;
        active = bl;
      }
    }
    if (queue.length) {
      const ev = queue.shift();
      // Any of the event's dances; vary them within the event when there is a choice.
      const prev = playlist.length ? playlist[playlist.length - 1] : null;
      const withSongs = (reuse) => ev.dances.filter((d) => hasSong(d, reuse));
      worksRelaxed = s.noRepeatWorks && withSongs(false).length === 0;
      if (worksRelaxed && withSongs(false).length) warn(playlist.length, `Rule relaxed (versions of the same song allowed) for fixed event "${ev.name}".`);
      const reuse = withSongs(false).length === 0;
      let options = withSongs(reuse);
      if (prev && prev.source === ev.name && options.length > 1) options = options.filter((d) => d !== prev.dance);
      const dance = options.length ? choice(options) : null;
      const song = dance && pickSong(dance, reuse);
      worksRelaxed = false;
      if (song) push(dance, song, "fixed", null, ev.name);
      else warn(playlist.length, `No song available for fixed event "${ev.name}".`);
      continue;
    }
    if (playlist.length < danceOpeners) {
      if (placeOpener()) continue;
      warn(playlist.length, "No theme dance song was left for the theme openers.");
    }
    if (playlist.length < tagOpeners && tryTagOpenerExcursion()) continue;
    // A block starts with one of its own songs; interruptions can only come after that.
    const mayInterrupt = (what) => !active || (active.placed > 0 && active.interruptBy[what]);
    if (elapsed >= nextExcAt && mayInterrupt("excursions") && tryExcursion()) {
      interrupted();
      continue;
    }
    if (active) {
      // A hidden theme song may interrupt (if the block allows it) when a theme song is due.
      if (mayInterrupt("theme") && plan.standalone.length && themeMood() === "want" &&
          !(rng() * (tagWeight + danceWeight) < tagWeight) && hiddenChosen() && placeHidden()) {
        interrupted();
        continue;
      }
      if (placeBlockSong(active)) {
        if (++active.placed >= active.count) active = null;
        continue;
      }
      warn(playlist.length, active.placed
        ? `Movable block "${active.label}" shrank to ${active.placed} of ${active.count} songs: no other song with the tag "${active.tag}" fits the rules.`
        : `Movable block "${active.label}" could not play: no song with the tag "${active.tag}" fits the rules at that point.`);
      active = null;
    }
    if (placeMustPlay()) continue;
    // Tag-only openers (and dance openers that ran out of songs) are forced inside placeRegular.
    const openerSlot = th.active && playlist.length < s.opening.earlyCount;
    const mood = themeMood();
    if (mood === "want" && !openerSlot && placeThemeSong()) continue;
    if (!placeRegular(mood === "want" && !openerSlot ? "neutral" : mood)) {
      warn(playlist.length, "No playable song remained; the night was ended early.");
      break;
    }
  }

  // Locked songs that no longer fit before the end of the night are kept anyway, at the end.
  if (lockedAt.size) warn(playlist.length, `${lockedAt.size} locked song(s) no longer fitted in their places before the end of the night, so they were kept at the end.`);
  for (const position of [...lockedAt.keys()].sort((a, b) => a - b)) placeLocked(lockedAt.get(position));
  lockedAt.clear();
  if (queue.length) warn(-1, `Fixed event "${queue[0].name}" was cut short by the end of the night.`);
  for (const m of mustOrder) {
    if (!m.placed) warn(-1, `Must-play song "${m.song.title}" did not play: the night ended first.`);
  }
  if (active) warn(-1, `Movable block "${active.label}" was cut short by the end of the night (${active.placed} of ${active.count} songs).`);
  for (const b of blocks) {
    if (!b.started) warn(-1, `Movable block "${b.label}" never started (the night ended first).`);
  }
  for (const ev of fixed) {
    if (!ev.triggered) warn(-1, `Fixed event "${ev.name}" never fired (night ended first or it was blocked).`);
  }

  if (lockedFinal) {
    push(lockedFinal.dance, lockedFinal.song, "final", lockedFinal.category ?? null, null);
    playlist[playlist.length - 1].locked = true;
  } else if (finalSong) {
    const d = s.closing.finalDance;
    const c = danceToCat.get(d);
    push(d, finalSong, "final", c === undefined ? null : cats[c].name, null);
  }

  const result = {
    playlist,
    totalSec: elapsed,
    targetSec,
    overtimeSec: elapsed - targetSec,
    seed,
    warnings,
    openingCount,
  };
  result.stats = computeStats(result);
  return result;
}

/** Kinds of songs the theme share is measured over. */
const SHARE_KINDS = new Set(["regular", "excursion", "theme", "block"]);
/** Fixed events and fixed-event movable blocks are never back to back. */
const fixedLike = (it) => !!it && (it.kind === "fixed" || (it.kind === "block" && !!it.fixedBlock));

/* -------------------------------------------------------------------- stats */

export function computeStats(result) {
  const pl = result.playlist;
  const perDance = {};
  const perCategory = {};
  for (const it of pl) {
    perDance[it.dance] = (perDance[it.dance] || 0) + 1;
    if (it.category) perCategory[it.category] = (perCategory[it.category] || 0) + 1;
  }
  // Theme share is measured over regular, hidden-theme and excursion songs after the opening songs
  // (result.openingCount; fixed events and the final song excluded).
  const base = pl.filter((it) => SHARE_KINDS.has(it.kind) && it.index >= (result.openingCount || 0));
  const themeFraction = base.length ? base.filter((it) => it.isTheme).length / base.length : 0;
  let longestRun = 0;
  let run = 0;
  let prev = null;
  for (const it of pl) {
    if (it.kind !== "regular") continue;
    run = it.category === prev ? run + 1 : 1;
    prev = it.category;
    longestRun = Math.max(longestRun, run);
  }
  return { songCount: pl.length, perDance, perCategory, themeFraction, longestRun };
}

/* ------------------------------------------------------------ rule checking */

/**
 * Independently verify a generated result against the settings.
 * Returns an array of { rule, index, message }. Empty = all rules held.
 * Used by the test script, and usable in the UI to flag problems.
 */
export function checkRules(result, userSettings) {
  const s = resolveSettings(userSettings);
  const pl = result.playlist;
  const v = [];
  const th = themeInfo(s);
  // Openers of a theme with dances are exempt from spacing, blocks and the opening blacklist.
  const plan = themePlan(s, th);
  const danceOpeners = s.theme && plan.openerDances.length ? s.opening.earlyCount : 0;
  const isOpener = (it) =>
    it.index >= 0 && it.index < danceOpeners && (it.kind === "regular" || it.kind === "theme") && th.dances.has(it.dance);
  // Repeat gaps: standalone theme dances use their own gap; songs with a theme tag may come down to the
  // theme minimum gap; everything else uses minToRepeat.
  const standaloneSet = new Set(plan.standalone);
  const gapFor = (it) =>
    standaloneSet.has(it.dance) ? plan.standaloneGap
      : th.tags.size && !th.dances.has(it.dance) && th.hasTag(it.song) ? Math.min(plan.minGap, s.minToRepeat)
        : s.minToRepeat;
  // A tag-only theme's excursion openers do not use up excursion counts.
  const tagOpeners = th.tags.size && !danceOpeners ? s.opening.earlyCount : 0;

  // 1. block length, measured over the sequence of regular songs
  if (s.categories.length > 1) {
    let run = 0;
    let prev = null;
    for (const it of pl) {
      if (it.kind !== "regular" || it.locked) continue; // locked songs stand outside the turns
      if (isOpener(it)) {
        prev = null;
        continue;
      }
      run = it.category === prev ? run + 1 : 1;
      prev = it.category;
      if (run > s.maxInARow) v.push({ rule: "maxInARow", index: it.index, message: `${run} ${it.category} songs in a row.` });
    }
  }

  // 2. spacing (final song and fixed events are exempt)
  for (const it of pl) {
    if (it.kind === "final" || it.kind === "fixed" || isOpener(it)) continue;
    for (let j = Math.max(0, it.index - gapFor(it)); j < it.index; j++) {
      if (it.chosen && pl[j].chosen && pl[j].blockId === it.blockId) continue; // chosen songs among themselves
      if (it.locked && pl[j].locked) continue; // two songs the user locked
      if (pl[j].dance === it.dance) {
        v.push({ rule: "minToRepeat", index: it.index, message: `${it.dance} repeated after ${it.index - j - 1} song(s).` });
        break;
      }
    }
  }

  // 3. opening
  const black = new Set(s.opening.blacklist);
  for (const it of pl.slice(0, s.opening.earlyCount)) {
    if (["regular", "excursion", "theme"].includes(it.kind) && black.has(it.dance) && !isOpener(it)) {
      v.push({ rule: "earlyBlacklist", index: it.index, message: `${it.dance} in the opening.` });
    }
  }
  if (th.active) {
    for (const it of pl.slice(0, s.opening.earlyCount)) {
      if (it.kind === "regular" && !it.isTheme) v.push({ rule: "themeOpener", index: it.index, message: `${it.dance} is not a theme song.` });
    }
  }

  // 4. shuffle-bag: within each category, a non-theme dance may not repeat until the bag empties
  s.categories.forEach((c) => {
    const lockedHere = new Set(pl.filter((it) => it.locked && it.kind !== "final").map((it) => it.dance));
    const normal = c.dances.filter((d) => !th.dances.has(d) && !lockedHere.has(d));
    if (!normal.length) return;
    let remaining = new Set(normal);
    for (const it of pl) {
      if ((it.kind !== "regular" && it.kind !== "block") || it.chosen || it.locked || it.category !== c.name || th.dances.has(it.dance) || lockedHere.has(it.dance)) continue;
      if (remaining.has(it.dance)) remaining.delete(it.dance);
      else v.push({ rule: "shuffleBag", index: it.index, message: `${c.name}: ${it.dance} repeated before the bag emptied.` });
      if (remaining.size === 0) remaining = new Set(normal);
    }
  });

  // 4b. the hidden theme category's shuffle-bag: no standalone theme dance repeats until all have played
  if (plan.standalone.length > 1) {
    let remaining = new Set(plan.standalone);
    for (const it of pl) {
      if (it.kind !== "theme" || isOpener(it) || it.mustPlay) continue;
      if (remaining.has(it.dance)) remaining.delete(it.dance);
      else v.push({ rule: "themeBag", index: it.index, message: `${it.dance} repeated before every standalone theme dance had played.` });
      if (remaining.size === 0) remaining = new Set(plan.standalone);
    }
  }

  // 5. excursion pool: each draw needs a positive counter; the pool resets when all reach 0
  const initial = s.excursions.pool;
  let pool = { ...initial };
  for (const it of pl) {
    if (it.kind !== "excursion") continue;
    if (it.index < tagOpeners && th.hasTag(it.song)) continue;
    if (it.mustPlay || it.locked) continue; // must-play and locked songs do not use up an excursion count
    if (!Object.values(pool).some((w) => w > 0)) pool = { ...initial };
    if (!(pool[it.dance] > 0)) v.push({ rule: "excursionPool", index: it.index, message: `${it.dance} drawn with no count left in the pool.` });
    else pool[it.dance]--;
  }

  // 6. fixed events: right count, not before their time, never back to back with another event
  for (const ev of s.fixedEvents) {
    const name = ev.name;
    const items = pl.filter((it) => it.kind === "fixed" && it.source === name && !it.disbanded);
    if (pl.some((it) => it.source === name && (it.locked || it.disbanded))) continue; // kept (and maybe changed) by the user
    if (items.length !== (ev.count ?? 1)) v.push({ rule: "fixedEvent", index: -1, message: `"${name}" appeared ${items.length}x, expected ${ev.count ?? 1}.` });
    for (const it of items) {
      if (!ev.dances.includes(it.dance)) v.push({ rule: "fixedEventDance", index: it.index, message: `"${name}" played ${it.dance}, which is not one of its dances.` });
    }
    if (items.length && result.targetSec && items[0].startSec < ev.at * result.targetSec) {
      v.push({ rule: "fixedEventTime", index: items[0].index, message: `"${name}" started before ${(ev.at * 100).toFixed(0)}% of the night.` });
    }
    for (const it of items) {
      if (it.index === 0) continue;
      const before = pl[it.index - 1];
      if (fixedLike(before) && before.source !== name) {
        v.push({ rule: "fixedAdjacent", index: it.index, message: `"${name}" directly after fixed event "${before.source}".` });
      } else if (before.source !== name && (ev.notAfter || []).some((x) => x === before.source || x === before.dance)) {
        v.push({ rule: "notAfter", index: it.index, message: `"${name}" directly after ${before.source ?? before.dance}.` });
      }
    }
  }

  // 6a. movable blocks: songs carry the tag, never in the opening, no more songs than asked for, not
  // before their point (fixed point / window start), and a fixed-event block never directly follows
  // a fixed event (or another such block)
  const blockDefs = mergeSettings(userSettings).themedBlocks;
  const byBlock = new Map();
  for (const it of pl) {
    if (it.blockId === undefined) continue;
    if (!byBlock.has(it.blockId)) byBlock.set(it.blockId, []);
    byBlock.get(it.blockId).push(it);
    if (!it.chosen && !(it.song.tags || []).includes(it.blockTag)) {
      v.push({ rule: "blockTag", index: it.index, message: `"${it.song.title}" in the ${it.blockTag} block does not have the tag.` });
    }
    if (it.index < s.opening.earlyCount) v.push({ rule: "blockInOpening", index: it.index, message: `${it.blockTag} block song in the opening.` });
  }
  for (const [id, items] of byBlock) {
    const b = blockDefs[id];
    if (!b || items.some((it) => it.locked)) continue; // kept (and maybe changed) by the user
    const expected = b.source === "songs" ? b.songs.length : b.count;
    if (items.length > expected) v.push({ rule: "blockCount", index: items[0].index, message: `${items[0].blockLabel || b.tag} has ${items.length} songs, expected at most ${expected}.` });
    const earliest = b.placement.mode === "at" ? b.placement.at : b.placement.mode === "window" ? b.placement.from : 0;
    if (result.targetSec && items[0].startSec < earliest * result.targetSec - 1e-6) {
      v.push({ rule: "blockTime", index: items[0].index, message: `${b.tag} block started before ${(earliest * 100).toFixed(0)}% of the night.` });
    }
  }
  for (const it of pl) {
    if (!fixedLike(it) || it.kind !== "block" || it.index === 0) continue;
    const before = pl[it.index - 1];
    if (fixedLike(before) && before.source !== it.source) {
      v.push({ rule: "fixedAdjacent", index: it.index, message: `${it.source} directly after fixed event "${before.source}".` });
    }
  }

  // 6c. duplicates (same recording) never twice; with noRepeatWorks, no two versions of one work
  const recAt = new Map();
  const workAt = new Map();
  for (const it of pl) {
    const rk = recordingKey(it.song);
    const wk = workKey(it.song);
    if (recAt.has(rk) && pl[recAt.get(rk)].song.id !== it.song.id) {
      v.push({ rule: "duplicateRecording", index: it.index, message: `"${it.song.title}" is the same recording as #${recAt.get(rk) + 1}.` });
    } else if (s.noRepeatWorks && !it.chosen && !it.mustPlay && workAt.has(wk) && pl[workAt.get(wk)].song.id !== it.song.id) {
      v.push({ rule: "sameWork", index: it.index, message: `"${it.song.title}" is another version of #${workAt.get(wk) + 1} ("${pl[workAt.get(wk)].song.title}").` });
    }
    if (!recAt.has(rk)) recAt.set(rk, it.index);
    if (!workAt.has(wk) && !it.chosen && !it.mustPlay) workAt.set(wk, it.index); // chosen / must-play songs: other versions may play
  }

  // 6b. song length limits
  for (const it of pl) {
    if (!it.chosen && !it.mustPlay && !withinLengthLimits(it.song, s)) {
      v.push({ rule: "songLength", index: it.index, message: `"${it.song.title}" (${it.song.lengthSec} s) is outside the song length limits.` });
    }
  }

  // 7. closing
  if (s.closing.finalDance) {
    const last = pl[pl.length - 1];
    if (!last || last.dance !== s.closing.finalDance) v.push({ rule: "finalDance", index: pl.length - 1, message: "Last song is not the designated final dance." });
  }

  return v;
}
