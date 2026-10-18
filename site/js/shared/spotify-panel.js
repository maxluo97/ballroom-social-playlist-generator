// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * spotify-panel.js — "Spotify connection": which Spotify app key (Client ID) this browser uses, and
 * how to use one's own (the agreed v0.3 design, NOTES.md: option (a)).
 *
 * Everyone needs a Spotify account. By default the site uses the owner's key, which Spotify allows
 * for at most 5 accounts that the owner adds by email (free accounts are fine). Anyone with Premium
 * can instead register their own key in their Spotify developer dashboard, and share it with up to 5
 * accounts of their own choosing (the key's owner adds them; they need no Premium). The key is pasted
 * here and kept in this browser. The site and its code stay the site owner's either way.
 */

import { el } from "./dom.js";
import { spotifyClientId, usingOwnClientId, setOwnClientId, SPOTIFY_REDIRECT_URI } from "./config.js";

const DASHBOARD_URL = "https://developer.spotify.com/dashboard";

/**
 * The panel (a collapsible box). `onChange()` is called after the key changed (the caller logs out
 * and redraws). `notAllowed`: Spotify refused this account (not on the owner's list), so the panel
 * opens and explains what to do.
 */
export function spotifyConnectionPanel({ onChange, notAllowed = false }) {
  const usingOwnKey = usingOwnClientId();
  const keyBox = el("input", { type: "text", placeholder: "paste your Client ID (32 letters and digits)", "aria-label": "Your Spotify Client ID",
    spellcheck: false, style: "flex:1 1 22em; font-family: monospace" });
  const problem = el("span", { class: "swap-warning" });
  const useOwnKey = () => {
    const id = keyBox.value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      problem.textContent = "That does not look like a Client ID: it is 32 letters (a–f) and digits, shown in your app's Settings.";
      return;
    }
    if (!confirm("Use your own Spotify app key on this site? You will be logged out, and then log in again with it.")) return;
    setOwnClientId(id);
    onChange();
  };
  const backToSitesKey = () => {
    if (!confirm("Stop using your own key, and use the site's key again? You will be logged out.")) return;
    setOwnClientId(null);
    onChange();
  };
  // The address Spotify sends the browser back to after login: this site's address (127.0.0.1 when run locally).
  const redirectAddresses = [SPOTIFY_REDIRECT_URI];

  return el("details", { class: "subbox spotify-connection", open: notAllowed },
    el("summary", {}, "Spotify connection: ", el("strong", {}, usingOwnKey ? "your own (or a shared) Spotify app key" : "the site's Spotify app key"),
      usingOwnKey && el("span", { class: "muted" }, ` (${spotifyClientId().slice(0, 6)}…)`)),
    notAllowed && el("ul", { class: "msgs" }, el("li", { class: "error" },
      usingOwnKey
        ? "Spotify refused this account with this key. If it is your own key: in your Spotify developer dashboard, open your app's Settings → User Management, add this account's email if it is not listed, then log out and in again. If someone shared the key with you: ask them to add your Spotify email there."
        : "Spotify refused this account: it is not on the list of accounts allowed to use the site's key (Spotify allows at most 5). Ask the site's owner to add your Spotify email address, or, if you have Spotify Premium, use your own key (below).")),
    el("p", { class: "help" },
      "Everyone needs a Spotify account. There are two ways to connect:"),
    el("ol", { class: "help" },
      el("li", {}, el("strong", {}, "The site's key (no setup): "),
        "Spotify allows the site's key for at most 5 accounts, which the site's owner adds by email. A free Spotify account is fine. Ask the owner to add yours."),
      el("li", {}, el("strong", {}, "Your own key, or one shared with you by its owner: "),
        "a key's owner needs Spotify Premium and can let up to 5 accounts use it (you do not need Premium if someone shares their key with you). ",
        el("strong", {}, "If someone shares a key with you: "), "ask them to add your Spotify email to it, then paste the Client ID they give you below. ",
        el("strong", {}, "To make your own (about 10 minutes):"),
        el("ol", {},
          el("li", {}, "Open the ", el("a", { href: DASHBOARD_URL, target: "_blank", rel: "noopener" }, "Spotify developer dashboard"),
            " and log in with your Spotify account."),
          el("li", {}, "Create an app: any name and description; under ", el("strong", {}, "Redirect URIs"), " add exactly ",
            ...redirectAddresses.map((address) => el("code", {}, address)), "; under the APIs used, tick ", el("strong", {}, "Web API"), "; agree and save."),
          el("li", {}, "Open the app's ", el("strong", {}, "Settings"), ", copy its ", el("strong", {}, "Client ID"), " and paste it below."),
          el("li", {}, "To let others use your key: under ", el("strong", {}, "User Management"), ", add their Spotify emails (up to 5 accounts), and give them the Client ID."),
          el("li", {}, "Log in again on this site. Your key is kept in this browser only; on another device or browser, paste it there too.")))),
    el("div", { class: "inline-fields" }, keyBox, el("button", { type: "button", class: "small", onclick: useOwnKey }, "Use my key"),
      usingOwnKey && el("button", { type: "button", class: "small undo", onclick: backToSitesKey }, "Use the site's key instead")),
    problem);
}
