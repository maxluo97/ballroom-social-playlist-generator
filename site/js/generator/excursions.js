// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * excursions.js — excursion dances (README rule 2): dances outside the categories, on a timer.
 *
 * An excursion is due every interval, ± a random variation (the first one too). Which dance plays is a
 * weighted die with a reducing pool: each dance's weight is how many times it may still come up; each
 * draw takes one away; when every count has reached 0, the pool starts again from the starting weights.
 * The theme does not steer the die.
 */

export function createExcursions(night) {
  const { settings } = night;
  const startingPool = { ...settings.excursions.pool };
  let pool = { ...startingPool }; // the counts left
  const intervalSec = settings.excursions.intervalMinutes * 60;
  const timerActive = intervalSec > 0 && Object.values(pool).some((weight) => weight > 0);
  /** The time until the next excursion: the interval ± the random variation (at least a minute). */
  const timeToNext = () => Math.max(60, intervalSec + (night.random() * 2 - 1) * (settings.excursions.jitterMinutes || 0) * 60);

  const excursions = {
    nextAtSec: timerActive ? timeToNext() : Infinity,
  };

  excursions.isDue = () => night.elapsedSec >= excursions.nextAtSec;

  /** Play an excursion, if one fits now. Returns whether one played. */
  excursions.tryExcursion = () => {
    // Once every count has reached 0, the pool resets to its starting weights.
    if (!Object.values(pool).some((weight) => weight > 0)) pool = { ...startingPool };
    const inOpening = night.isInOpening();
    const avoid = night.upcomingDances();
    const candidates = Object.entries(pool).filter(
      ([dance, weight]) =>
        weight > 0 &&
        !(avoid && avoid.has(dance)) &&
        night.hasSong(dance, false) &&
        !(inOpening && night.openingBlacklist.has(dance)) &&
        night.gapAllowed(dance, settings.minToRepeat)
    );
    if (!candidates.length) return false;

    // The weighted die: a random point along the total weight, and the dance whose stretch it lands in.
    const totalWeight = candidates.reduce((total, [, weight]) => total + weight, 0);
    let remaining = night.random() * totalWeight;
    let dance = candidates[candidates.length - 1][0];
    for (const [candidate, weight] of candidates) {
      remaining -= weight;
      if (remaining < 0) {
        dance = candidate;
        break;
      }
    }
    pool[dance]--;
    night.addSong(dance, night.pickSong(dance, false), "excursion", null, null);
    // The next one is due one interval later (or more, if this one came late).
    do excursions.nextAtSec += timeToNext();
    while (excursions.nextAtSec <= night.elapsedSec);
    return true;
  };

  return excursions;
}
