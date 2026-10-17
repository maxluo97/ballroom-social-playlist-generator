/**
 * playlist-edit.js — changing a generated playlist by hand. No page code: the generator page calls
 * these and redraws; the tests call them directly.
 *
 * A generated playlist (`r`, from generatePlaylist) can be edited. Each row of r.playlist may carry:
 *   swapped + original   the song was swapped; `original` = the generator's choice (for Reset)
 *   inserted             the row was added by hand (Remove deletes it)
 *   removed              a generator row taken out (kept, so it can be Restored)
 *   autoReplaced         the Spotify check replaced an unavailable song here (the generator's choice)
 *   genIndex             its position when generated (the generator's warnings refer to these)
 *   locked               kept by "Regenerate unlocked songs" (see lockedForRegeneration)
 *   group                the block or multi-song fixed event the row belongs to (see groups below)
 *   disbanded            it was in a block that was broken up: labelled by category / Excursion / dance
 * Times, numbering, stats, the rule check and every output use only the rows that are not removed.
 * Rule breaks are reported only if an edit caused them (`baselineViolations` / `editViolations`).
 *
 * Every edit can be undone (`undo`): before each edit the rows are copied onto `r.history`; undoing
 * them all gives the generated playlist back, which is what `resetAll` does in one step.
 *
 * Groups (the agreed spec, NOTES.md v0.2.5): themed blocks and fixed events with several songs. A group
 * is intact while its songs are together (in any order) and "modified" if its songs were reordered,
 * swapped or removed; if another song lands inside it or its songs are scattered, it is disbanded:
 * its songs lose the block, are labelled by category / "Excursion" / dance, and are locked.
 */

import { associationMap, checkRules, computeStats } from "./generator.js";

/** Rows actually in the playlist (removed ones left out), in order. */
export const activeItems = (r) => r.playlist.filter((x) => !x.removed);
export const activeResult = (r) => ({ ...r, playlist: activeItems(r) });
export const hasEdits = (r) => !!r && ((r.history && r.history.length > 0) || r.playlist.some((x) => x.swapped || x.inserted || x.removed));
/** A rule break tied to its song (not its position), so it survives insertions and removals. */
export const violationKey = (v, items) => `${v.rule}|${v.index >= 0 && items[v.index] ? items[v.index].song.id : "-"}`;

/** Make a freshly generated playlist ready for editing. */
export function prepareGenerated(r, settings) {
  r.playlist.forEach((it) => (it.genIndex = it.index));
  r.history = [];
  assignGroups(r);
  rebaseline(r, settings);
  updateGroups(r);
  return r;
}

/* ------------------------------------------------------------------ groups */

/** Number the generated playlist's groups: themed blocks, and runs of one fixed event (2+ songs). */
function assignGroups(r) {
  r.groups = {};
  const rows = activeItems(r);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i];
    if (it.disbanded || it.group) continue;
    let members = [];
    if (it.blockId !== undefined) members = rows.filter((x) => x.blockId === it.blockId && !x.disbanded);
    else if (it.kind === "fixed") {
      for (let j = i; j < rows.length && rows[j].kind === "fixed" && rows[j].source === it.source && !rows[j].disbanded; j++) members.push(rows[j]);
    }
    if (members.length < 2) continue;
    const id = `g${++n}`;
    const label = it.groupLabel || it.blockLabel || it.source || "Block";
    r.groups[id] = { label: label.replace(/ \(modified\)$/, ""), songIds: members.map((x) => x.song.id), modifiedBefore: / \(modified\)$/.test(label) };
    members.forEach((x) => (x.group = id));
  }
}

/**
 * Each group's state now: { intact, modified, label, rows }. A group is intact while its rows sit
 * together; modified if they were reordered, swapped or removed (or it was modified before).
 */
