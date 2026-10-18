// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * theme-songs.js — the theme's songs (README rule 5; the agreed theme spec, docs/history.md, v0.2.4).
 *
 *   Openers    With a theme, the opening songs are theme songs. A theme with dances opens with its theme
 *              dances taking turns in shuffled rounds (each opens equally often, none twice in a row; A and
 *              B with 4 openers: ABAB or BABA); the other rules do not apply to them. A tag-only theme's
 *              openers follow the rules, and an excursion song with a theme tag may open too.
 *   Theme songs When the theme share says one is due, a mixed theme rolls between its tags and its dances
 *              (weighted by how many of each); if that group has no song, the other is tried; if neither
 *              has one, a normal song plays.
 *                - Tag group: one theme tag at random; a song with it from the category whose turn it is,
 *                  shuffle-bag kept; the gap is lowered step by step down to the theme minimum gap.
 *                - Dance group: the hidden theme category (standalone theme dances) with chance
 *                  n / (m + n), n standalone dances and m categories (always, if no theme dance is in a
 *                  category); otherwise a theme dance of the current category (no bag, normal gap).
 */

export function createThemeSongs(night, turns) {
  const { settings, categories, categoryOfDance, theme, plan } = night;

  /* ---- openers of a theme with dances ---- */
  const openerDances = plan.openerDances;
  const danceOpenerCount = settings.theme && openerDances.length ? settings.opening.earlyCount : 0;
  let openerRound = []; // the dances still to open in this round
  let lastOpener = null;

  /** Play the next theme-dance opener. Returns false if no theme dance has a song left. */
  function placeOpener() {
    openerRound = openerRound.filter((dance) => night.hasSong(dance, false));
    if (!openerRound.length) {
      openerRound = night.shuffled(openerDances.filter((dance) => night.hasSong(dance, false)));
      if (!openerRound.length) return false;
      // A new round never starts with the dance that ended the last one.
      if (openerRound.length > 1 && openerRound[0] === lastOpener) {
        const iSwap = 1 + night.randomInt(openerRound.length - 1);
        [openerRound[0], openerRound[iSwap]] = [openerRound[iSwap], openerRound[0]];
      }
    }
    const dance = openerRound.shift();
    lastOpener = dance;
    const iCategory = categoryOfDance.get(dance);
    if (iCategory === undefined) night.addSong(dance, night.pickSong(dance, false), "theme", null, night.themeLabel);
    else {
      night.addSong(dance, night.pickSong(dance, false), "regular", categories[iCategory].name, null);
      // Normal rules resume after the openers: a new cycle, not starting with the openers' category.
      turns.lastRegularCategory = iCategory;
      turns.runLength = 0;
    }
    if (night.playlist.length >= danceOpenerCount) turns.newCycle();
    return true;
  }

  /* ---- openers of a tag-only theme ---- */
  const tagOpenerCount = theme.tags.size && !danceOpenerCount ? settings.opening.earlyCount : 0;

  /**
   * Maybe open with an excursion song that has a theme tag (without using up its excursion count):
   * every dance with a theme song is equally likely to open, excursion or not.
   */
  function tryTagOpenerExcursion() {
    const inOpening = night.isInOpening();
    const canOpen = (dance) =>
      night.hasSong(dance, false, theme.hasTag) && !(inOpening && night.openingBlacklist.has(dance)) && night.gapAllowed(dance, settings.minToRepeat);
    const startingPool = settings.excursions.pool;
    const excursionDances = Object.keys(startingPool).filter((dance) => startingPool[dance] > 0 && canOpen(dance));
    if (!excursionDances.length) return false;
    const categoryDances = categories.flatMap((category) => category.dances).filter(canOpen);
    if (night.random() * (excursionDances.length + categoryDances.length) >= excursionDances.length) return false;
    const dance = night.pickRandom(excursionDances);
    night.addSong(dance, night.pickSong(dance, false, { require: theme.hasTag }), "excursion", null, null);
    return true;
  }

  /* ---- a theme song, when one is due ---- */
  const tagWeight = theme.tags.size;
  const danceWeight = plan.catDances.length + plan.standalone.length;
  let hiddenBag = []; // the hidden theme category's shuffle-bag

  /** Roll between the tag group and the dance group (true: tags first). */
  const tagGroupFirst = () => night.random() * (tagWeight + danceWeight) < tagWeight;

  function placeThemeSong() {
    return tagGroupFirst() ? placeTagSong() || placeThemeDance() : placeThemeDance() || placeTagSong();
  }

  /** Tag group: a song with one theme tag, from the current category's bag (or its theme dances). */
  function placeTagSong() {
    if (!tagWeight) return false;
    const iCategory = turns.currentCategory();
    if (iCategory === null) return false;
    const tag = night.pickRandom([...theme.tags]);
    const withTag = (song) => (song.tags || []).includes(tag);
    const candidates = turns.bagAndThemeDances(iCategory);
    const inOpening = night.isInOpening();
    const lowestGap = Math.min(plan.minGap, settings.minToRepeat);
    for (let gap = settings.minToRepeat; gap >= lowestGap; gap--) {
      // Theme dances (which skip the shuffle-bag) always keep the normal gap.
      const options = candidates.filter((dance) =>
        !(inOpening && night.openingBlacklist.has(dance)) &&
        night.gapAllowed(dance, theme.dances.has(dance) ? settings.minToRepeat : gap) &&
        night.hasSong(dance, false, withTag));
      if (!options.length) continue;
      const dance = night.pickRandom(options);
      turns.commitRegular(iCategory, dance, night.pickSong(dance, false, { require: withTag }));
      return true;
    }
    return false;
  }

  /** Whether the dance group's roll picks the hidden theme category: n / (m + n); always without category theme dances. */
  function hiddenChosen() {
    const standaloneCount = plan.standalone.length;
    return standaloneCount > 0 && (!plan.catDances.length || night.random() * (categories.length + standaloneCount) < standaloneCount);
  }

  /** A song of the hidden theme category: its own shuffle-bag, its own gap. */
  function placeHidden() {
    const inOpening = night.isInOpening();
    hiddenBag = hiddenBag.filter((dance) => night.hasSong(dance, false));
    if (!hiddenBag.length) hiddenBag = plan.standalone.filter((dance) => night.hasSong(dance, false));
    const avoid = night.upcomingDances();
    const options = hiddenBag.filter((dance) =>
      !(inOpening && night.openingBlacklist.has(dance)) && night.gapAllowed(dance, plan.standaloneGap) && !(avoid && avoid.has(dance)));
    if (!options.length) return false;
    const dance = night.pickRandom(options);
    hiddenBag = hiddenBag.filter((inBag) => inBag !== dance);
    night.addSong(dance, night.pickSong(dance, false), "theme", null, night.themeLabel);
    return true;
  }

  /** Dance group: the hidden theme category, or a theme dance of the current category. */
  function placeThemeDance() {
    if (!danceWeight) return false;
    const inOpening = night.isInOpening();
    if (hiddenChosen()) return placeHidden();
    const iCategory = turns.currentCategory();
    if (iCategory === null) return false;
    const options = categories[iCategory].dances.filter((dance) =>
      theme.dances.has(dance) && night.hasSong(dance, false) && !(inOpening && night.openingBlacklist.has(dance)) && night.gapAllowed(dance, settings.minToRepeat));
    if (!options.length) return false;
    const dance = night.pickRandom(options);
    turns.commitRegular(iCategory, dance, night.pickSong(dance, false));
    return true;
  }

  return {
    danceOpenerCount,
    tagOpenerCount,
    placeOpener,
    tryTagOpenerExcursion,
    placeThemeSong,
    tagGroupFirst,
    hiddenChosen,
    placeHidden,
  };
}
