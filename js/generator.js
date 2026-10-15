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
 *   associations         [{ name, dances: [...] }, ...]        each dance in at most one association
 *   categories           [{ name, dances: [...] }, ...]        each dance in at most one category
 *   maxInARow            longest block of one category in a row (blocks are 1..maxInARow)
 *   minToRepeat          songs that must separate two songs of the same dance
 *   excursions           { intervalMinutes, jitterMinutes, pool: { dance: maxOccurrences } }
 *   fixedEvents          [{ name, dance, count, at: 0..1, notAfter: [names or dances] }]
 *   theme                { name, dances, tags, fractionMin, fractionMax, guaranteedOpeners } or null
 *   opening              { earlyCount, blacklist: [dances] }
 *   closing              { finalDance }   (null = no designated last dance)
 *   seed                 integer for reproducible output (null = random)
 *
 * RULES IMPLEMENTED (numbers follow the README where possible)
 *   1. Categories alternate in blocks of 1..maxInARow. One block length is rolled per cycle,
 *      and it is rerolled only after every category has had its turn (cycle order is shuffled,
 *      and a cycle never starts with the category that just ended the previous one).
 *   2. Excursions fire on a timer; each draw is weighted and removes one entry from the pool.
 *      When every counter reaches 0, the pool resets to its starting weights.
 *   3/4. Fixed events fire once when the clock passes `at` * length. Two different fixed events
 *      are never back to back, and an event also waits if the previous song matches its `notAfter`.
 *   5. Theme songs (dance or tag) are steered to make up fractionMin..fractionMax of the regular
 *      and excursion songs. Theme dances skip the shuffle-bag but obey minToRepeat. The first
 *      `guaranteedOpeners` songs are theme songs.
 *   6. (blocks, see 1)
 *   7. Within a category, non-theme dances are drawn from a shuffle-bag (Tetris-style):
 *      no repeat until all the category's non-theme dances have occurred. minToRepeat applies
 *      to every dance, except the designated final song and fixed events.
 *   8. Closing: the final song is reserved up front. Songs are added while the shortest song in
 *      the library would still fit, so the night ends within
 *      (target - shortest song, target + longest song - shortest song].
 *   9. Opening: the first `earlyCount` songs avoid the blacklist.
 *
 * If a rule set cannot be satisfied (e.g. too few songs), rules are relaxed in a fixed order
 * (see LEVELS) and a warning is recorded, instead of failing.
 */

export const DEFAULT_SETTINGS = {
  eventLengthMinutes: 180,
  associations: [],
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
  tags: [],
  fractionMin: 0.5, // broad-theme default; dance-focused themes should use about 0.2-0.25
  fractionMax: 0.7,
  guaranteedOpeners: 2,
};

/** Order in which rules are relaxed when no legal choice exists. */
const LEVELS = [
  { name: "strict",                    bag: true,  themeOpener: true,  longBlock: false, gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "shuffle-bag rule relaxed",  bag: false, themeOpener: true,  longBlock: false, gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "theme opener dropped",      bag: false, themeOpener: false, longBlock: false, gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "maxInARow exceeded",        bag: false, themeOpener: false, longBlock: true,  gapFactor: 1,   blacklist: true,  reuse: false },
  { name: "spacing halved",            bag: false, themeOpener: false, longBlock: true,  gapFactor: 0.5, blacklist: true,  reuse: false },
  { name: "spacing ignored",           bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: true,  reuse: false },
  { name: "opening blacklist ignored", bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: false, reuse: false },
  { name: "song reuse allowed",        bag: false, themeOpener: false, longBlock: true,  gapFactor: 0,   blacklist: false, reuse: true },
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
    fixedEvents: user.fixedEvents ?? d.fixedEvents,
    excursions: { ...d.excursions, ...(user.excursions || {}) },
    opening: { ...d.opening, ...(user.opening || {}) },
    closing: { ...d.closing, ...(user.closing || {}) },
    theme: user.theme ? { ...THEME_DEFAULTS, ...user.theme } : null,
  };
}

