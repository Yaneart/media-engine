# @media-engine/providers

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/providers/README.ru.md)

Ready-to-use data sources for Media Engine.

Install this package when you do not want to write your own provider adapters.

```bash
npm install @media-engine/core @media-engine/providers
```

## A small setup

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  flixHqStreamingProvider,
  kinobdProvider,
  kinobdStreamingProvider,
  shikimoriProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), shikimoriProvider(), aniListProvider()],
});

const result = await media.search({ title: "One Piece" });
```

Add only the providers that make sense for your application. Media Engine will call compatible ones and merge matching answers.

## Available metadata sources

- `kinobdProvider()` — localized movie and series data;
- `cinemetaProvider()` — IMDb-linked movie and series data;
- `shikimoriProvider()` — anime search and details;
- `aniListProvider()` — international anime titles, popularity, and artwork;
- `wikidataProvider()` — open structured enrichment;
- `imdbDatasetProvider()` — local IMDb TSV datasets supplied by your application.

None of these built-in providers needs your API key. TMDB IDs may appear in results, but this package does not call the TMDB API.

Expected upstream failures are reported as typed `ProviderError` values, and shared HTTP errors expose their originating status through `getProviderHttpStatus`. An untyped Cinemeta IMDb lookup returns `null` only after both movie and series candidates confirm absence; a temporary branch outage remains retryable unless the other branch returned usable details. AniList similarly distinguishes GraphQL rate limits and server outages from validation errors or malformed payloads, allowing Media Engine to avoid caching incomplete metadata as a healthy response.

## Player sources

- `kinobdStreamingProvider()` — movie, series, and anime player options;
- `flixHqStreamingProvider()` — international movie and selected series-episode options;
- `experimentalStreamingProvider()` — data configured by your own application, useful in tests and UI work.

```ts
const media = new MediaEngine({
  streamingProviders: [
    kinobdStreamingProvider(),
    flixHqStreamingProvider(),
  ],
});

const result = await media.getAvailability({
  type: "series",
  title: "Game of Thrones",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

These are third-party player targets, not videos hosted by Media Engine. Availability depends on the upstream source and the user's environment.

Provider options, limitations, and safety rules are summarized in the [provider guide](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## License

MIT
