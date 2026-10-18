// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
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
export const unknownDanceMessage = (name) =>
  `“${name}” is not a known dance. Pick one from the list, or use “Define a new dance…” in the library builder.`;

/*
 * Dances the user defined themselves (library builder, "Define a new dance…"):
 *   { name, style, spellings }   style = one of BALLROOM_STYLES' keys, or null
 * A styled one is stored as "<Style> <name>" (e.g. "Smooth Peabody"), like the built-in ballroom dances.
 * Set by the page with setCustomDances(); used by the guessing and naming functions below.
 */
let customDances = [];

export function setCustomDances(list = []) {
  customDances = list
    .filter((dance) => dance && String(dance.name || "").trim())
    .map((dance) => ({
      name: String(dance.name).trim(),
      style: BALLROOM_STYLES[dance.style] ? dance.style : null,
      spellings: (dance.spellings || []).map((spelling) => String(spelling).trim()).filter(Boolean),
    }));
}

/** The user's own dances in their stored form ("Smooth Peabody", "Lindy Bop"). */
export const customDanceNames = () => customDances.map((dance) => (dance.style ? `${dance.style} ${dance.name}` : dance.name));

/**
 * Why a new dance cannot be defined as given, or null if it can.
 * `{ name, style, spellings }` as for setCustomDances; `libraryDances`: names already in the library.
 */
export function newDanceProblem({ name, style, spellings = [] }, libraryDances = []) {
  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) return "Give the dance a name.";
  if (/[;|,]/.test(trimmedName)) return "A dance name cannot contain ; | or , (they separate dances in songs.csv).";
  if (Object.keys(BALLROOM_STYLES).some((styleName) => trimmedName.toLowerCase().startsWith(`${styleName.toLowerCase()} `))) {
    return "Leave the style word out of the name and choose the style in the list instead.";
  }
  // Every name and spelling the app already knows, mapped to the dance it means.
  const danceOfSpelling = new Map();
  const add = (spelling, dance) => danceOfSpelling.set(normalize(spelling), dance);
  for (const [dance, aliases] of Object.entries(DANCE_ALIASES)) [dance, ...aliases].forEach((alias) => add(alias, dance));
  for (const dance of [...BALLROOM_DANCE_NAMES, ...libraryDances]) add(dance, dance);
  for (const own of customDances) [own.name, ...own.spellings].forEach((spelling) => add(spelling, own.style ? `${own.style} ${own.name}` : own.name));
  const fullName = style ? `${style} ${trimmedName}` : trimmedName;
  for (const candidate of [trimmedName, fullName, ...spellings]) {
    const existing = danceOfSpelling.get(normalize(candidate));
    if (existing) return `“${candidate}” already means ${existing}.`;
  }
  return null;
}

/** All standard ballroom names, e.g. "Smooth Waltz" ... "Latin Jive" (19 dances). */
export const BALLROOM_DANCE_NAMES = Object.entries(BALLROOM_STYLES).flatMap(([styleName, style]) => style.dances.map((dance) => `${styleName} ${dance}`));

/**
 * Text for matching: lower case, no accents, every run of other characters one space, with a space at
 * each end (so " waltz " matches whole words only).
 */