export function groupStates(r) {
  const rows = activeItems(r);
  const out = {};
  for (const [id, g] of Object.entries(r.groups || {})) {
    const members = rows.filter((x) => x.group === id && !x.disbanded);
    if (!members.length) continue;
    const intact = members.every((x, k) => k === 0 || x.index === members[k - 1].index + 1);
    const ids = members.map((x) => x.song.id);
    const modified = g.modifiedBefore || ids.join("\u0000") !== g.songIds.join("\u0000");
    out[id] = { intact, modified, label: g.label + (modified ? " (modified)" : ""), rows: members };
  }
  return out;
}

/** Break up groups whose songs are no longer together: they lose the block and are locked. */
function updateGroups(r) {
  for (const st of Object.values(groupStates(r))) {
    if (st.intact) continue;
    for (const x of st.rows) {
      x.disbanded = true;
      x.locked = true;
      x.disbandedFrom = x.blockId !== undefined ? { blockId: x.blockId, key: x.blockId } : { key: x.source };
      delete x.group;
      for (const k of ["blockId", "blockLabel", "blockTag", "fixedBlock", "groupLabel"]) delete x[k];
    }
  }
}

/** The "Type" of a row: its block (with "(modified)"), else its category, "Excursion" or its dance. */
export function typeLabel(it, r, settings) {
  const st = it.group && groupStates(r)[it.group];
  if (st && st.intact) return it.kind === "regular" && it.category ? `${st.label} (${it.category})` : st.label;
  if (it.disbanded || it.group) {
    const cat = categoryNameOf(it.dance, settings);
    if (cat) return cat;
    const m = associationMap(settings.associations);
    const pool = Object.keys((settings.excursions && settings.excursions.pool) || {}).map(m);
    return pool.includes(it.dance) ? "Excursion" : it.dance;
  }
  return null; // the usual label (category, Excursion, fixed event, …)
}

/* -------------------------------------------------------------------- undo */

/** Remember the rows as they are, so this edit can be undone. */
function remember(r) {
  r.history = r.history || [];
  r.history.push(r.playlist.map((x) => ({ ...x })));
}

/** Undo the last edit (of any kind). */
export function undo(r, settings) {
  if (!r.history || !r.history.length) return r;
  r.playlist = r.history.pop();
  return recompute(r, settings);
}

/** Every edit goes through here: remember, change, then recompute and break up split groups. */
function edit(r, settings, change) {
  remember(r);
  change();
  recompute(r, settings);
  updateGroups(r);
  return r;
}

/* -------------------------------------------------------------- move, lock */

/** Move a row to just before the active row now at `toIndex` (or to the end). */
export function moveItem(r, item, toIndex, settings) {
  if (item.index === toIndex || item.index + 1 === toIndex) return r; // dropped on itself, or where it already is
  return edit(r, settings, () => moveRows(r, [item], toIndex));
}

/** Move every row of an intact group, in its current order, to just before the active row at `toIndex`. */
export function moveGroup(r, groupId, toIndex, settings) {
  const st = groupStates(r)[groupId];
  if (!st) return r;
  const first = st.rows[0].index;
  if (toIndex >= first && toIndex <= st.rows.at(-1).index + 1) return r; // onto itself, or where it already is
  return edit(r, settings, () => moveRows(r, st.rows, toIndex));
}

function moveRows(r, rows, toIndex) {
  const target = activeItems(r).find((x) => x.index === toIndex && !rows.includes(x)) || null;
  r.playlist = r.playlist.filter((x) => !rows.includes(x));
  const at = target ? r.playlist.indexOf(target) : r.playlist.length;
  r.playlist.splice(at, 0, ...rows);
}

/** Move a row one place up (-1) or down (+1) among the active rows. */
export function moveBy(r, item, by, settings) {
  const rows = activeItems(r);
  const k = rows.indexOf(item);
  const j = k + by;
  if (k < 0 || j < 0 || j >= rows.length) return r;
  // Down: before the row after the next one.
  return moveItem(r, item, by < 0 ? rows[j].index : j + 1 < rows.length ? rows[j + 1].index : rows.length, settings);
}

