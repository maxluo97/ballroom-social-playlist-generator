// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * generator-page.mjs — the generator page's snapshot (and the program and live pages): a browser goes
 * through a fixed sequence of steps with a fake Spotify (the shared library, with made-up details) and
 * fixed random numbers, and the page is recorded after each step.
 */

import { launchBrowser, PAGE_HELPERS } from "./browser.mjs";
import { ALL_SCOPES, fakeTrack, sharedLibraryRows, fakeSpotifyScript, agreedScript } from "./fake-spotify.mjs";

export async function recordGeneratorPage(root, baseUrl) {
  const rows = await sharedLibraryRows(root);
  const tracks = rows.map((row, number) => fakeTrack(row.id, number, number % 50 === 0 ? "Moon River" : `Song ${number} (${row.dances[0]})`,
    number % 61 === 0 ? { external_ids: { isrc: "SAMEREC" } } : {}));
  const library = { rows, removed: [], playlistId: "PLAYLISTLIB", savedAt: "2026-10-01T00:00:00.000Z", downloadedAt: "2026-10-02T00:00:00.000Z" };
  const injected = `(() => {
    // The login, the library and the agreement to the privacy policy and terms are put in once per browser
    // tab, so later steps can change them (log out, delete everything) and reloading keeps the change.
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("dpg.spotify.tokens.v1", JSON.stringify({ accessToken: "fake", refreshToken: "fake", expiresAt: 4102444800000, scope: ${JSON.stringify(ALL_SCOPES)} }));
      localStorage.setItem("dpg.library.v1:tester", ${JSON.stringify(JSON.stringify(library))});
      ${agreedScript(root)}
    }
    ${PAGE_HELPERS}
    ${fakeSpotifyScript({ playlists: [{ id: "PLAYLISTLIB", name: "Library", owner: "tester", items: tracks }] })}
    window.__snap = () => ({
      html: [...document.querySelectorAll("main, dialog[open], #settings-bar, #library, #validation")].map((node) => node.outerHTML).join("\\n<!--split-->\\n"),
      values: [...document.querySelectorAll("input, select, textarea")].map((node) => (node.type === "checkbox" ? node.checked : node.value)),
      alerts: window.__alerts.splice(0),
      requests: window.__requests.splice(0),
      stored: Object.keys(localStorage).filter((key) => key.startsWith("dpg.")).sort().join(", "),
    });
  })();`;

  const browser = await launchBrowser({ injected, baseUrl });
  const { step, goto, waitFor, sleep } = browser;
  const generateAgain = `__click(__buttons("Generate another").length ? "Generate another" : "Generate playlist")`;
  try {
    await goto("index.html");
    await waitFor(`document.querySelector("#library") && /Song library/.test(document.querySelector("#library").textContent) && !document.querySelector("#refresh-progress")`);
    await step("loaded");
    await step("generate", `__click("Generate playlist")`);
    await step("lock two", `__click("Lock", 0); __click("Lock", 3);`);
    await step("regenerate", `__click("Regenerate unlocked songs")`);
    await step("swap window", `__click("Swap", 2)`);
    await step("swap picked", `__click("Use this", 0)`);
    await step("remove", `__click("Remove", 4)`);
    await step("undo", `__click("Undo")`);
    await step("move up", `__click("↑", 6)`);
    await step("move down", `__click("↓", 1)`);
    await step("block down", `if (__buttons("Move block down").length) __click("Move block down")`);
    await step("insert window", `__click("Insert after…", 1)`);
    await step("insert picked", `__click("Pick one for me")`);
    await step("reset all", `__click("Reset all")`);
    await step("view library", `__click("View library")`);
    await step("library filter", `__type('dialog select[aria-label="Show one dance"]', document.querySelectorAll('dialog select[aria-label="Show one dance"] option')[3].value, 0, "change")`);
    await step("library sort", `document.querySelectorAll("dialog th button")[2].click()`);
    await step("library close", `__click("Close")`);
    await step("open sections", `document.querySelectorAll("details.section").forEach((section) => (section.open = true)); document.querySelectorAll("details.section")[0].dispatchEvent(new Event("toggle"))`);
    await step("add block", `__click("+ Add special block")`);
    await step("block from songs", `const selects = [...document.querySelectorAll('select[aria-label="Songs from"]')]; selects.at(-1).value = "songs"; selects.at(-1).dispatchEvent(new Event("change"))`);
    await step("block search", `const boxes = [...document.querySelectorAll('input[aria-label="Search title or artist"]')]; boxes.at(-1).value = "song 1"; boxes.at(-1).dispatchEvent(new Event("input"))`);
    await step("block add songs", `document.querySelectorAll('button[aria-label^="Add Song 1"]')[0].click(); document.querySelectorAll('button[aria-label^="Add Song 1"]')[0].click();`);
    await step("block placement", `const selects = [...document.querySelectorAll('select[aria-label="Placement"]')]; selects.at(-1).value = "window"; selects.at(-1).dispatchEvent(new Event("change"))`);
    await step("theme on", `[...document.querySelectorAll("label")].find((label) => /This event has a theme/.test(label.textContent)).querySelector("input").click()`);
    await step("theme broad", `__click("Broad theme (50–70%)")`);
    await step("event length", `const box = document.querySelector('input[type="number"]'); box.value = "150"; box.dispatchEvent(new Event("input"))`);
    await step("excursion add", `const box = document.querySelector('input[aria-label="Excursion dance to add"]'); box.value = "Merengue"; box.dispatchEvent(new Event("input")); box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))`);
    await step("generate themed", `__click("Generate another")`);
    await step("lock themed", `__click("Lock", 1); __click("Lock", 10);`);
    await step("regenerate themed", `__click("Regenerate unlocked songs")`);
    await step("add association", `__click("+ Add association")`);
    await step("add category", `__click("+ Add category")`);
    for (let iPreset = 0; iPreset < 3; iPreset++) {
      await step(`preset ${iPreset}`, `if (document.querySelectorAll('select[aria-label="Load a shared preset"] option').length > ${iPreset + 1}) __type('select[aria-label="Load a shared preset"]', "${iPreset}", 0, "change")`);
      await sleep(700);
      await step(`preset ${iPreset} loaded`);
      await step(`preset ${iPreset} generate`, generateAgain);
    }
    await step("defaults", `__click("Load default settings")`);
    await step("generate defaults", generateAgain);
    await step("save to spotify", `[...document.querySelectorAll("button")].find((button) => /^Create playlist/.test(button.textContent)).click()`);
    await sleep(1000);
    await step("saved");
    await goto("program.html");
    await step("program");
    await goto("live.html");
    await sleep(2500);
    await step("live");
    await goto("live.html?screen=dancers");
    await sleep(1500);
    await step("dancers screen");
    await goto("index.html");
    await waitFor(`/Song library/.test(document.querySelector("#library").textContent)`);
    await step("reloaded");
    // The agreement window: someone logged in who has not agreed is asked at start-up.
    await browser.evaluate(`localStorage.removeItem("dpg.agreement.v1")`);
    await goto("index.html");
    await step("agreement window");
    await step("agreed", `__click("I agree, log in")`, 1500);
    await waitFor(`/Song library/.test(document.querySelector("#library").textContent)`);
    await step("log out", `__click("Log out")`);
    // Delete everything this site keeps in this browser (in the Spotify connection panel).
    await step("delete everything", `document.querySelector("details.spotify-connection").open = true; __click("Delete everything this site keeps in this browser…")`, 2500);
    await step("after deleting");
  } finally {
    await browser.close();
  }
  return browser.records;
}