const normalize = (text) =>
  ` ${String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é -> e
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Whether normalized text contains a phrase (as whole words). */
const has = (normalizedText, phrase) => normalizedText.includes(normalize(phrase));

/** Whether a name starts with a ballroom style ("Smooth Waltz"). */
const isStyled = (name) => Object.keys(BALLROOM_STYLES).some((styleName) => name.startsWith(`${styleName} `));

/**
 * [alias, dance] pairs, longest alias first. Extra (library) names match as themselves, except
 * styled ballroom names: those go through the style logic, so "Smooth & Standard Waltz" finds both.
 */
function aliasList(extraDances = []) {
  const pairs = [];
  for (const [dance, aliases] of Object.entries(DANCE_ALIASES)) for (const alias of aliases) pairs.push([normalize(alias), dance]);
  for (const own of customDances) for (const spelling of [own.name, ...own.spellings]) pairs.push([normalize(spelling), own.name]);
  for (const dance of extraDances) if (!isStyled(dance)) pairs.push([normalize(dance), dance]);
  return pairs.sort((first, second) => second[0].length - first[0].length);
}

/**
 * Dances mentioned in `text`, in the order they appear, with ballroom style rules applied.
 * Returns { dances: [...], ambiguous: [{ dance, options: [...] }],
 *           checks: [{ dance, guessed: [...], alternative, message }] }
 * `checks` are guesses that were made but should be confirmed (see DOUBLE_CHECK).
 * `knownDances`: extra names to recognize as-is (e.g. names already used in the library).
 */
export function guessDanceInfo(text, knownDances = []) {
  const normalizedText = normalize(text);
  let unmatched = normalizedText; // the text with the dances found so far blanked out
  const hits = []; // [position, dance]
  for (const [alias, dance] of aliasList(knownDances)) {
    if (!alias.trim()) continue;
    const position = unmatched.indexOf(alias);
    if (position < 0) continue;
    if (!hits.some(([, found]) => found === dance)) hits.push([position, dance]);
    // Blank out the matched words (same length, so later positions stay comparable).
    unmatched = unmatched.split(alias).join(` ${"#".repeat(alias.length - 2)} `);
  }
  hits.sort((first, second) => first[0] - second[0]);

  const styleWords = new Set(Object.entries(BALLROOM_STYLES).filter(([, style]) => style.words.some((word) => has(normalizedText, word))).map(([styleName]) => styleName));
  const familyWords = new Set(Object.entries(FAMILY_WORDS).filter(([, words]) => words.some((word) => has(normalizedText, word))).map(([family]) => family));

  const dances = [];
  const ambiguous = [];
  const checks = [];
  const add = (dance) => !dances.includes(dance) && dances.push(dance);
  for (const [, dance] of hits) {
    // The ballroom styles this dance belongs to (built in, or one of your own dances).
    const homes = [
      ...Object.keys(BALLROOM_STYLES).filter((styleName) => BALLROOM_STYLES[styleName].dances.includes(dance)),
      ...customDances.filter((own) => own.name === dance && own.style).map((own) => own.style),
    ];
    if (!homes.length) {
      add(dance); // not a ballroom dance: keep the plain name
      continue;
    }
    let chosen = homes.filter((styleName) => styleWords.has(styleName) || familyWords.has(BALLROOM_STYLES[styleName].family));
    if (!chosen.length) {
      if (homes.length > 1 && DISTINCT_ACROSS_STYLES.includes(dance)) {
        ambiguous.push({ dance, options: homes.map((styleName) => `${styleName} ${dance}`) });
        continue;
      }
      chosen = homes;
      // No style word: the guess is plausible but worth a second look for some dances.
      if (DOUBLE_CHECK[dance]) checks.push({ dance, guessed: chosen.map((styleName) => `${styleName} ${dance}`), ...DOUBLE_CHECK[dance] });
    }
    chosen.forEach((styleName) => add(`${styleName} ${dance}`));
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
  // The user's own dances: any of their spellings means that dance (styled ones need a style word, as below).
  const own = customDances.find((dance) => !dance.style && [dance.name, ...dance.spellings].some((spelling) => normalize(spelling) === normalize(trimmed)));
  if (own) return own.name;
  const { dances, ambiguous } = guessDanceInfo(trimmed);
  if (dances.length === 1 && !ambiguous.length && isStyled(dances[0])) {
    const normalizedName = normalize(trimmed);
    const styleOrFamily =
      Object.values(BALLROOM_STYLES).some((style) => style.words.some((word) => has(normalizedName, word))) ||
      Object.values(FAMILY_WORDS).some((words) => words.some((word) => has(normalizedName, word)));
    if (styleOrFamily) return dances[0];
  }
  return trimmed;
}
