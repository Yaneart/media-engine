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
  ddbbStreamingProvider,
  flixHqStreamingProvider,
  kinobdProvider,
  kinobdStreamingProvider,
  shikimoriProvider,
  tvMazeProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), shikimoriProvider(), aniListProvider(), tvMazeProvider()],
});

const result = await media.search({ title: "One Piece" });
```

Add only the providers that make sense for your application. Media Engine will call compatible ones and merge matching answers.

## Available metadata sources

- `kinobdProvider()` — localized movie and series data;
- `cinemetaProvider()` — IMDb-linked movie and series data;
- `shikimoriProvider()` — anime search and details;
- `aniListProvider()` — international anime titles, popularity, and artwork;
- `tvMazeProvider()` — fallback IMDb-backed series identities and localized aliases;
- `wikidataProvider()` — fallback structured identity and metadata enrichment;
- `imdbDatasetProvider()` — local IMDb data supplied as small in-memory TSV fixtures or through an application-owned indexed storage adapter.

None of these built-in providers needs your API key. TMDB IDs may appear in results, but this package does not call the TMDB API.

TVmaze data is licensed under CC BY-SA. The provider keeps a TVmaze show URL in source attribution; applications using TVmaze data should preserve and render that link. See the [TVmaze API licensing terms](https://www.tvmaze.com/api#licensing).

Wikidata fallback discovery loads at most three title-relevant entities through a selected-property query and caches entity/IMDb mappings for six hours in a 256-entry process-local LRU by default. `entityLimit` is bounded to 1–10, `cacheTtlMs` to 0–7 days, and `cacheMaxEntries` to 2–2048; a zero TTL disables this provider-local cache.

The backward-compatible IMDb TSV adapter parses the complete input into memory and is intended for small datasets and fixtures. Full-dataset integrations can inject the exported synchronous/asynchronous `ImdbDatasetStorage` contract, including a direct ID lookup and bounded normalized title search, without adding a database dependency for other package users.

An included persisted adapter can stream plain or gzip IMDb TSV files into a versioned, atomically replaced SQLite/FTS index. `buildImdbDatasetSqliteIndex()` creates it and `openImdbDatasetSqliteStorage()` opens it read-only for `imdbDatasetProvider({ storage })`. This optional path lazily uses built-in `node:sqlite` and requires Node.js 22.13 or newer; importing the package or using the small in-memory adapter keeps the Node.js 20 baseline.

Expected upstream failures are reported as typed `ProviderError` values, and shared HTTP errors expose their originating status through `getProviderHttpStatus`. An untyped Cinemeta IMDb lookup returns `null` only after both movie and series candidates confirm absence; a temporary branch outage remains retryable unless the other branch returned usable details. AniList similarly distinguishes GraphQL rate limits and server outages from validation errors or malformed payloads, allowing Media Engine to avoid caching incomplete metadata as a healthy response.

Shared `fetchJson` calls stream at most 4 MiB by default before parsing and accept a positive `maxResponseBytes` override for provider-specific limits. A declared or chunked oversized body is cancelled and reported as the non-retryable `PROVIDER_RESPONSE_TOO_LARGE`; malformed JSON within the limit remains `PROVIDER_INVALID_RESPONSE`.

Low-level adapters may supply a `ProviderHttpScheduler` through `FetchJsonOptions.scheduler` when
they need deterministic control of retry and total-timeout timers, especially in tests. Normal
provider calls omit it and use the platform timers.

## Player sources

- `kinobdStreamingProvider()` — movie, series, and anime player options;
- `flixHqStreamingProvider()` — international movie and selected series-episode options;
- `ddbbStreamingProvider()` — opt-in Kinopoisk/IMDb lookup through an independent DDBB player route;
- `aniLibertyStreamingProvider()` — opt-in exact title/year anime lookup with direct HLS episodes;
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

The repository API enables `ddbbStreamingProvider()` after its repeated reliability/diversity
checkpoint; direct package consumers still choose their own provider list explicitly. It accepts
only Kinopoisk or IMDb IDs, returns generic movie/series/anime embeds, and does not claim exact
season/episode mapping. Its diversity-first mapping keeps one main option per returned player before
adding unique translation URLs. Missing nullable players produce no result; confirmed 404/410 or
stable deletion markers are removed, while transient validation failures remain `unknown`.

```ts
const media = new MediaEngine({
  streamingProviders: [
    kinobdStreamingProvider(),
    flixHqStreamingProvider(),
    ddbbStreamingProvider(), // explicit opt-in
    aniLibertyStreamingProvider(), // explicit opt-in
  ],
});
```

The repository API also enables `aniLibertyStreamingProvider()` after that checkpoint. Because
AniLiberty does not publish MAL, AniList, or Shikimori IDs for releases, the adapter requires both
title and year, accepts only one exact normalized match, and revalidates the loaded release before
returning streams. It supports generic episode maps and exact `absoluteEpisodeNumber` queries, but
does not guess season/episode mappings. Each safe first-party 480p/720p/1080p URL is returned as
direct HLS; release geo and copyright blocks are preserved as normalized availability states.

Live player validation removes an option only after HTTP 404/410 or a stable deletion marker. Rate limits, server errors, network failures, and validation timeouts keep the discovered option with `availability: "unknown"`, allowing the engine to expose the degradation and retry it instead of caching a transiently reduced result.

KinoBD bounds one availability lookup to 24 child HTTP attempts by default and validates at most eight discovered players through three workers. Public tuning remains bounded (`childRequestLimit` up to 64, `playerValidationLimit` up to 16, and `playerValidationConcurrency` up to 4). Nested iframe validation starts only when the fixed provider deadline can still grant a full validation window. `onPlayerAudit` receives additive `metrics` for discovered and validated players, limit/budget skips, transient unknown results, confirmed removals, and consumed child requests.

FlixHQ site navigation cannot leave its configured origin, including through redirects. External player and subtitle checks resolve every A/AAAA answer, reject private, local, reserved, multicast, or mixed public/private destinations, validate every bounded redirect hop, and pin the connection to the approved address. A custom provider `fetch` is an explicit trusted transport injection intended for controlled tests or self-hosted environments; it is responsible for equivalent network policy.

DDBB caps its JSON response, output option count, live validation count, validation concurrency,
validation body size, and per-player timeout. Its default transport applies the same hardened DNS,
redirect, and connection-pinning policy to the DDBB endpoint and returned players. A custom `fetch`
is the same explicit trusted test/self-hosted boundary used by the other streaming providers. Options
beyond the bounded validation count remain visible with `availability: "unknown"`; they are never
presented as successfully checked.

AniLiberty bounds search candidates, release episodes, JSON bytes, retries, and total provider time
through the shared engine/provider controls. Its default transport uses the hardened DNS, redirect,
and connection-pinning policy for API calls. Direct HLS targets still pass the shared browser-facing
output URL policy; playback network policy remains the consuming application's responsibility.

Before built-in providers expose artwork, player, or subtitle URLs, one output policy accepts only HTTP(S) targets without credentials, raw control characters, or literal local/private/reserved addresses. Valid paths and CDN query parameters, including expiring signatures, are preserved. This browser-facing check does not replace DNS validation or an application-owned media proxy.

Provider options, limitations, and safety rules are summarized in the [provider guide](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## License

MIT