function normalizeSong(sg) {
  const dances = sg.dances ?? (sg.dance ? [sg.dance] : []);
  return { ...sg, dances, tags: sg.tags ?? [] };
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
    fixedEvents: s.fixedEvents.map((e) => ({ ...e, dance: m(e.dance), notAfter: mapUnique(e.notAfter, m) })),
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
      // An association lists its own name by default; that one needs no songs of its own.
      if (!rawDances.has(d) && d !== a.name) warnings.push(`Association "${a.name}": no songs are tagged "${d}".`);
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
  const songs = resolveSongs(rawSongs, s);
  const merged = s.associations.length ? " (after associations)" : "";
  const countFor = (d) => songs.filter((sg) => sg.dances.includes(d)).length;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;

  if (!(s.eventLengthMinutes > 0)) errors.push("Event length must be positive.");
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
      if (countFor(d) === 0) warnings.push(`No songs are tagged "${d}".`);
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
      if (!seen.has(d) && !(pool[d] > 0)) warnings.push(`Theme dance "${d}" is not in any category or the excursion pool, so it will never be played.`);
    }
    for (const t of th.tags) {
      if (!songs.some((sg) => sg.tags.includes(t))) warnings.push(`No songs carry the theme tag "${t}".`);
    }

    if (!th.tags.size) {
      // Each theme dance can fill at most 1 slot in every (minToRepeat + 1).
      const inCats = [...th.dances].filter((d) => seen.has(d) && countFor(d) > 0);
      const inPool = [...th.dances].filter((d) => !seen.has(d) && pool[d] > 0 && countFor(d) > 0);
      const ceiling = Math.min(1, (inCats.length + inPool.length) / (s.minToRepeat + 1));
      if (th.dances.size && s.theme.fractionMin >= ceiling - 1e-9) {
        warnings.push(
          `With ${inCats.length + inPool.length} theme dance(s) and minToRepeat=${s.minToRepeat}, theme songs can make up ` +
            `at most about ${pct(ceiling)} of songs; the requested minimum (${pct(s.theme.fractionMin)}) will often be missed.`
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
      // Openers come from categories; spacing means each one needs a different theme dance.
      const openers = s.theme.guaranteedOpeners;
      const openerDances = inCats.filter((d) => !(s.opening.earlyCount > 0 && black.has(d)));
      const needed = Math.min(openers, s.minToRepeat + 1);
      if (openers > 0 && openerDances.length < needed) {
        warnings.push(
          `The first ${openers} songs should be theme songs, but only ${openerDances.length} theme dance(s) ` +
            `are in a category and allowed in the opening; the opener rule will be relaxed.`
        );
      }
    }
  }

  for (const [d, w] of Object.entries(pool)) {
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
 *                     extra tag-based rules (e.g. "no tempo-change songs in the opening")
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

  const songs = resolveSongs(rawSongs, s);
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
  const themeMid = th.active ? (s.theme.fractionMin + s.theme.fractionMax) / 2 : 0;
  const notThemeTag = (sg) => !th.hasTag(sg);
  const blackSet = new Set(s.opening.blacklist);

  const warnings = [];
  const warn = (index, message) => warnings.push({ index, message });

  const playlist = [];
  const history = []; // dance label per slot, used for spacing
  const used = new Set();
  let elapsed = 0;
  let themeBase = 0; // regular + excursion songs (the theme share is measured over these)
  let themeCount = 0;

  /* ---- song selection ---- */
  const availableSongs = (dance, reuse, require = null) =>
    (byDance.get(dance) || []).filter(
      (sg) =>
        (reuse || !used.has(sg.id)) &&
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
  const gapAllowed = (dance, gap) => gap <= 0 || !history.slice(-gap).includes(dance);
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
      kind, // 'regular' | 'excursion' | 'fixed' | 'final'
      category,
      source,
      isTheme,
    });
    history.push(dance);
    used.add(song.id);
    elapsed += song.lengthSec;
    if (kind === "regular" || kind === "excursion") {
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
    const normalC = cat.dances.filter((d) => !th.dances.has(d));
    if (L.bag && normalC.length && bags[c].length === 0) bags[c] = normalC.slice();
    const early = isEarly();
    const gap = Math.floor(s.minToRepeat * L.gapFactor);
    const ok = (d) =>
      hasSong(d, L.reuse) &&
      !(L.blacklist && early && blackSet.has(d)) &&
      gapAllowed(d, gap);

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
    const pool = !L.bag ? cat.dances : normalC.length ? bags[c] : themeInC;
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
    if (!th.dances.has(dance)) bags[c] = bags[c].filter((d) => d !== dance);
    runLen = c === lastRegularCategory ? runLen + 1 : 1;
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
    const mood = themeMood();
    for (let li = 0; li < LEVELS.length; li++) {
      const L = LEVELS[li];
      const openerForced = th.active && L.themeOpener && playlist.length < s.theme.guaranteedOpeners;
      for (const c of tryOrder) {
        // Falling back to another category is fine, unless it makes that category's run too long.
        const tooLong = cats.length > 1 && c === lastRegularCategory && runLen >= s.maxInARow;
        if (tooLong && !L.longBlock) continue;
        const ch = selectDance(c, L, openerForced ? "want" : mood, openerForced);
        if (!ch) continue;
        const song = pickSong(ch.dance, L.reuse, ch);
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
  let nextExcAt = excActive ? excInterval : Infinity;

  function tryExcursion() {
    // README: once every counter has reached 0, the pool resets to its starting weights.
    if (!Object.values(pool).some((w) => w > 0)) pool = { ...initialPool };
    const early = isEarly();
    let cands = Object.entries(pool).filter(
      ([d, w]) =>
        w > 0 &&
        hasSong(d, false) &&
        !(early && blackSet.has(d)) &&
        gapAllowed(d, s.minToRepeat)
    );
    if (!cands.length) return false;

    const mood = themeMood();
    if (mood === "want") {
      const t = cands.filter(([d]) => th.dances.has(d) || (th.tags.size && hasSong(d, false, th.hasTag)));
      if (t.length) cands = t;
    } else if (mood === "avoid") {
      const t = cands.filter(([d]) => !th.dances.has(d) && hasSong(d, false, notThemeTag));
      if (t.length) cands = t;
    }

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
    const prefer = mood === "want" && !th.dances.has(pick) ? th.hasTag : mood === "avoid" ? notThemeTag : null;
    push(pick, pickSong(pick, false, { prefer }), "excursion", null, null);
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
      if (last && last.kind === "fixed") continue; // README: fixed events are never back to back
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

  /* ---- main loop: keep adding songs while even the shortest song would still fit ---- */
  newCycle();
  while (playlist.length < 5000 && elapsed + finalReserve + minLen <= targetSec) {
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

  if (queue.length) warn(-1, `Fixed event "${queue[0].name}" was cut short by the end of the night.`);
  for (const ev of fixed) {
    if (!ev.triggered) warn(-1, `Fixed event "${ev.name}" never fired (night ended first or it was blocked).`);
  }

  if (finalSong) {
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
  };
  result.stats = computeStats(result);
  return result;
}

/* -------------------------------------------------------------------- stats */

export function computeStats(result) {
  const pl = result.playlist;
  const perDance = {};
  const perCategory = {};
  for (const it of pl) {
    perDance[it.dance] = (perDance[it.dance] || 0) + 1;
    if (it.category) perCategory[it.category] = (perCategory[it.category] || 0) + 1;
  }
  // Theme share is measured over regular and excursion songs (fixed events and the final song excluded).
  const base = pl.filter((it) => it.kind === "regular" || it.kind === "excursion");
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
  if (th.active) {
    for (const it of pl.slice(0, s.theme.guaranteedOpeners)) {
      if (it.kind === "regular" && !it.isTheme) v.push({ rule: "themeOpener", index: it.index, message: `${it.dance} is not a theme song.` });
    }
  }

  // 4. shuffle-bag: within each category, a non-theme dance may not repeat until the bag empties
  s.categories.forEach((c) => {
    const normal = c.dances.filter((d) => !th.dances.has(d));
    if (!normal.length) return;
    let remaining = new Set(normal);
    for (const it of pl) {
      if (it.kind !== "regular" || it.category !== c.name || th.dances.has(it.dance)) continue;
      if (remaining.has(it.dance)) remaining.delete(it.dance);
      else v.push({ rule: "shuffleBag", index: it.index, message: `${c.name}: ${it.dance} repeated before the bag emptied.` });
      if (remaining.size === 0) remaining = new Set(normal);
    }
  });

  // 5. excursion pool: each draw needs a positive counter; the pool resets when all reach 0
  const initial = s.excursions.pool;
  let pool = { ...initial };
  for (const it of pl) {
    if (it.kind !== "excursion") continue;
    if (!Object.values(pool).some((w) => w > 0)) pool = { ...initial };
    if (!(pool[it.dance] > 0)) v.push({ rule: "excursionPool", index: it.index, message: `${it.dance} drawn with no count left in the pool.` });
    else pool[it.dance]--;
  }

  // 6. fixed events: right count, not before their time, never back to back with another event
  for (const ev of s.fixedEvents) {
    const name = ev.name ?? ev.dance;
    const items = pl.filter((it) => it.kind === "fixed" && it.source === name);
    if (items.length !== (ev.count ?? 1)) v.push({ rule: "fixedEvent", index: -1, message: `"${name}" appeared ${items.length}x, expected ${ev.count ?? 1}.` });
    if (items.length && result.targetSec && items[0].startSec < ev.at * result.targetSec) {
      v.push({ rule: "fixedEventTime", index: items[0].index, message: `"${name}" started before ${(ev.at * 100).toFixed(0)}% of the night.` });
    }
    for (const it of items) {
      if (it.index === 0) continue;
      const before = pl[it.index - 1];
      if (before.kind === "fixed" && before.source !== name) {
        v.push({ rule: "fixedAdjacent", index: it.index, message: `"${name}" directly after fixed event "${before.source}".` });
      } else if (before.source !== name && (ev.notAfter || []).some((x) => x === before.source || x === before.dance)) {
        v.push({ rule: "notAfter", index: it.index, message: `"${name}" directly after ${before.source ?? before.dance}.` });
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
