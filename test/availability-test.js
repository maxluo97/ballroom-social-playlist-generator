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
  // Spotify's request limit: "too many requests, come back in an hour".
  [id("limited")]: { status: 429, retryAfter: "3600", body: { error: { status: 429, message: "quota exceeded" } } },
  [id("empty")]: { status: 200, body: {} }, // an answer without a track
};
let requests = 0;
globalThis.fetch = async (url) => {
  requests++;
  const a = answers[String(url).match(/tracks\/([^?]+)/)[1]];
  return {
    ok: a.status < 300, status: a.status, json: async () => a.body,
    headers: { get: (h) => (h === "Retry-After" ? a.retryAfter ?? null : null) },
  };
};

const { checkSongs, isUnavailable, unavailableReason, availabilityOf, reloadAvailability, isChecked, checkFailed } =
  await import("../js/availability.js");

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

console.log("=== Checking songs on Spotify");
const progress = [];
const { results: found } = await checkSongs(
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
check(isChecked(id("fine")) && !isChecked(id("neverchecked")), "isChecked: only songs Spotify answered for");

console.log("=== Spotify's request limit, and sparing requests");
{
  requests = 0;
  const skip = await checkSongs([id("fine"), id("blocked")], { maxAgeDays: 7 });
  check(requests === 0 && Object.keys(skip.results).length === 0, `songs checked today are not looked up again: ${requests} requests`);
  await checkSongs([id("fine")], { maxAgeDays: 0 });
  check(requests === 1, "maxAgeDays 0 (Check again) looks them up anyway");

  requests = 0;
  const limited = await checkSongs([id("limited"), id("fine"), id("blocked"), id("relinked"), id("gone")]);
  check(limited.rateLimited && limited.rateLimited.retryAfter === 3600, `the limit is reported, with the wait: ${JSON.stringify(limited.rateLimited)}`);
  check(requests < 5, `the check stops instead of sending every request: ${requests} of 5 sent`);
  check(checkFailed(id("limited")) && !isChecked(id("limited")) && !isUnavailable(id("limited")),
    "a song that could not be checked is neither 'checked' nor 'unavailable' (it is unknown)");
  check(isChecked(id("fine")) && availabilityOf(id("fine")).status === "ok", "a failed lookup never replaces an earlier real answer");

  await checkSongs([id("empty")]);
  check(checkFailed(id("empty")), "an answer without a track counts as 'could not be checked', not as playable");
}

console.log(failures ? `\nFAILED: ${failures} check(s).` : "\nPASSED: availability checks.");
process.exitCode = failures ? 1 : 0;
