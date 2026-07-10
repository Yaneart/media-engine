# @media-engine/providers

Provider package for Media Engine.

This package contains concrete metadata provider factories such as KinoBD, Cinemeta, TMDB, Shikimori, Wikidata, and local IMDb datasets, plus streaming provider factories such as Kodik and the local experimental provider.

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
  tmdb/
  shikimori/
  wikidata/
  imdb-dataset/
  experimental-streaming/
  kodik/
  kinobd-streaming/
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

Cinemeta is the secondary no-token movie and series provider for the local API stand. TMDB can still be added for richer dedicated metadata when a token is configured.

## TMDB Provider

`tmdbProvider` creates a metadata provider for movies and series.

```ts
import { MediaEngine } from "@media-engine/core";
import { tmdbProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [
    tmdbProvider({
      apiKey: process.env.TMDB_API_READ_ACCESS_TOKEN ?? "",
      language: "ru-RU",
    }),
  ],
});
```

Supported data:

- title search for movies and series;
- IMDb and TMDB external ID lookup;
- movie and series details;
- posters, backdrops, ratings, genres, persons, seasons, and alternative titles.

`apiKey` is sent as a TMDB bearer token. Tests use mock `fetch` implementations and do not call the real TMDB API.

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

Wikidata is useful as a free fallback when TMDB credentials are not configured. It is less complete than TMDB and should be treated as a baseline metadata source, not a full replacement for dedicated movie databases.

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

## Kodik Streaming Provider

`kodikProvider` creates a token-based streaming provider for normalized player options. It uses the configured Kodik API token from the application and returns embed player URLs as `StreamOption` values. It does not scrape player pages, does not extract direct video files, and does not expose secrets in provider metadata.

```ts
import { MediaEngine } from "@media-engine/core";
import { kodikProvider, shikimoriProvider } from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [shikimoriProvider()],
  streamingProviders: [
    kodikProvider({
      token: process.env.KODIK_TOKEN ?? "",
    }),
  ],
});

const availability = await engine.getAvailability({
  type: "anime",
  shikimori: "20",
  absoluteEpisodeNumber: 1,
});
```

Supported behavior:

- anime, movie, and series availability lookup;
- title, IMDb ID, Kinopoisk ID, and Shikimori ID lookup;
- episode mapping from Kodik season/episode maps;
- normalized translation, quality, provider attribution, and embed access URLs;
- configurable API base URL, fetch implementation, result limit, and Kodik type filters.

Before shipping an app with Kodik enabled, verify your Kodik API token terms and allowed embed usage for your product.

## Shared Utilities

`src/shared` contains provider-side helpers used by future concrete providers:

- `fetchJson`;
- `parseJsonResponse`;
- `mapProviderHttpError`;
- `mapHttpStatusToProviderErrorCode`.

These helpers map HTTP, JSON parsing, network, timeout, and rate-limit failures into `ProviderError` from `@media-engine/core`. `fetchJson` retries retryable provider failures with a short backoff by default.
