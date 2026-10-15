/**
 * availability-test.js — checking songs on Spotify (js/availability.js), against a fake Spotify.
 * Run with:   npm test
 */

// A fake browser storage with a valid-looking login, and a fake Spotify answering by track ID.
const memory = { "dpg.spotify.tokens.v1": JSON.stringify({ accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 3600e3 }) };
globalThis.localStorage = {
  getItem: (k) => memory[k] ?? null,
  setItem: (k, v) => (memory[k] = String(v)),
  removeItem: (k) => delete memory[k],
};
const id = (word) => word.padEnd(22, "0"); // 22-character fake Spotify IDs
const answers = {
  [id("fine")]: { status: 200, body: { id: id("fine"), name: "Fine", is_playable: true } },
  [id("relinked")]: { status: 200, body: { id: id("otherversion"), name: "Other", artists: [{ name: "Band" }], is_playable: true } },
  [id("blocked")]: { status: 200, body: { id: id("blocked"), name: "No", is_playable: false, restrictions: { reason: "market" } } },
  [id("gone")]: { status: 404, body: { error: { status: 404, message: "Non existing id" } } },
};
let requests = 0;
globalThis.fetch = async (url) => {
  requests++;
  const a = answers[String(url).match(/tracks\/([^?]+)/)[1]];
  return { ok: a.status < 300, status: a.status, headers: { get: () => null }, json: async () => a.body };
};

const { checkSongs, isUnavailable, unavailableReason, availabilityOf, reloadAvailability } = await import("../js/availability.js");

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

console.log("=== Checking songs on Spotify");
const progress = [];
const found = await checkSongs(
  [id("fine"), id("relinked"), id("blocked"), id("gone"), `https://open.spotify.com/track/${id("fine")}`, "sample12"],
  { onProgress: (done, total) => progress.push(`${done}/${total}`) });
check(Object.keys(found).length === 4, `4 distinct real IDs checked (links normalized, fake IDs skipped): ${Object.keys(found).length}`);
check(requests === 4, `one request per song: ${requests}`);
check(progress.at(-1) === "4/4", `progress reported: ${progress.join(" ")}`);
check(!isUnavailable(id("fine")) && !isUnavailable(id("relinked")), "playable and relinked songs are available");
check(isUnavailable(id("blocked")) && isUnavailable(id("gone")), "blocked and missing songs are unavailable");
check(unavailableReason(id("blocked")) === "cannot be played on Spotify (not licensed in your country)", unavailableReason(id("blocked")));
check(unavailableReason(id("gone")) === "no longer on Spotify", unavailableReason(id("gone")));
check(availabilityOf(id("relinked")).playsAs === "Other – Band", "relinked: which version plays");
check(availabilityOf(id("fine")).checkedAt === new Date().toISOString().slice(0, 10), "results are dated");
reloadAvailability();
check(isUnavailable(id("gone")), "results are remembered in browser storage");
check(!isUnavailable(id("neverchecked")) && availabilityOf(id("neverchecked")) === null, "an unchecked song is not treated as unavailable");

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: availability checks.");
process.exitCode = failures ? 1 : 0;
