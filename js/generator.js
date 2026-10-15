/**
 * generator.js — rule-based random playlist generator for dance events.
 *
 * Pure logic: no browser, DOM, or Spotify code. Runs in Node and in the browser
 * (load with <script type="module">).
 *
 * VOCABULARY
 *   Song       { id, title, lengthSec, dances: [..] }   (a song may serve several dances)
 *   Dance      a label such as "Waltz" or "Bachata"
 *   Category   a named group of dances ("Ballroom", "Latin", "Swing", ...). Any number (N >= 1).
 *   Excursion  a dance outside the categories, drawn on a timer from a reducing-weight pool
 *   Fixed event a dance placed at a set fraction of the night (line-dance break, Paso Doble, ...)
 *   Theme      dances that should appear at an elevated rate
 *
 * SETTINGS (all optional except `categories`; see DEFAULT_SETTINGS)
 *   eventLengthMinutes   target length of the night
 *   categories           [{ name, dances: [...] }, ...]        each dance in at most one category
 *   maxInARow            longest block of one category in a row (blocks are 1..maxInARow)
 *   minToRepeat          songs that must separate two songs of the same dance
 *   excursions           { intervalMinutes, jitterMinutes, pool: { dance: maxOccurrences } }
 *   fixedEvents          [{ name, dance, count, at: 0..1, notAfter: [names or dances] }]
 *   theme                { name, dances, fractionMin, fractionMax, guaranteedOpeners } or null
 *   opening              { earlyCount, blacklist: [dances] }
 *   closing              { finalDance }   (null = no designated last dance)
 *   seed                 integer for reproducible output (null = random)
 *
 * RULES IMPLEMENTED
 *   1. Categories alternate in blocks of 1..maxInARow. One block length is rolled per cycle,
 *      and it is rerolled only after every category has had its turn (cycle order is shuffled,
 *      and a cycle never starts with the category that just ended the previous one).
 *   2. Within a category, non-theme dances are drawn from a shuffle-bag (Tetris-style):
 *      no repeat until all the category's non-theme dances have occurred.
 *   3. Theme dances skip the bag, but still obey minToRepeat. Their share of regular songs is
 *      steered into [fractionMin, fractionMax].
 *   4. minToRepeat applies to every dance, except the designated final song and fixed events.
 *   5. Excursions fire on a timer; each draw is weighted and removes one entry from the pool.
 *   6. Fixed events fire once when the clock passes `at` * length (and not directly after any
 *      dance/event named in `notAfter`; they wait until it is allowed).
 *   7. Opening: the first `earlyCount` songs avoid the blacklist; the first
 *      `guaranteedOpeners` songs are theme dances.
 *   8. Closing: the final song is reserved up front and the night stops when it would reach
 *      the target length.
 *
 * If a rule set cannot be satisfied (e.g. too few songs), rules are relaxed in a fixed order
 * (see LEVELS) and a warning is recorded, instead of failing.
 */

export const DEFAULT_SETTINGS = {
  eventLengthMinutes: 180,
  categories: [],
  maxInARow: 3,
  minToRepeat: 4,
  excursions: { intervalMinutes: 25, jitterMinutes: 0, pool: {} },
  fixedEvents: [],
  theme: null,
  opening: { earlyCount: 6, blacklist: [] },
  closing: { finalDance: null },
  seed: null,
};

const THEME_DEFAULTS = {
  name: "",
  dances: [],
  fractionMin: 0.25,
  fractionMax: 0.4,
  guaranteedOpeners: 2,
};

/** Order in which rules are relaxed when no legal choice exists. */
const LEVELS = [
  { name: "strict",                       bag: true,  themeOpener: true,  gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "shuffle-bag rule relaxed",     bag: false, themeOpener: true,  gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "spacing halved, opener theme dropped", bag: false, themeOpener: false, gapFactor: 0.5, blacklist: true,  reuse: false },
  { name: "spacing ignored",              bag: false, themeOpener: false, gapFactor: 0,   blacklist: true,  reuse: false },
  { name: "opening blacklist ignored",    bag: false, themeOpener: false, gapFactor: 0,   blacklist: false, reuse: false },
  { name: "song reuse allowed",           bag: false, themeOpener: false, gapFactor: 0,   blacklist: false, reuse: true },
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
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function mergeSettings(user = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...user,
    categories: user.categories ?? d.categories,
    fixedEvents: user.fixedEvents ?? d.fixedEvents,
    excursions: { ...d.excursions, ...(user.excursions || {}) },
    opening: { ...d.opening, ...(user.opening || {}) },
    closing: { ...d.closing, ...(user.closing || {}) },
    theme: user.theme ? { ...THEME_DEFAULTS, ...user.theme } : null,
  };
}

