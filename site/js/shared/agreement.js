// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * agreement.js — the privacy policy and terms of use (privacy.html), which users agree to before they
 * first log in to Spotify. Spotify's Developer Terms (V.11, V.12) ask that users see the privacy policy
 * before signing up, and agree to terms of use; the agreement is kept in this browser.
 *
 * When the privacy policy or the terms change, raise TERMS_VERSION: everyone is then asked again.
 */

import { el } from "./dom.js";

/** The date of the current privacy policy and terms of use (as shown on privacy.html). */
export const TERMS_VERSION = "2026-10-18";
const AGREEMENT_KEY = "dpg.agreement.v1";

/** Whether this browser agreed to the current privacy policy and terms. */
export function hasAgreed() {
  try {
    const stored = JSON.parse(localStorage.getItem(AGREEMENT_KEY));
    return !!stored && stored.version === TERMS_VERSION;
  } catch {
    return false;
  }
}

function recordAgreement() {
  try {
    localStorage.setItem(AGREEMENT_KEY, JSON.stringify({ version: TERMS_VERSION, agreedAt: new Date().toISOString() }));
  } catch {
    /* storage unavailable: the question comes again next time */
  }
}

/**
 * Resolve to true if the user has agreed (now or before), false if they canceled. The first time (and
 * after a change of the terms), a window shows what agreeing means, with a link to the full text.
 */
export function ensureAgreement() {
  if (hasAgreed()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const dialog = el("dialog", { class: "agreement", "aria-label": "Privacy and terms" });
    const finish = (agreed) => {
      if (agreed) recordAgreement();
      dialog.close();
      dialog.remove();
      resolve(agreed);
    };
    dialog.append(
      el("h2", {}, "Before you log in"),
      el("p", {}, "This site keeps your login, your library and your settings in this browser only. It has no server of " +
        "its own, and nothing is sent anywhere except to Spotify, which your browser talks to directly. " +
        "It sets no cookies and has no tracking; the library builder's song preview is Spotify's player, which may set Spotify's cookies."),
      el("p", {}, "The app comes with no warranty. Spotify's own terms apply to your use of Spotify, and Spotify is a " +
        "third-party beneficiary of these terms."),
      el("p", {}, "Please read the ", el("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "privacy policy and terms of use"),
        " (opens in a new tab). By continuing, you agree to them."),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", onclick: () => finish(true) }, "I agree, log in"),
        el("button", { type: "button", onclick: () => finish(false) }, "Cancel")));
    dialog.addEventListener("cancel", () => finish(false)); // the Escape key
    document.body.append(dialog);
    dialog.showModal();
  });
}
