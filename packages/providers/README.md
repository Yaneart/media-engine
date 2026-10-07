# @media-engine/providers

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/providers/README.ru.md)

Ready-to-use data sources for Media Engine. Install this package when you want to search real public
catalogs without writing provider adapters yourself.

## Install

```bash
npm install @media-engine/core @media-engine/providers
```

The built-in providers do not need your API keys.

## Search metadata

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  tmdbOfficialProvider,
  tmdbProvider,
  shikimoriGraphqlProvider,
  shikimoriProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    tmdbOfficialProvider({ apiKey: process.env.TMDB_API_KEY }),
    shikimoriGraphqlProvider({ userAgent: process.env.MEDIA_ENGINE_SHIKIMORI_USER_AGENT }),
    kinobdProvider(),
    tmdbProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
  ],
});

const result = await media.search({ title: "One Piece" });
```

Connect only the sources your application needs. The engine calls suitable providers and merges
matching results for you.

Shikimori and AniList also support explicit anime relationships:

Shikimori details normalize the first usable full-size screenshot as a landscape `backdrop` and
preserve the remaining screenshots as `still` images. AniList's wider banner remains a fallback.
For merged anime posters, Core prefers AniList's higher-resolution `coverImage.extraLarge` when
providers do not expose dimensions.

```ts
const relations = await media.getRelatedMedia({
  shikimori: "52991",
  type: "anime",
});
```

The response preserves prequel, sequel, side-story, and other official relation kinds without
grouping titles by franchise-name heuristics.

Available metadata providers:

- `tmdbOfficialProvider()` for direct official movie and series metadata; its API key stays in
  server-owned configuration;
- `shikimoriGraphqlProvider()` for direct Russian anime metadata with an application-identifying
  server-owned `User-Agent`;
- `tmdbProvider()` for localized movie and series metadata through a public Stremio addon;
- `kinobdProvider()` and `cinemetaProvider()` as independent movie and series sources;
- `shikimoriProvider()` and `aniListProvider()` for anime;
- `tvMazeProvider()` and `wikidataProvider()` as additional identity sources;
- `imdbDatasetProvider()` for an IMDb dataset managed by your application.

TVmaze data requires attribution. Keep and display the TVmaze source link included in a result. See
the [TVmaze API license](https://www.tvmaze.com/api#licensing).

`tmdbProvider()` uses the public [TMDB Stremio addon](https://github.com/mrcanelas/tmdb-addon)
and needs no user token. Its host can be changed with `baseUrl`; Cinemeta continues to work if
the addon is unavailable. Applications displaying TMDB data should follow
[TMDB's attribution requirements](https://developer.themoviedb.org/docs/faq).

Core treats the two direct providers as coherent metadata primaries and the older adapters as
bounded fallbacks. Missing primary configuration does not prevent startup; provider readiness is
reported as degraded until the server-owned value is supplied.

The optional SQLite-backed IMDb dataset tools need Node.js 22.13 or newer. Everything else in the
package keeps the normal Node.js 20 baseline.

## Find player options

```ts
import {
  flixHqStreamingProvider,
  kinobdStreamingProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  streamingProviders: [kinobdStreamingProvider(), flixHqStreamingProvider()],
});

const result = await media.getAvailability({
  type: "series",
  title: "Game of Thrones",
  seasonNumber: 1,
  episodeNumber: 1,
});

for await (const snapshot of media.getAvailabilityProgressively({
  type: "series",
  ids: { kinopoisk: "435" },
  seasonNumber: 1,
  episodeNumber: 1,
})) {
  updatePlayerSources(snapshot.availability?.options ?? []);
}
```

The package also exports `ddbbStreamingProvider()`, `aniLibertyStreamingProvider()`,
`filmixStreamingProvider()`, `veoVeoStreamingProvider()`, `videoHubStreamingProvider()`,
`rutubeStreamingProvider()`, and
`experimentalStreamingProvider()`.
Add them explicitly when they fit your application. Filmix guest mode is capped at 480p and filters
known copyright/service placeholder videos. A user-owned device token raises the cap to 720p.
Authenticated mode requires an HTTPS `baseUrl` unless the application explicitly enables
`allowInsecureHttpToken` for a local compatibility test. That override sends the token without TLS
and must not be used in a public deployment. Returned CDN video URLs use HTTPS. VeoVeo uses DDBB only to resolve its
public content ID, discards the iframe token, and returns direct signed HTTPS HLS. VideoHUB uses a Kinopoisk ID and returns
short-lived direct MP4 qualities for movies or one exact series episode. Both providers preserve
`type: "anime"` for anime films. They also accept TV anime only with a verified anime-native/cinema
identity and explicit canonical `seasonNumber`, `episodeNumber`, and `absoluteEpisodeNumber`.
For split releases, pass `animeReleaseEpisode` with the selected release index, its local episode,
and the ordered release counts. Each adapter maps that evidence to its own complete, gap-free
catalog; ambiguous, incomplete, or conflicting mappings are rejected. Returned options keep the
canonical coordinates rather than leaking provider-native season boundaries. VideoHUB links are bound to the
playback User-Agent and may also be bound to the requesting public IP. Pass the playback client's
exact User-Agent as `MediaEngineOperationOptions.playbackUserAgent`; the required value is retained
in each option's `access.headers` for non-browser clients.
VideoHUB implements progressive availability, so every resolved translation can be displayed before
slower lookups finish. Its bounded warm cache keeps playlists and signed video resolutions separate,
never serves signed links stale, and preserves their original expiry.
Rutube performs a bounded exact title/year movie search and returns only Rutube's documented public
embed player. It does not expose or proxy Rutube media URLs and intentionally skips series.

These providers return third-party links or streams. Media Engine does not host the video, and an
external player may be unavailable in some countries, networks, or browsers.

## Discover torrent releases

Torrent providers are always opt-in:

```ts
import {
  bitsearchTorrentProvider,
  jacRedTorrentProvider,
  magnetzTorrentProvider,
  ytsTorrentProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  torrentProviders: [
    ytsTorrentProvider(),
    jacRedTorrentProvider(),
    bitsearchTorrentProvider(),
    magnetzTorrentProvider(),
  ],
});

const result = await media.discoverTorrents({
  type: "movie",
  title: "Inception",
  year: 2010,
  ids: { imdb: "tt1375666" },
});
```

Discovery only returns normalized candidates and their handoff data. It does not download torrent
metadata, contact trackers, join a swarm, or play a file.

Public sources can change, rate-limit requests, or go offline. Keep engine caching enabled and
expect occasional partial results. Provider-specific settings and safety boundaries are described in
the [provider guide](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## License

MIT