function normalizeSong(sg) {
  const dances = sg.dances ?? (sg.dance ? [sg.dance] : []);
  return { ...sg, dances };
}

/* --------------------------------------------------------------- validation */

/**
 * Check settings against a song list before generating. Returns { errors, warnings }.
 * Errors mean generation would be meaningless; warnings mean it will work but may
 * not satisfy every preference.
 */
export function validateSettings(rawSongs, userSettings) {
  const s = mergeSettings(userSettings);
  const errors = [];
  const warnings = [];
  const songs = rawSongs.map(normalizeSong);
  const countFor = (d) => songs.filter((sg) => sg.dances.includes(d)).length;

  if (!(s.eventLengthMinutes > 0)) errors.push("Event length must be positive.");
  if (!s.categories.length) errors.push("At least one category is required.");
  if (!(s.maxInARow >= 1)) errors.push("maxInARow must be at least 1.");
  if (!(s.minToRepeat >= 0)) errors.push("minToRepeat cannot be negative.");

  const seen = new Map();
  for (const c of s.categories) {
    if (!c.dances || !c.dances.length) errors.push(`Category "${c.name}" has no dances.`);
    for (const d of c.dances || []) {
      if (seen.has(d)) errors.push(`Dance "${d}" is in both "${seen.get(d)}" and "${c.name}".`);
      seen.set(d, c.name);
      if (countFor(d) === 0) warnings.push(`No songs are tagged "${d}".`);
    }
  }

  const themeSet = new Set(s.theme ? s.theme.dances : []);
  for (const d of themeSet) {
    if (!seen.has(d)) warnings.push(`Theme dance "${d}" is not in any category, so it will never be drawn as a theme dance.`);
  }
  if (s.theme) {
    if (s.theme.fractionMin > s.theme.fractionMax) errors.push("Theme fractionMin exceeds fractionMax.");
    const k = [...themeSet].filter((d) => seen.has(d)).length;
    const ceiling = Math.min(1, k / (s.minToRepeat + 1));
    if (k && s.theme.fractionMin > ceiling + 1e-9) {
      warnings.push(
        `With ${k} theme dance(s) and minToRepeat=${s.minToRepeat}, theme songs can make up at most ` +
          `${(ceiling * 100).toFixed(0)}% of regular songs; the requested minimum is ${(s.theme.fractionMin * 100).toFixed(0)}%.`
      );
    }
  }

  for (const [d, w] of Object.entries(s.excursions.pool)) {
    if (!(w >= 0)) errors.push(`Excursion weight for "${d}" must be 0 or more.`);
    if (w > 0 && countFor(d) === 0) warnings.push(`No songs are tagged "${d}" (excursion).`);
  }
  for (const ev of s.fixedEvents) {
    if (!(ev.at >= 0 && ev.at <= 1)) errors.push(`Fixed event "${ev.name ?? ev.dance}": 'at' must be between 0 and 1.`);
    if (countFor(ev.dance) < (ev.count ?? 1)) warnings.push(`Fixed event "${ev.name ?? ev.dance}" needs ${ev.count ?? 1} song(s) tagged "${ev.dance}".`);
  }
  if (s.closing.finalDance && countFor(s.closing.finalDance) === 0) {
    warnings.push(`No songs are tagged "${s.closing.finalDance}" (final dance).`);
  }
  for (const c of s.categories) {
    if (c.dances && c.dances.every((d) => s.opening.blacklist.includes(d))) {
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
 *                     extra tag-based rules (e.g. "no tempo-change songs in the opening")
 * @returns { playlist, totalSec, targetSec, overtimeSec, seed, warnings, stats }
 */
export function generatePlaylist(rawSongs, userSettings = {}, options = {}) {
  const s = mergeSettings(userSettings);
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

  const songs = rawSongs.map(normalizeSong);
  const byDance = new Map();
  for (const sg of songs) {
    for (const d of sg.dances) {
      if (!byDance.has(d)) byDance.set(d, []);
      byDance.get(d).push(sg);
    }
  }

  const targetSec = s.eventLengthMinutes * 60;
  const cats = s.categories.map((c) => ({ name: c.name, dances: [...c.dances] }));
  const danceToCat = new Map();
  cats.forEach((c, i) => c.dances.forEach((d) => danceToCat.set(d, i)));
  const themeSet = new Set(s.theme ? s.theme.dances : []);
  const themeMid = s.theme ? (s.theme.fractionMin + s.theme.fractionMax) / 2 : 0;
  const blackSet = new Set(s.opening.blacklist);

  const warnings = [];
  const warn = (index, message) => warnings.push({ index, message });

  const playlist = [];
  const history = []; // dance label per slot, used for spacing
  const used = new Set();
  let elapsed = 0;
  let regularCount = 0;
  let themeCount = 0;

  /* ---- song selection ---- */
  const availableSongs = (dance, reuse) =>
    (byDance.get(dance) || []).filter(
      (sg) =>
        (reuse || !used.has(sg.id)) &&
        (!songFilter || songFilter(sg, { dance, elapsed, index: playlist.length }))
    );
  const hasSong = (dance, reuse) => availableSongs(dance, reuse).length > 0;
  const pickSong = (dance, reuse = false) => {
    const list = availableSongs(dance, reuse);
    return list.length ? choice(list) : null;
  };
  const gapAllowed = (dance, gap) => gap <= 0 || !history.slice(-gap).includes(dance);
  const isEarly = () => playlist.length < s.opening.earlyCount;

  function push(dance, song, kind, category, source, isTheme = false) {
    playlist.push({
      index: playlist.length,
      startSec: elapsed,
      song,
      dance,
      kind, // 'regular' | 'excursion' | 'fixed' | 'final'
      category,
      source,
      isTheme,
    });
    history.push(dance);
    used.add(song.id);
    elapsed += song.lengthSec;
  }

  /* ---- category block state ---- */
  const bags = cats.map(() => []);
  let cycleOrder = [];
  let cyclePos = 0;
  let blockLen = 1;
  let blockCount = 0;
  let lastRegularCategory = -1;

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

  /** Choose a dance within category c under relaxation level L, or null. */
  function selectDance(c, L) {
    const cat = cats[c];
    const themeInC = cat.dances.filter((d) => themeSet.has(d));
    const normalC = cat.dances.filter((d) => !themeSet.has(d));
    const early = isEarly();
    const gap = Math.floor(s.minToRepeat * L.gapFactor);
    const ok = (d) =>
      hasSong(d, L.reuse) &&
      !(L.blacklist && early && blackSet.has(d)) &&
      gapAllowed(d, gap);

    const openerForced = !!s.theme && L.themeOpener && playlist.length < s.theme.guaranteedOpeners;
    let wantTheme = false;
    if (themeInC.length) {
      if (openerForced) wantTheme = true;
      else {
        const frac = regularCount ? themeCount / regularCount : 0;
        if (frac < s.theme.fractionMin) wantTheme = true;
        else if (frac > s.theme.fractionMax) wantTheme = false;
        else wantTheme = rng() < themeMid;
      }
    }

    if (wantTheme) {
      const p = themeInC.filter(ok);
      if (p.length) return { dance: choice(p), theme: true };
      if (openerForced) return null; // try another category before giving up on the opener rule
    }

    if (!L.bag) {
      const p = cat.dances.filter(ok);
      if (!p.length) return null;
      const d = choice(p);
      return { dance: d, theme: themeSet.has(d) };
    }

    if (normalC.length) {
      if (bags[c].length === 0) bags[c] = normalC.slice();
      const p = bags[c].filter(ok);
      return p.length ? { dance: choice(p), theme: false } : null;
    }
    const p = themeInC.filter(ok);
    return p.length ? { dance: choice(p), theme: true } : null;
  }

  function commitRegular(c, ch, song) {
    const pos = cycleOrder.indexOf(c);
    if (pos !== cyclePos) {
      cyclePos = pos;
      blockCount = 0;
    }
    push(ch.dance, song, "regular", cats[c].name, null, ch.theme);
    regularCount++;
    if (ch.theme) themeCount++;
    if (!ch.theme) bags[c] = bags[c].filter((d) => d !== ch.dance);
    lastRegularCategory = c;
    blockCount++;
    if (blockCount >= blockLen) {
      cyclePos++;
      blockCount = 0;
      if (cyclePos >= cycleOrder.length) newCycle();
    }
  }

  function placeRegular() {
    const tryOrder = [...cycleOrder.slice(cyclePos), ...cycleOrder.slice(0, cyclePos)];
    for (let li = 0; li < LEVELS.length; li++) {
      const L = LEVELS[li];
      for (const c of tryOrder) {
        const ch = selectDance(c, L);
        if (!ch) continue;
        const song = pickSong(ch.dance, L.reuse);
        if (!song) continue;
        if (li > 0) warn(playlist.length, `Rule relaxed (${L.name}) to place a ${ch.dance} song.`);
        commitRegular(c, ch, song);
        return true;
      }
    }
    return false;
  }

  /* ---- excursions ---- */
  const pool = { ...s.excursions.pool };
  const excInterval = s.excursions.intervalMinutes * 60;
  const excActive = excInterval > 0 && Object.values(pool).some((w) => w > 0);
  let nextExcAt = excActive ? excInterval : Infinity;

  function tryExcursion() {
    const early = isEarly();
    const cands = Object.entries(pool).filter(
      ([d, w]) =>
        w > 0 &&
        hasSong(d, false) &&
        !(early && blackSet.has(d)) &&
        gapAllowed(d, s.minToRepeat)
    );
    if (!cands.length) return false;
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
    push(pick, pickSong(pick), "excursion", null, null);
    do {
      const jitter = (rng() * 2 - 1) * (s.excursions.jitterMinutes || 0) * 60;
      nextExcAt += Math.max(60, excInterval + jitter);
    } while (nextExcAt <= elapsed);
    return true;
  }

  /* ---- fixed events ---- */
  const fixed = s.fixedEvents
    .map((e) => ({ ...e, name: e.name ?? e.dance, count: e.count ?? 1, notAfter: e.notAfter ?? [], triggered: false }))
    .sort((a, b) => a.at - b.at);
  const queue = [];

  function dueFixedEvent() {
    const last = playlist[playlist.length - 1];
    for (const ev of fixed) {
      if (ev.triggered || elapsed < ev.at * targetSec) continue;
      if (last && ev.notAfter.some((x) => x === last.source || x === last.dance)) continue;
      return ev;
    }
    return null;
  }

  /* ---- closing song (reserved first so nothing else takes it) ---- */
  let finalSong = null;
  if (s.closing.finalDance) {
    finalSong = pickSong(s.closing.finalDance, false) ?? pickSong(s.closing.finalDance, true);
    if (finalSong) used.add(finalSong.id);
    else warn(-1, `No song available for final dance "${s.closing.finalDance}".`);
  }
  const finalReserve = finalSong ? finalSong.lengthSec : 0;

  /* ---- main loop ---- */
  newCycle();
  while (playlist.length < 5000 && elapsed + finalReserve < targetSec) {
    if (queue.length === 0) {
      const ev = dueFixedEvent();
      if (ev) {
        ev.triggered = true;
        for (let i = 0; i < ev.count; i++) queue.push(ev);
      }
    }
    if (queue.length) {
      const ev = queue.shift();
      const song = pickSong(ev.dance, false) ?? pickSong(ev.dance, true);
      if (song) push(ev.dance, song, "fixed", null, ev.name);
      else warn(playlist.length, `No song available for fixed event "${ev.name}".`);
      continue;
    }
    if (elapsed >= nextExcAt && tryExcursion()) continue;
    if (!placeRegular()) {
      warn(playlist.length, "No playable song remained; the night was ended early.");
      break;
    }
  }

  for (const ev of fixed) {
    if (!ev.triggered) warn(-1, `Fixed event "${ev.name}" never fired (night ended first or it was blocked).`);
  }

  if (finalSong) {
    const d = s.closing.finalDance;
    const c = danceToCat.get(d);
    push(d, finalSong, "final", c === undefined ? null : cats[c].name, null, themeSet.has(d));
  }

  const result = {
    playlist,
    totalSec: elapsed,
    targetSec,
    overtimeSec: elapsed - targetSec,
    seed,
    warnings,
  };
  result.stats = computeStats(result, s);
  return result;
}

/* -------------------------------------------------------------------- stats */

export function computeStats(result, s) {
  const pl = result.playlist;
  const perDance = {};
  const perCategory = {};
  for (const it of pl) {
    perDance[it.dance] = (perDance[it.dance] || 0) + 1;
    if (it.category) perCategory[it.category] = (perCategory[it.category] || 0) + 1;
  }
  const regular = pl.filter((it) => it.kind === "regular");
  const themeFraction = regular.length ? regular.filter((it) => it.isTheme).length / regular.length : 0;
  let longestRun = 0;
  let run = 0;
  let prev = null;
  for (const it of regular) {
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
  const s = mergeSettings(userSettings);
  const pl = result.playlist;
  const v = [];
  const themeSet = new Set(s.theme ? s.theme.dances : []);

  // 1. block length, measured over the sequence of regular songs
  if (s.categories.length > 1) {
    let run = 0;
    let prev = null;
    for (const it of pl) {
      if (it.kind !== "regular") continue;
      run = it.category === prev ? run + 1 : 1;
      prev = it.category;
      if (run > s.maxInARow) v.push({ rule: "maxInARow", index: it.index, message: `${run} ${it.category} songs in a row.` });
    }
  }

  // 2. spacing (final song and fixed events are exempt)
  for (const it of pl) {
    if (it.kind === "final" || it.kind === "fixed") continue;
    for (let j = Math.max(0, it.index - s.minToRepeat); j < it.index; j++) {
      if (pl[j].dance === it.dance) {
        v.push({ rule: "minToRepeat", index: it.index, message: `${it.dance} repeated after ${it.index - j - 1} song(s).` });
        break;
      }
    }
  }

  // 3. opening
  const black = new Set(s.opening.blacklist);
  for (const it of pl.slice(0, s.opening.earlyCount)) {
    if ((it.kind === "regular" || it.kind === "excursion") && black.has(it.dance)) {
      v.push({ rule: "earlyBlacklist", index: it.index, message: `${it.dance} in the opening.` });
    }
  }
  if (s.theme && themeSet.size) {
    for (const it of pl.slice(0, s.theme.guaranteedOpeners)) {
      if (it.kind === "regular" && !it.isTheme) v.push({ rule: "themeOpener", index: it.index, message: `${it.dance} is not a theme dance.` });
    }
  }

  // 4. shuffle-bag: within each category, non-theme dances come in groups with no repeats
  s.categories.forEach((c) => {
    const normal = c.dances.filter((d) => !themeSet.has(d));
    if (!normal.length) return;
    const seq = pl.filter((it) => it.kind === "regular" && it.category === c.name && !it.isTheme);
    for (let i = 0; i < seq.length; i += normal.length) {
      const chunk = seq.slice(i, i + normal.length);
      const names = chunk.map((it) => it.dance);
      if (new Set(names).size !== names.length) {
        v.push({ rule: "shuffleBag", index: chunk[0].index, message: `${c.name}: repeat inside a bag (${names.join(", ")}).` });
      }
    }
  });

  // 5. excursion pool never exceeded
  const excCount = {};
  for (const it of pl) if (it.kind === "excursion") excCount[it.dance] = (excCount[it.dance] || 0) + 1;
  for (const [d, n] of Object.entries(excCount)) {
    if (n > (s.excursions.pool[d] || 0)) v.push({ rule: "excursionPool", index: -1, message: `${d} used ${n}x, pool allows ${s.excursions.pool[d] || 0}.` });
  }

  // 6. fixed events
  for (const ev of s.fixedEvents) {
    const n = pl.filter((it) => it.kind === "fixed" && it.source === (ev.name ?? ev.dance)).length;
    if (n !== (ev.count ?? 1)) v.push({ rule: "fixedEvent", index: -1, message: `"${ev.name ?? ev.dance}" appeared ${n}x, expected ${ev.count ?? 1}.` });
    for (const it of pl) {
      if (it.kind === "fixed" && it.source === (ev.name ?? ev.dance) && it.index > 0) {
        const before = pl[it.index - 1];
        if ((ev.notAfter || []).some((x) => x === before.source || x === before.dance)) {
          v.push({ rule: "notAfter", index: it.index, message: `"${ev.name ?? ev.dance}" directly after ${before.source ?? before.dance}.` });
        }
      }
    }
  }

  // 7. closing
  if (s.closing.finalDance) {
    const last = pl[pl.length - 1];
    if (!last || last.dance !== s.closing.finalDance) v.push({ rule: "finalDance", index: pl.length - 1, message: "Last song is not the designated final dance." });
  }

  return v;
}
