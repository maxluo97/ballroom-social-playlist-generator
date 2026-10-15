/**
 * config.js — app-wide settings that are not user settings.
 *
 * The Spotify Client ID is public by design (the PKCE login flow uses no secret), so it is
 * safe in the code. Never put the Client *secret* anywhere in this project.
 */

export const SPOTIFY_CLIENT_ID = "84ccfc2c3949414ebb92a941b1f76a9d";

/**
 * Where Spotify sends the browser back after login: the app's root folder.
 * Locally that is http://127.0.0.1:8000/ ; on GitHub Pages it will be https://<user>.github.io/<repo>/ .
 * Each of these must be registered exactly in the Spotify dashboard (Settings -> Redirect URIs).
 */
export const SPOTIFY_REDIRECT_URI = new URL("../", import.meta.url).href;

/** Permissions requested at login. Read playlists (library builder) and create playlists (save). */
export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
];
