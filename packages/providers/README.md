# @media-engine/providers

Provider package for Media Engine.

This package contains no-token metadata provider factories such as KinoBD, Cinemeta, Shikimori, AniList, Wikidata, and local IMDb datasets, plus no-token KinoBD and FlixHQ streaming providers and a local experimental provider.

The package depends on `@media-engine/core` for provider contracts and normalized media types. Core must not import this package.

## Install

```bash
npm install @media-engine/core @media-engine/providers
```

Use this package from server-side or trusted application code. Do not expose provider tokens in browser bundles.

Current structure:

```txt
src/
  shared/
  kinobd/
  cinemeta/
  shikimori/
  anilist/
  wikidata/
  imdb-dataset/
  experimental-streaming/
  kinobd-streaming/
  flixhq-streaming/
  index.ts
```

No API keys or environment reads are stored in this package. Applications pass provider secrets from the outside.

Streaming providers in this package return normalized embed/player access metadata. They do not make Media Engine a streaming service, do not host video, and do not extract direct video files by default. Review each upstream source's usage rules before enabling a provider in a product.

## KinoBD Provider

`kinobdProvider` creates a no-token metadata provider for movies and series through the public KinoBD API used by ReYohoho-style clients.

```ts
import { MediaEngine } from "@media-engine/core";
import { kinobdProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [kinobdProvider()],
});
```

Supported data:

- title search for movies and series;
- IMDb and Kinopoisk ID lookup;
- movie and series details;
- posters, Kinopoisk ratings, IMDb ratings, genres, countries, and persons when available;
- configurable `imageLimit` and `personLimit` for details payloads.

KinoBD is the first no-token movie and series provider for the local API stand because it returns practical Russian metadata, Kinopoisk IDs, IMDb IDs, ratings, and posters without requiring a user token.

## Cinemeta Provider

`cinemetaProvider` creates a no-token metadata provider for movies and series through the public Cinemeta/Stremio metadata API.

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [cinemetaProvider()],
});
```

Supported data:

- title search for movies and series;
- IMDb ID lookup;
- movie and series details;
- posters, backdrops, IMDb ratings, genres, cast, writers, and directors when available;
- configurable `imageLimit`, `personLimit`, and `enrichSearchLimit`.

Cinemeta is a secondary no-token movie and series provider. Its results are merged with KinoBD and Wikidata to improve metadata completeness without application secrets.

## Shikimori Provider

`shikimoriProvider` creates a metadata provider for anime.

```ts
import { MediaEngine } from "@media-engine/core";
import { shikimoriProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [
    shikimoriProvider({
      userAgent: "MyApp/1.0.0",
    }),
  ],
});
```

Supported data:

- title search for anime;
- Shikimori ID lookup;
- anime details;
- posters, screenshots, ratings, genres, persons, episodes, and alternative titles;
- Shikimori and MyAnimeList external IDs in normalized results.

The provider does not store API keys or read environment variables. Tests use mock `fetch` implementations and do not call the real Shikimori API.

## AniList Provider

`aniListProvider` adds public no-token anime search and details through AniList GraphQL. It complements Shikimori with English and international title aliases, AniList/MyAnimeList IDs, popularity counts, ratings, posters, and genres.

```ts
import { aniListProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [aniListProvider()],
});
```

Public metadata requests do not require OAuth. The provider excludes adult results by default and can be configured with `includeAdult: true` when appropriate for the host application.

## Wikidata Provider

`wikidataProvider` creates a no-token metadata provider for basic movie and series search.

```ts
import { MediaEngine } from "@media-engine/core";
import { wikidataProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [wikidataProvider()],
});
```

Supported data:

- title search for movies and series;
- IMDb ID lookup through Wikidata;
- basic details with title, description, release date, image, and IMDb ID when present.

Wikidata is a free metadata source whose results are merged with KinoBD and Cinemeta. It is less complete than a dedicated movie database and should be treated as one enrichment source rather than the only source.

## IMDb Dataset Provider

`imdbDatasetProvider` creates a local parser-backed provider for official IMDb non-commercial TSV datasets. It does not call imdb.com pages, does not use an unofficial API, and does not scrape.

```ts
import { imdbDatasetProvider } from "@media-engine/providers";

const provider = imdbDatasetProvider({
  titleBasicsTsv: titleBasicsFileContent,
  titleRatingsTsv: titleRatingsFileContent,
});
```

Supported data:

- title search for movies and series;
- IMDb ID lookup;
- basic details from `title.basics.tsv`;
- IMDb ratings from `title.ratings.tsv` when provided.

Before using this provider, download the official IMDb datasets and verify that your use complies with IMDb's non-commercial dataset terms.

## Experimental Streaming Provider

`experimentalStreamingProvider` creates a configured streaming provider for local architecture validation. It does not scrape websites and does not call a real streaming API. Applications pass already allowed embed or external player URLs from the outside.

```ts
import { experimentalStreamingProvider } from "@media-engine/providers";

