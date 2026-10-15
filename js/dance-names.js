/**
 * dance-names.js — guessing dances from text (playlist names, song titles).
 *
 * Each known dance has a list of spellings people use. Matching is case-insensitive, ignores
 * punctuation, and prefers the longest match, so "Viennese Waltz" wins over "Waltz" and
 * "West Coast Swing" wins over "Swing". Edit DANCE_ALIASES to teach it new spellings.
 */

export const DANCE_ALIASES = {
  "Waltz": ["waltz", "waltzes", "slow waltz"],
  "Viennese Waltz": ["viennese waltz", "viennese", "v waltz", "vwaltz", "vw"],
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
  "West Coast Swing": ["west coast swing", "west coast", "wcs"],
  "Lindy Hop": ["lindy hop", "lindy"],
  "Charleston": ["charleston"],
  "Balboa": ["balboa"],
  "Blues": ["blues dance", "blues"],
  "Mambo": ["mambo"],
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

/** Style words, e.g. "Smooth Waltz". Used when the library already uses style-specific names. */
export const STYLE_WORDS = ["Smooth", "Standard", "Rhythm", "Latin", "American", "International"];

const normalize = (s) =>
  ` ${String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é -> e
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** All [alias, dance] pairs, longest alias first. */
function aliasList(extraDances = []) {
  const pairs = [];
  for (const [dance, aliases] of Object.entries(DANCE_ALIASES)) {
    for (const a of aliases) pairs.push([normalize(a), dance]);
  }
  // Dances already used in the library are matched by their own names too.
  for (const d of extraDances) pairs.push([normalize(d), d]);
  return pairs.sort((x, y) => y[0].length - x[0].length);
}

/**
 * Dances mentioned in `text`. Longer matches consume their words, so "Viennese Waltz" does not
 * also yield "Waltz". `knownDances` are the names used in the existing library; if the text has a
 * style word (e.g. "Smooth") and the library has "Smooth Waltz", that name is returned instead.
 */
export function guessDances(text, knownDances = []) {
  let t = normalize(text);
  const hits = []; // [position in text, dance]
  for (const [alias, dance] of aliasList(knownDances)) {
    if (!alias.trim()) continue;
    const pos = t.indexOf(alias);
    if (pos < 0) continue;
    if (!hits.some(([, d]) => d === dance)) hits.push([pos, dance]);
    // Blank out the matched words (same length, so later positions stay comparable).
    t = t.split(alias).join(` ${"#".repeat(alias.length - 2)} `);
  }
  const found = hits.sort((a, b) => a[0] - b[0]).map(([, d]) => d);
  const style = STYLE_WORDS.find((w) => normalize(text).includes(normalize(w)));
  if (!style) return found;
  return found.map((d) => {
    const styled = `${style} ${d}`;
    return knownDances.find((k) => k.toLowerCase() === styled.toLowerCase()) ?? d;
  });
}
