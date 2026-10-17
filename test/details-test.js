/**
 * details-test.js — Spotify's details of the library, read from the library playlist and kept in the
 * browser only temporarily (js/song-details.js), against a fake Spotify.
 * Run with:   npm test
 */

// A fake browser storage with a valid-looking login, and a fake Spotify with one library playlist.
const memory = { "dpg.spotify.tokens.v1": JSON.stringify({ accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 3600e3 }) };
globalThis.localStorage = {
  getItem: (k) => memory[k] ?? null,
  setItem: (k, v) => (memory[k] = String(v)),
  removeItem: (k) => delete memory[k],
};
const id = (n) => `t${String(n).padStart(5, "0")}`.padEnd(22, "x"); // 22-character fake Spotify IDs
const track = (n, extra = {}) => ({
  type: "track", id: id(n), name: `Song ${n}`, duration_ms: 180000 + n * 1000, is_playable: true,
  artists: [{ name: "Band" }], album: { name: "Album", release_date: "1999-05-01" }, external_ids: { isrc: `ISRC${n}` }, ...extra,
});
// 120 songs (3 pages of 50); song 7 cannot play here; song 8 is relinked (Spotify returns another ID).
const items = Array.from({ length: 120 }, (_, i) => {
  const n = i + 1;
  if (n === 7) return { item: track(7, { is_playable: false, restrictions: { reason: "market" } }) };
  if (n === 8) return { item: track(8, { id: id(9999), linked_from: { id: id(8) } }) };
  return { item: track(n) };
});
let requests = 0;
let limitAll = false;
let limitReason = "";
globalThis.fetch = async (url) => {
  requests++;
  if (limitAll) {
    return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: 429, message: "too many requests", reason: limitReason } }) };
  }
  const u = new URL(String(url));
  const offset = Number(u.searchParams.get("offset") || 0);
  const limit = Number(u.searchParams.get("limit") || 50);
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? `${u.origin}${u.pathname}?limit=${limit}&offset=${offset + limit}&market=from_token` : null;
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ items: page, total: items.length, next }) };
};

const details = await import("../js/song-details.js");
const spotify = await import("../js/spotify.js");
spotify.RETRY_POLICY.delaysMs = [1, 1, 1]; // the same backoff steps, without the waiting

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

console.log("=== Reading the library playlist");
{
  check(details.detailsNeedRefresh("PL"), "no details yet: a refresh is needed");
  const count = await details.refreshDetails("PL");
  check(count === 120 && requests === 3, `120 songs in 3 requests of 50: ${count} songs, ${requests} requests`);
  check(!details.detailsNeedRefresh("PL"), "fresh details: no refresh needed");
  check(details.detailsNeedRefresh("OTHER"), "another library playlist: a refresh is needed");
  const d = details.detailsOf(id(1));
  check(d && d.title === "Song 1" && d.lengthSec === 181 && d.isrc === "ISRC1" && d.released === "1999", `details: ${JSON.stringify(d)}`);
  check(details.isUnavailable(id(7)) && details.unavailableReason(id(7)) === "cannot be played on Spotify (not licensed in your country)",
    "is_playable false: unavailable, with the reason");
  check(!details.isUnavailable(id(1)) && details.isChecked(id(1)), "a playable song");
  check(details.detailsOf(id(8)) && !details.detailsOf(id(9999)), "a relinked song keeps its original ID");
}

console.log("=== Library rows with details");
{
  const rows = [{ id: id(1), dances: ["Waltz"], tags: ["Hollywood"] }, { id: id(500), dances: ["Tango"], tags: [] }];
  const [a, b] = details.withDetails(rows);
  check(a.title === "Song 1" && a.lengthSec === 181 && a.artist === "Band" && a.dances[0] === "Waltz" && a.tags[0] === "Hollywood" && !a.unknown,
    "a known song gets Spotify's details, and keeps the user's data");
  check(b.unknown && b.lengthSec === 0 && b.title.includes(id(500)) && b.dances[0] === "Tango", "an unknown song is marked, with no length");
  check(!("playable" in a), "the playable flag is not part of the song");
  details.rememberDetails([{ id: id(500), title: "Added by hand", artist: "X", lengthSec: 200 }]);
  check(details.withDetails(rows)[1].title === "Added by hand", "details read another way are kept too, until the next refresh");
}

console.log("=== Kept only temporarily");
{
  const stored = JSON.parse(memory["dpg.songDetails.v1"]);
  check(stored.playlistId === "PL" && Object.keys(stored.songs).length === 121, "the details are kept in this browser");
  stored.fetchedAt = new Date(Date.now() - (details.DETAILS_KEEP_DAYS + 1) * 24 * 3600e3).toISOString();
  memory["dpg.songDetails.v1"] = JSON.stringify(stored);
  details.reloadDetails();
  check(details.detailsNeedRefresh("PL"), `older than ${details.DETAILS_KEEP_DAYS} days: a refresh is needed`);
  details.forgetExpiredDetails();
  check(!memory["dpg.songDetails.v1"] && !details.detailsOf(id(1)), "expired details are deleted");
}

console.log("=== Spotify limiting requests");
{
  limitAll = true;
  requests = 0;
  let error = null;
  try {
    await details.refreshDetails("PL");
  } catch (err) {
    error = err;
  }
  check(error && error.status === 429, `a limited refresh fails with the limit reported: ${error && error.message}`);
  check(requests === 4, `three retries with growing waits, then it stops: ${requests} requests`);
  limitReason = "QUOTA_EXCEEDED";
  requests = 0;
  error = null;
  try {
    await details.refreshDetails("PL");
  } catch (err) {
    error = err;
  }
  check(error && error.details && error.details.quota && requests === 1, `a used-up quota is reported at once, without retries: ${requests} request(s)`);
  limitAll = false;
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: song details checks.");
process.exitCode = failures ? 1 : 0;