const provider = experimentalStreamingProvider({
  name: "local-embed",
  entries: [
    {
      type: "anime",
      title: "Example Anime",
      ids: {
        shikimori: "20",
      },
      episodes: [
        {
          absoluteEpisodeNumber: 1,
          options: [
            {
              id: "example-episode-1",
              player: {
                kind: "embed",
                label: "Embed Player",
              },
              translation: {
                title: "AniDUB",
                type: "dub",
                language: "ru",
              },
              quality: {
                label: "720p",
                height: 720,
              },
              access: {
                url: "https://example.test/embed/episode-1",
              },
              availability: "available",
            },
          ],
        },
      ],
    },
  ],
});
```

Supported behavior:

- lookup by configured external IDs;
- exact normalized title lookup when IDs are absent;
- movie-level and episode-level stream options;
- multiple player, translation, and quality options for one item or episode;
- provider filtering through `StreamQuery.providers`.

Use this provider only for experiments, tests, and UI wiring. A real provider such as Kodik should be implemented separately only after its API/embed usage rules are documented and allowed.

## KinoBD Streaming Provider

`kinobdStreamingProvider` creates a no-token streaming provider for ReYohoho-style iframe player availability. It calls KinoBD-style player endpoints and returns normalized `StreamOption` values with embed URLs, provider labels, translations, and quality labels.

```ts
import { MediaEngine } from "@media-engine/core";
import { kinobdStreamingProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  streamingProviders: [kinobdStreamingProvider()],
});

const availability = await engine.getAvailability({
  type: "movie",
  ids: {
    kinopoisk: "258687",
  },
});
```

Supported behavior:

- movie and series lookup through `/api/player/search` and `/playerdata`;
- anime fallback lookup by resolving a Shikimori ID through Shikimori's public API and searching KinoBD players by title;
- optional anime cache lookup through a configured `animeCacheBaseUrl` with `/cache_shiki` when an application has an allowed backend for it;
- player aggregation for the known KinoBD/ReYohoho embeddable player list, including Collaps, Vibix, Alloha, Kodik, KinoTochka, FlixCDN, Ashdi, Turbo, VideoCDN, Bazon, UStore, Pleer, VideoSpider, Iframe, Moonwalk, HDVB, CDNMovies, Lookbase, Kholobok, VideoAPI, Voidboost, Videoseed, and VK keys when upstream returns them;
- fallback to player iframe candidates from `/api/player/search` when `/playerdata` is unavailable or returns no usable iframe options;
- normalized embed player options with translation and quality metadata;
- best-effort translation type and language inference for labels such as Russian dubbing, Ukrainian dubbing, English subtitles, and known Russian voiceover teams including AlexFilm, HDrezka Studio, LE-Production, Shachiburi, LostFilm, AniDUB, AniLibria, and 2x2;
- best-effort filtering of clearly broken player pages, including HTTP 404/410/5xx and known unavailable-player HTML markers; live player page validation is bounded through `playerValidationLimit` and `playerValidationTimeoutMs`;
- noisy external-only or non-playback keys such as `ia`, `ext`, `netflix`, `nf`, `torrent`, `trailer`, `trailer_local`, and `youtube` are excluded from requests and filtered from upstream responses;
- provider filtering through `StreamQuery.providers`.

This provider does not use a Kodik API token and does not extract direct video files. It returns player/embed URLs for the application UI to render.

For live source-filter audits, pass `onPlayerAudit`. The callback reports discovered and shown player labels plus filtered labels with stable reasons such as `provider_not_allowed`, `missing_iframe`, `known_broken_url`, and `player_validation_failed`. Callback failures are isolated from normal availability behavior.

## FlixHQ Streaming Provider

`flixHqStreamingProvider` discovers international movie embeds and explicitly requested series episodes without user credentials.

```ts
import { MediaEngine } from "@media-engine/core";
import { flixHqStreamingProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  streamingProviders: [flixHqStreamingProvider()],
});

const availability = await engine.getAvailability({
  type: "series",
  title: "House of the Dragon",
  year: 2022,
  seasonNumber: 2,
  episodeNumber: 3,
});
```

The provider validates discovered embeds with bounded requests and normalizes public `sub.info` subtitle tracks. If upstream explicitly returns an HLS or MP4 URL, it also normalizes the kind, advertised quality, and unambiguous expiry metadata. It does not reverse-engineer protected embed streams. Series lookup requires both season and episode numbers; anime is intentionally unsupported to avoid matching live-action adaptations.

## Shared Utilities

`src/shared` contains provider-side helpers used by future concrete providers:

- `fetchJson`;
- `parseJsonResponse`;
- `mapProviderHttpError`;
- `mapHttpStatusToProviderErrorCode`.

These helpers map HTTP, JSON parsing, network, timeout, and rate-limit failures into `ProviderError` from `@media-engine/core`. `fetchJson` retries retryable provider failures with a short backoff by default.
