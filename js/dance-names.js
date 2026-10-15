/**
 * dance-names.js — recognizing dance names in text (playlist names, CSV cells).
 *
 * Two layers:
 *   1. Spellings: each dance has a list of ways people write it (DANCE_ALIASES). Matching ignores
 *      capitals and punctuation and prefers the longest match, so "Viennese Waltz" wins over
 *      "Waltz" and "West Coast Swing" wins over "Swing".
 *   2. Competitive ballroom styles (BALLROOM_STYLES). The standard form of a ballroom dance name is
 *      "<Style> <Dance>", e.g. "Rhythm Rumba", "Latin Cha-cha", "Smooth Waltz", "Standard Quickstep".
 *      Other ways of writing the style are translated: "American Rumba" -> "Rhythm Rumba",
 *      "Intl Cha Cha" -> "Latin Cha-cha", "American Waltz" -> "Smooth Waltz".
 *      With no style word:
 *        - a dance found in only one style takes that style ("Quickstep" -> "Standard Quickstep");
 *        - a dance in two styles that are normally associated gets both
 *          ("Waltz" -> "Smooth Waltz" + "Standard Waltz");
 *        - a dance whose two versions are NOT interchangeable (DISTINCT_ACROSS_STYLES, i.e. Rumba)
 *          is reported as ambiguous so the user can choose.
 * Edit the tables below to teach it new spellings.
 */

export const DANCE_ALIASES = {
  "Waltz": ["waltz", "waltzes", "slow waltz"],
  "Viennese Waltz": ["viennese waltz", "viennese", "v waltz", "vwaltz"],
  "Tango": ["tango", "tangos"],
  "Argentine Tango": ["argentine tango", "tango argentino", "argentine", "milonga", "tango vals"],
  "Foxtrot": ["foxtrot", "fox trot", "slow foxtrot"],
  "Quickstep": ["quickstep", "quick step"],
  "Cha-cha": ["cha cha", "chacha", "cha cha cha", "chachacha"],
  "Rumba": ["rumba", "rhumba"],
  "Bolero": ["bolero"],
  "Samba": ["samba"],
  "Jive": ["jive"],
  "Paso Doble": ["paso doble", "paso", "pasodoble"],
  "Swing": ["swing", "east coast swing", "ecs", "triple swing"],
  "Mambo": ["mambo"],
  "West Coast Swing": ["west coast swing", "west coast", "wcs"],
  "Lindy Hop": ["lindy hop", "lindy"],
  "Charleston": ["charleston"],
  "Balboa": ["balboa"],
  "Blues": ["blues dance", "blues"],
  "Salsa": ["salsa"],
  "Bachata": ["bachata"],
  "Merengue": ["merengue"],
  "Hustle": ["hustle"],
  "Night Club Two Step": ["night club two step", "nightclub two step", "night club 2 step", "nightclub 2 step", "nc2s", "nc 2 step"],
  "Country Two Step": ["country two step", "two step", "2 step"],
  "Polka": ["polka"],
  "Line dance": ["line dance", "line dances", "line dancing"],
  "Kizomba": ["kizomba"],
  "Zouk": ["zouk"],
};

/** The four competitive ballroom styles (categories in this app) and their dances. */
export const BALLROOM_STYLES = {
  Smooth: { family: "American", words: ["american smooth", "smooth"], dances: ["Waltz", "Tango", "Foxtrot", "Viennese Waltz"] },
  Rhythm: { family: "American", words: ["american rhythm", "rhythm"], dances: ["Cha-cha", "Rumba", "Swing", "Bolero", "Mambo"] },
  Standard: { family: "International", words: ["international standard", "international ballroom", "standard"], dances: ["Waltz", "Tango", "Viennese Waltz", "Foxtrot", "Quickstep"] },
  Latin: { family: "International", words: ["international latin", "latin"], dances: ["Cha-cha", "Samba", "Rumba", "Paso Doble", "Jive"] },
};

/** Words meaning "American" or "International" style (the style is then chosen by the dance). */
const FAMILY_WORDS = {
  American: ["american", "amer"],
  International: ["international", "intl", "int l", "intn l", "istd"],
};

/** Dances whose two style versions are not interchangeable: a bare name is ambiguous. */
export const DISTINCT_ACROSS_STYLES = ["Rumba"];

/**
 * Bare names that are guessed but should be double-checked, with the likely alternative.
 * "Tango" with no style word is assumed to be ballroom Tango, but could be Argentine Tango.
 */
export const DOUBLE_CHECK = {
  Tango: { alternative: "Argentine Tango", message: "Assumed ballroom Tango (Smooth/Standard). Double-check: is it Argentine Tango?" },
};

/** Message for a dance name the app does not know (dance boxes accept known dances only). */
export const unknownDanceMessage = (v) =>
  `“${v}” is not a known dance. Pick one from the list (defining new dances is planned for a later version).`;

