// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * fake-spotify.mjs — the data and the fake Spotify the page snapshots use: the shared library's rows
 * with made-up song details, some playlists, and a stand-in for Spotify's Web API that runs inside the
 * page (it replaces the page's fetch for api.spotify.com only). Nothing reaches the real Spotify.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The permissions the fake login has (every page's). */
export const ALL_SCOPES = "playlist-read-private playlist-modify-private playlist-modify-public playlist-read-collaborative user-read-currently-playing";

/** A made-up Spotify track for library row number `number`. */
export const fakeTrack = (id, number, name, extra = {}) => ({
  type: "track", id, name, duration_ms: (150 + ((number * 37) % 140)) * 1000, is_playable: number % 97 !== 5,
  ...(number % 97 === 5 ? { restrictions: { reason: "market" } } : {}),
  artists: [{ name: `Artist ${number % 40}` }],
  album: { name: number % 7 === 0 ? "Great Film (Original Motion Picture Soundtrack)" : `Album ${number % 25}`, release_date: `${1960 + (number % 60)}-01-01` },
  external_ids: { isrc: `ISRC${number}` },
  ...extra,
});

/** The shared library's rows (site/data/songs.csv), the first `limit` of them. */
export async function sharedLibraryRows(root, limit = Infinity) {
  const { parseSongsText } = await import(pathToFileURL(join(root, "site/js/shared/data.js")).href);
  return parseSongsText(readFileSync(join(root, "site/data/songs.csv"), "utf8")).songs.slice(0, limit);
}

/**
 * The page code of a fake Spotify. `playlists`: [{ id, name, owner, collaborative?, items: [tracks] }];
 * `extraTracks`: more tracks that search and look-ups know. Requests are recorded in window.__requests.
 */
export function fakeSpotifyScript({ playlists, extraTracks = [] }) {
  return `
  const PLAYLISTS = ${JSON.stringify(playlists)};
  const ALL_TRACKS = [...new Map(PLAYLISTS.flatMap((playlist) => playlist.items).concat(${JSON.stringify(extraTracks)}).map((track) => [track.id, track])).values()];
  const json = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.__requests = [];
  /** One page of a list, with Spotify's "next" link. */
  const page = (list, url) => {
    const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 50);
    const next = offset + limit < list.length ? url.origin + url.pathname + "?" + new URLSearchParams({ ...Object.fromEntries(url.searchParams), offset: offset + limit }) : null;
    return { items: list.slice(offset, offset + limit), total: list.length, next };
  };
  window.fetch = async (input, init = {}) => {
    const address = String(input && input.url ? input.url : input);
    if (!address.startsWith("https://api.spotify.com/") && !address.startsWith("https://accounts.spotify.com/")) return realFetch(input, init);
    const url = new URL(address);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    window.__requests.push(method + " " + url.pathname + (url.search ? url.search.replace(/offset=\\d+/, "offset=…") : ""));
    const path = url.pathname.replace(/^\\/v1/, "");
    if (path === "/me") return json({ id: "tester", display_name: "Tester" });
    if (path === "/me/player/currently-playing") return json(null, 204);
    if (path === "/me/playlists" && method === "GET") {
      return json(page(PLAYLISTS.map((playlist) => ({ id: playlist.id, name: playlist.name, description: "", collaborative: !!playlist.collaborative,
        owner: { id: playlist.owner, display_name: playlist.owner }, items: { total: playlist.items.length },
        external_urls: { spotify: "https://open.spotify.com/playlist/" + playlist.id } })), url));
    }
    if (path === "/me/playlists" && method === "POST") {
      const created = { id: "plNew" + PLAYLISTS.length, name: body.name, owner: "tester", items: [] };
      PLAYLISTS.push(created);
      return json({ id: created.id, external_urls: { spotify: "https://open.spotify.com/playlist/" + created.id } }, 201);
    }
    const playlistPath = path.match(/^\\/playlists\\/([^/]+)(\\/items)?$/);
    if (playlistPath) {
      const playlist = PLAYLISTS.find((candidate) => candidate.id === decodeURIComponent(playlistPath[1]));
      if (!playlist) return json({ error: { status: 404, message: "Not found" } }, 404);
      if (!playlistPath[2]) return json({ owner: { id: playlist.owner } });
      if (method === "GET") return json(page(playlist.items.map((track) => ({ item: track, added_at: "2026-01-01T00:00:00Z" })), url));
      if (method === "POST") {
        for (const uri of body.uris) { const track = ALL_TRACKS.find((candidate) => "spotify:track:" + candidate.id === uri); if (track) playlist.items.push(track); }
        return json({ snapshot_id: "s" }, 201);
      }
      if (method === "DELETE") {
        const removed = new Set(body.items.map((item) => item.uri));
        playlist.items = playlist.items.filter((track) => !removed.has("spotify:track:" + track.id));
        return json({ snapshot_id: "s" });
      }
    }
    const trackPath = path.match(/^\\/tracks\\/([^/]+)$/);
    if (trackPath) {
      const track = ALL_TRACKS.find((candidate) => candidate.id === decodeURIComponent(trackPath[1]));
      return track ? json(track) : json({ error: { status: 404, message: "Not found" } }, 404);
    }
    if (path === "/search") {
      const query = (url.searchParams.get("q") || "").toLowerCase(), offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 10);
      const hits = ALL_TRACKS.filter((track) => track.name.toLowerCase().includes(query));
      return json({ tracks: { items: hits.slice(offset, offset + limit), total: hits.length, next: offset + limit < hits.length ? "more" : null } });
    }
    return json({ error: { status: 404, message: "not faked: " + path } }, 404);
  };
`;
}
