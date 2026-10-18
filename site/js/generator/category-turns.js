// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * category-turns.js — the categories taking turns, and the normal ("regular") songs within a turn
 * (README rules 6 and 7).
 *
 *   Turns      A cycle gives every category one turn, in shuffled order (never starting with the
 *              category that just played). All turns of a cycle have the same length, rolled once per
 *              cycle: 1 to maxInARow songs.
 *   Shuffle-bag Within a category, a non-theme dance does not repeat until every one of the category's
 *              non-theme dances has played ("Tetris" order). Theme dances and dances with a locked song
 *              skip the bag.
 *   Relaxing   If no song fits, the rules are relaxed one step at a time (RELAXATION_LEVELS), with a warning.
 */

/** Order in which rules are relaxed when no song fits. Each level says which rules still hold. */
const RELAXATION_LEVELS = [
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

/**
 * The category turns of a night. Returns an object whose state (bags, cycle, the current run) the
 * other parts read and change too: theme songs, special blocks and must-play songs play in the turns.
 */
export function createCategoryTurns(night) {
  const { settings, categories, theme } = night;

  const turns = {
    bags: categories.map(() => []), // per category: the dances not yet played in its current bag
    cycleOrder: [], // the categories' turn order in this cycle (category indexes)
    cyclePosition: 0, // whose turn it is: a place in cycleOrder
    turnLength: 1, // songs per turn in this cycle
    songsInTurn: 0, // songs played in the current turn
    lastRegularCategory: -1, // the category of the last regular song
    runLength: 0, // regular songs in a row from lastRegularCategory
  };

  /** Start a new cycle: roll the turn length and shuffle the order. */
  turns.newCycle = () => {
    turns.turnLength = night.randomInt(Math.max(1, settings.maxInARow)) + 1;
    turns.cycleOrder = night.shuffled(categories.map((_, iCategory) => iCategory));
    // A cycle never starts with the category that ended the last one.
    if (categories.length > 1 && turns.cycleOrder[0] === turns.lastRegularCategory) {
      const iSwap = 1 + night.randomInt(turns.cycleOrder.length - 1);
      [turns.cycleOrder[0], turns.cycleOrder[iSwap]] = [turns.cycleOrder[iSwap], turns.cycleOrder[0]];
    }
    turns.cyclePosition = 0;
    turns.songsInTurn = 0;
  };

  /** Whether one more regular song of this category would make its run longer than maxInARow. */
  turns.runTooLong = (iCategory) =>
    categories.length > 1 && iCategory === turns.lastRegularCategory && turns.runLength >= settings.maxInARow;

  /** The category whose turn it is, or null if one more song would make its run too long. */
  turns.currentCategory = () => {
    const iCategory = turns.cycleOrder[turns.cyclePosition];
    return turns.runTooLong(iCategory) ? null : iCategory;
  };

  /** The categories from the one whose turn it is, round the cycle (to fall back on another one). */
  turns.categoriesFromCurrent = () => [...turns.cycleOrder.slice(turns.cyclePosition), ...turns.cycleOrder.slice(0, turns.cyclePosition)];

  /** Fill a category's bag again with `dances` once it is empty. */
  turns.refillBagIfEmpty = (iCategory, dances) => {
    if (dances.length && turns.bags[iCategory].length === 0) turns.bags[iCategory] = dances.slice();
  };

  /** A category's non-theme dances (the ones the shuffle-bag holds). */
  turns.nonThemeDances = (iCategory) => categories[iCategory].dances.filter((dance) => !theme.dances.has(dance));

  /** The dances a song from a category's bag can be now: the bag (refilled if empty), plus the category's theme dances. */
  turns.bagAndThemeDances = (iCategory) => {
    turns.refillBagIfEmpty(iCategory, turns.nonThemeDances(iCategory));
    return [...turns.bags[iCategory], ...categories[iCategory].dances.filter((dance) => theme.dances.has(dance))];
  };

  /** Play a regular song in a category: it counts toward the turn, and its dance leaves the bag. */
  turns.commitRegular = (iCategory, dance, song) => {
    const position = turns.cycleOrder.indexOf(iCategory);
    if (position !== turns.cyclePosition) {
      // Another category than the one whose turn it was (a fallback): its turn starts now.
      turns.cyclePosition = position;
      turns.songsInTurn = 0;
    }
    night.addSong(dance, song, "regular", categories[iCategory].name, null);
    if (!theme.dances.has(dance)) turns.bags[iCategory] = turns.bags[iCategory].filter((inBag) => inBag !== dance); // (no effect for bag-free dances)
    turns.runLength = iCategory === turns.lastRegularCategory ? turns.runLength + 1 : 1;
    turns.lastRegularCategory = iCategory;
    turns.songsInTurn++;
    if (turns.songsInTurn >= turns.turnLength) {
      turns.cyclePosition++;
      turns.songsInTurn = 0;
      if (turns.cyclePosition >= turns.cycleOrder.length) turns.newCycle();
    }
  };

  /**
   * Choose a dance within a category under a relaxation level, or null. Returns { dance, require?, prefer? }
   * (require / prefer are song filters for night.pickSong). `mood` is the theme's ("want" a theme song,
   * "avoid" one, or "neutral"); `openerForced`: this place must be a theme opener.
   */
  function selectDance(iCategory, level, mood, openerForced) {
    const category = categories[iCategory];
    const themeDancesHere = category.dances.filter((dance) => theme.dances.has(dance));
    const bagDancesHere = category.dances.filter((dance) => !theme.dances.has(dance) && !night.lockedDances.has(dance));
    const lockedDancesHere = category.dances.filter((dance) => !theme.dances.has(dance) && night.lockedDances.has(dance));
    if (level.bag) turns.refillBagIfEmpty(iCategory, bagDancesHere);
    const inOpening = night.isInOpening();
    const gap = Math.floor(settings.minToRepeat * level.gapFactor);
    const avoid = level.gapFactor === 1 ? night.upcomingDances() : null; // a chosen-songs block's dances, unless relaxing
    const fits = (dance) =>
      night.hasSong(dance, level.reuse) &&
      !(level.blacklist && inOpening && night.openingBlacklist.has(dance)) &&
      night.gapAllowed(dance, gap) &&
      !(avoid && avoid.has(dance));

    // Non-theme dances this level may draw from (the bag, unless the bag rule is relaxed).
    const nonThemeChoices = level.bag ? turns.bags[iCategory] : bagDancesHere;

    if (mood === "want") {
      const options = themeDancesHere.filter(fits).map((dance) => ({ dance }));
      if (theme.tags.size) {
        for (const dance of nonThemeChoices) {
          if (fits(dance) && night.hasSong(dance, level.reuse, theme.hasTag)) options.push({ dance, require: theme.hasTag });
        }
      }
      if (options.length) return night.pickRandom(options);
      if (openerForced) return null; // let another category supply the opener
    }

    const prefer = mood === "avoid" ? night.notThemeTag : null;
    const candidates = !level.bag ? category.dances
      : bagDancesHere.length || lockedDancesHere.length ? [...turns.bags[iCategory], ...lockedDancesHere]
        : themeDancesHere;
    const fitting = candidates.filter(fits);
    return fitting.length ? { dance: night.pickRandom(fitting), prefer } : null;
  }

  /**
   * Play a regular song: the category whose turn it is first, then the others; each under the strictest
   * rules first, relaxing one step at a time if nothing fits. Returns false if nothing could play at all.
   */
  turns.placeRegular = (mood) => {
    const categoryOrder = turns.categoriesFromCurrent();
    for (let iLevel = 0; iLevel < RELAXATION_LEVELS.length; iLevel++) {
      const level = RELAXATION_LEVELS[iLevel];
      // (A theme with dances has its openers placed by theme-songs.js; this covers tag-only themes.)
      const openerForced = theme.active && level.themeOpener && night.playlist.length < settings.opening.earlyCount;
      for (const iCategory of categoryOrder) {
        // Falling back to another category is fine, unless it makes that category's run too long.
        if (turns.runTooLong(iCategory) && !level.longBlock) continue;
        night.worksRelaxed = level.works;
        const choice = selectDance(iCategory, level, openerForced ? "want" : mood, openerForced);
        const song = choice && night.pickSong(choice.dance, level.reuse, choice);
        night.worksRelaxed = false;
        if (!song) continue;
        if (iLevel > 0) night.warn(night.playlist.length, `Rule relaxed (${level.name}) to place a ${choice.dance} song.`);
        turns.commitRegular(iCategory, choice.dance, song);
        return true;
      }
    }
    return false;
  };

  return turns;
}