/** All standard ballroom names, e.g. "Smooth Waltz" ... "Latin Jive" (19 dances). */
export const BALLROOM_DANCE_NAMES = Object.entries(BALLROOM_STYLES).flatMap(([style, s]) => s.dances.map((d) => `${style} ${d}`));

const normalize = (s) =>
  ` ${String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é -> e
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

const has = (normText, phrase) => normText.includes(normalize(phrase));

const isStyled = (name) => Object.keys(BALLROOM_STYLES).some((st) => name.startsWith(`${st} `));

/**
 * [alias, dance] pairs, longest alias first. Extra (library) names match as themselves, except
 * styled ballroom names: those go through the style logic, so "Smooth & Standard Waltz" finds both.
 */
function aliasList(extraDances = []) {
  const pairs = [];
  for (const [dance, aliases] of Object.entries(DANCE_ALIASES)) for (const a of aliases) pairs.push([normalize(a), dance]);
  for (const d of extraDances) if (!isStyled(d)) pairs.push([normalize(d), d]);
  return pairs.sort((x, y) => y[0].length - x[0].length);
}

/**
 * Dances mentioned in `text`, in the order they appear, with ballroom style rules applied.
 * Returns { dances: [...], ambiguous: [{ dance, options: [...] }],
 *           checks: [{ dance, guessed: [...], alternative, message }] }
 * `checks` are guesses that were made but should be confirmed (see DOUBLE_CHECK).
 * `knownDances`: extra names to recognize as-is (e.g. names already used in the library).
 */
export function guessDanceInfo(text, knownDances = []) {
  const norm = normalize(text);
  let t = norm;
  const hits = []; // [position, dance]
  for (const [alias, dance] of aliasList(knownDances)) {
    if (!alias.trim()) continue;
    const pos = t.indexOf(alias);
    if (pos < 0) continue;
    if (!hits.some(([, d]) => d === dance)) hits.push([pos, dance]);
    // Blank out the matched words (same length, so later positions stay comparable).
    t = t.split(alias).join(` ${"#".repeat(alias.length - 2)} `);
  }
  hits.sort((a, b) => a[0] - b[0]);

  const styleWords = new Set(Object.entries(BALLROOM_STYLES).filter(([, s]) => s.words.some((w) => has(norm, w))).map(([st]) => st));
  const familyWords = new Set(Object.entries(FAMILY_WORDS).filter(([, ws]) => ws.some((w) => has(norm, w))).map(([f]) => f));

  const dances = [];
  const ambiguous = [];
  const checks = [];
  const add = (d) => !dances.includes(d) && dances.push(d);
  for (const [, dance] of hits) {
    const homes = Object.keys(BALLROOM_STYLES).filter((st) => BALLROOM_STYLES[st].dances.includes(dance));
    if (!homes.length) {
      add(dance); // not a ballroom dance: keep the plain name
      continue;
    }
    let chosen = homes.filter((st) => styleWords.has(st) || familyWords.has(BALLROOM_STYLES[st].family));
    if (!chosen.length) {
      if (homes.length > 1 && DISTINCT_ACROSS_STYLES.includes(dance)) {
        ambiguous.push({ dance, options: homes.map((st) => `${st} ${dance}`) });
        continue;
      }
      chosen = homes;
      // No style word: the guess is plausible but worth a second look for some dances.
      if (DOUBLE_CHECK[dance]) checks.push({ dance, guessed: chosen.map((st) => `${st} ${dance}`), ...DOUBLE_CHECK[dance] });
    }
    chosen.forEach((st) => add(`${st} ${dance}`));
  }
  return { dances, ambiguous, checks };
}

/** Just the dance list (ambiguous ones left out). */
export function guessDances(text, knownDances = []) {
  return guessDanceInfo(text, knownDances).dances;
}

/**
 * The standard form of one dance name, for cleaning up names typed in CSVs and forms:
 * "American Rumba" -> "Rhythm Rumba", "Intl cha cha" -> "Latin Cha-cha", "smooth waltz" -> "Smooth Waltz".
 * Only names that clearly mean one ballroom dance in one style are changed; anything else
 * (including a bare "Waltz" or "Rumba", or "Salsa") is returned unchanged apart from trimming.
 */
export function canonicalDance(name) {
  const trimmed = String(name ?? "").trim();
  const { dances, ambiguous } = guessDanceInfo(trimmed);
  if (dances.length === 1 && !ambiguous.length && isStyled(dances[0])) {
    const norm = normalize(trimmed);
    const styleOrFamily =
      Object.values(BALLROOM_STYLES).some((s) => s.words.some((w) => has(norm, w))) ||
      Object.values(FAMILY_WORDS).some((ws) => ws.some((w) => has(norm, w)));
    if (styleOrFamily) return dances[0];
  }
  return trimmed;
}