/** Move an intact group one place up or down (past the neighbouring row). */
export function moveGroupBy(r, groupId, by, settings) {
  const st = groupStates(r)[groupId];
  if (!st) return r;
  const rows = activeItems(r);
  const first = st.rows[0].index;
  const last = st.rows.at(-1).index;
  if (by < 0 && first === 0) return r;
  if (by > 0 && last === rows.length - 1) return r;
  return moveGroup(r, groupId, by < 0 ? first - 1 : last + 2 < rows.length ? last + 2 : rows.length, settings);
}

export const toggleLock = (r, item, settings) => edit(r, settings, () => (item.locked = !item.locked));
export const lockAll = (r, settings) => edit(r, settings, () => activeItems(r).forEach((x) => (x.locked = true)));
export const unlockAll = (r, settings) => edit(r, settings, () => r.playlist.forEach((x) => (x.locked = false)));

/**
 * What "Regenerate unlocked songs" keeps (the agreed spec, NOTES.md v0.2.5), for the generator's
 * `locked` option: [{ position, row }] plus the fixed events and blocks not to create again.
 *   - a locked row keeps its place;
 *   - an intact group with locked songs keeps only those, together, from its first locked song's
 *     place ("(modified)" if any were dropped), and is not created again;
 *   - a disbanded group whose songs are (partly) locked is not created again either.
 */
export function lockedForRegeneration(r) {
  const rows = activeItems(r);
  const states = groupStates(r);
  const keep = [];
  const skipFixed = new Set();
  const skipBlocks = new Set();
  const handled = new Set();
  for (const it of rows) {
    if (handled.has(it)) continue;
    const st = it.group && states[it.group];
    if (st && st.intact) {
      st.rows.forEach((x) => handled.add(x));
      const kept = st.rows.filter((x) => x.locked);
      if (!kept.length) continue;
      const dropped = kept.length < st.rows.length;
      const label = st.label.replace(/ \(modified\)$/, "") + (st.modified || dropped ? " (modified)" : "");
      kept.forEach((x, k) => keep.push({ position: kept[0].index + k, row: { ...x, groupLabel: label, blockLabel: x.blockLabel ? label : x.blockLabel } }));
      if (it.blockId !== undefined) skipBlocks.add(it.blockId);
      else if (it.kind === "fixed") skipFixed.add(it.source);
      continue;
    }
    handled.add(it);
    if (!it.locked) continue;
    keep.push({ position: it.index, row: { ...it } });
    // A one-song fixed event or block that is kept is not created again.
    if (!it.disbanded && it.blockId !== undefined) skipBlocks.add(it.blockId);
    else if (!it.disbanded && it.kind === "fixed") skipFixed.add(it.source);
    if (it.disbanded && it.disbandedFrom) (it.disbandedFrom.blockId !== undefined ? skipBlocks : skipFixed).add(it.disbandedFrom.key);
  }
  // Places must not collide: a later row moves down one place if needed.
  keep.sort((a, b) => a.position - b.position);
  for (let k = 1; k < keep.length; k++) if (keep[k].position <= keep[k - 1].position) keep[k].position = keep[k - 1].position + 1;
  return { keep, skipFixed: [...skipFixed], skipBlocks: [...skipBlocks] };
}

/** Remember which rules are broken right now, so later edits only report problems they cause. */
export function rebaseline(r, settings) {
  const items = activeItems(r);
  r.baselineViolations = checkRules({ ...r, playlist: items }, settings).map((v) => violationKey(v, items));
  r.editViolations = [];
}

/** A library song in the form the playlist uses (dances after associations). */
export function asPlaylistSong(song, settings) {
  const m = associationMap(settings.associations);
  return { ...song, sourceDances: song.dances, dances: [...new Set(song.dances.map(m))] };
}

