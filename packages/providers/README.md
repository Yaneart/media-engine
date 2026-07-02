# @media-engine/providers

Provider package for Media Engine.

This package contains concrete metadata provider factories such as TMDB and Shikimori.

The package depends on `@media-engine/core` for provider contracts and normalized media types. Core must not import this package.

Current structure:

```txt
src/
  shared/
  tmdb/
  shikimori/
  index.ts
```

No API keys or environment reads are stored in this package. Applications pass provider secrets from the outside.

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

## Shared Utilities

`src/shared` contains provider-side helpers used by future concrete providers:

- `fetchJson`;
- `parseJsonResponse`;
- `mapProviderHttpError`;
- `mapHttpStatusToProviderErrorCode`.

These helpers map HTTP, JSON parsing, network, and timeout failures into `ProviderError` from `@media-engine/core`.
