/**
 * config.js — app-wide settings that are not user settings.
 *
 * The Spotify Client ID is public by design (the PKCE login flow uses no secret), so it is
 * safe in the code. Never put the Client *secret* anywhere in this project.
 */

/** The site's own Spotify app key (the owner's; Spotify allows it for at most 5 listed accounts). */
export const DEFAULT_CLIENT_ID = "84ccfc2c3949414ebb92a941b1f76a9d";

/** A user's own key, if they pasted one (kept in this browser; see js/spotify-panel.js). */
const OWN_CLIENT_ID_KEY = "dpg.spotifyClientId.v1";

function ownClientId() {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(OWN_CLIENT_ID_KEY);
    return v && /^[0-9a-f]{32}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The key this browser logs in with: the user's own, else the site's. */
export const spotifyClientId = () => ownClientId() || DEFAULT_CLIENT_ID;
export const usingOwnClientId = () => !!ownClientId();

/** Use this key from now on (null = the site's key again). The caller logs out: a login belongs to one key. */
export function setOwnClientId(id) {
  try {
    if (id) localStorage.setItem(OWN_CLIENT_ID_KEY, id.trim());
    else localStorage.removeItem(OWN_CLIENT_ID_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Where Spotify sends the browser back after login: the app's root folder.
 * Locally that is http://127.0.0.1:8000/ ; online (GitHub Pages) it is
 * https://maxluo97.github.io/ballroom-social-playlist-generator/ .
 * Each of these must be registered exactly in the Spotify dashboard (Settings -> Redirect URIs).
 */
export const SPOTIFY_REDIRECT_URI = new URL("../", import.meta.url).href;

/** The online address of the app (GitHub Pages). */
export const ONLINE_URL = "https://maxluo97.github.io/ballroom-social-playlist-generator/";

/**
 * True when the app runs on this computer (`npm start`), false when it runs online. The library
 * builder only works on the computer: it saves into the project's data folder, and the online site
 * only sees those files once they are committed and pushed.
 */
// Spotify only accepts the registered 127.0.0.1 address for local use (never localhost), so a page
// opened as http://localhost:8000/… moves to the same address on 127.0.0.1 before anything else runs.
if (typeof location !== "undefined" && location.hostname === "localhost") {
  location.replace(location.href.replace("//localhost", "//127.0.0.1"));
}

export const RUNNING_LOCALLY =
  typeof location === "undefined" || ["127.0.0.1", "localhost"].includes(location.hostname);

/**
 * Permissions each page asks for at login (only what it needs, per Spotify's guidance):
 *   generator  read the (private) library playlist; save a playlist (private, or public if ticked)
 *   library    read your own and collaborative playlists to import them; keep the private library playlist
 * Both pages share one login, so a new login also keeps permissions already given (see login()).
 */
export const SPOTIFY_SCOPES = {
  generator: ["playlist-read-private", "playlist-modify-private", "playlist-modify-public"],
  library: ["playlist-read-private", "playlist-read-collaborative", "playlist-modify-private"],
};