/** Whether a song counts toward the theme when played as `dance`. */
export function isThemeSong(song, dance, kind, settings) {
  if (!settings.theme || kind === "fixed") return false;
  const m = associationMap(settings.associations);
  return new Set((settings.theme.dances || []).map(m)).has(dance) ||
    (song.tags || []).some((t) => (settings.theme.tags || []).includes(t));
}

/** The category a dance (after associations) belongs to, or null. */
function categoryNameOf(dance, settings) {
  const m = associationMap(settings.associations);
  const c = settings.categories.find((cat) => cat.dances.some((d) => m(d) === dance));
  return c ? c.name : null;
}

/** After any edit: renumber, retime, restat, and re-check the rules (reporting only new problems). */
export function recompute(r, settings) {
  let t = 0;
  let n = 0;
  for (const x of r.playlist) {
    if (x.removed) {
      x.index = -1;
      continue;
    }
    x.index = n++;
    x.startSec = t;
    t += x.song.lengthSec;
  }
  r.totalSec = t;
  r.overtimeSec = t - r.targetSec;
  const ar = activeResult(r);
  r.stats = computeStats(ar);
  const before = new Set(r.baselineViolations || []);
  r.editViolations = checkRules(ar, settings).filter((v) => !before.has(violationKey(v, ar.playlist)));
  // The generator never repeats a song, so its rule check does not look for that; hand edits can.
  const firstAt = new Map();
  for (const x of ar.playlist) {
    if (firstAt.has(x.song.id)) {
      r.editViolations.push({ rule: "duplicate", index: x.index, message: `“${x.song.title}” is also #${firstAt.get(x.song.id) + 1}.` });
    } else firstAt.set(x.song.id, x.index);
  }
  return r;
}

/** Put `song` (a library song) into a row. A song of another dance changes what the row is. */
export function swapSong(r, item, song, dance, settings) {
  return edit(r, settings, () => swapInto(item, song, dance, settings));
}
function swapInto(item, song, dance, settings) {
  if (!item.original) item.original = { song: item.song, dance: item.dance, isTheme: item.isTheme };
  item.song = asPlaylistSong(song, settings);
  if (!item.song.dances.includes(item.dance)) item.dance = dance || item.song.dances[0] || item.dance;
  item.isTheme = isThemeSong(item.song, item.dance, item.kind, settings);
  item.swapped = !item.inserted; // an inserted row just gets a different song
  if (item.inserted) delete item.original;
}

/** Put back the generator's song in a swapped row. */
export function resetSwap(r, item, settings) {
  return edit(r, settings, () => {
    Object.assign(item, item.original);
    delete item.original;
    item.swapped = false;
  });
}

/** Insert a library song at `position` in r.playlist, played as `dance` (if it has it). */
export function insertSong(r, position, song, dance, settings) {
  const s = asPlaylistSong(song, settings);
  const d = dance && s.dances.includes(dance) ? dance : s.dances[0] || "";
  return edit(r, settings, () => r.playlist.splice(position, 0, {
    song: s, dance: d, kind: "inserted", category: d ? categoryNameOf(d, settings) : null, source: null,
    isTheme: isThemeSong(s, d, "inserted", settings), inserted: true,
  }));
}

/** Remove a row: a row added by hand is deleted; a generator row is kept (removed) so it can be restored. */
export function removeItem(r, item, settings) {
  return edit(r, settings, () => {
    if (item.inserted) r.playlist.splice(r.playlist.indexOf(item), 1);
    else item.removed = true;
  });
}

export function restoreItem(r, item, settings) {
  return edit(r, settings, () => (item.removed = false));
}

/** Undo every manual change (locks included): exactly the playlist the generator made. */
export function resetAll(r, settings) {
  if (!r.history || !r.history.length) return r;
  r.playlist = r.history[0];
  r.history = [];
  return recompute(r, settings);
}
