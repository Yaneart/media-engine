# Media Engine Provider System

## Purpose

A provider is an adapter for an external data source. It knows how to call one source and map the response into Media Engine models.

Core knows only the provider contract. It does not know TMDB, Shikimori, Kinopoisk, Kodik, or any concrete API.

## Provider Kinds

```ts
type ProviderKind = "metadata";
```

Metadata providers use `ProviderKind`. Streaming providers are separate and use the dedicated `StreamingProvider` contract documented later in this file.

## MediaProvider

```ts
export interface MediaProvider {
  name: string;
  version?: string;
  kind: "metadata";
  capabilities: ProviderCapabilities;

  search(
    query: ProviderSearchQuery,
    context: ProviderContext
  ): Promise<ProviderSearchResult[]>;

  getDetails?(
    query: ProviderDetailsQuery,
    context: ProviderContext
  ): Promise<ProviderDetailsResult | null>;
}
```

Rules:

- `name` is unique, lowercase, stable, non-empty, and has no leading or trailing whitespace;
- `search` is required;
- `getDetails` is optional;
- provider errors are mapped to known provider error codes;
- provider-specific raw responses are not public results.

## Provider Factory

```ts
export type ProviderFactory<TOptions> = (options: TOptions) => MediaProvider;
```

Example:

```ts
const provider = kinobdProvider();
```

## ProviderCapabilities

```ts
export interface ProviderCapabilities {
  mediaTypes: MediaType[];
  search: {
    byTitle: boolean;
    byExternalIds: ExternalIdSource[];
  };
  details: {
    byExternalIds: ExternalIdSource[];
  };
  features?: ProviderFeature[];
}
```

```ts
export type ExternalIdSource =
  | "imdb"
  | "tmdb"
  | "kinopoisk"
  | "shikimori"
  | "myAnimeList"
  | "aniList"
  | "worldArt";
```

```ts
export type ProviderFeature =
  | "posters"
  | "backdrops"
  | "ratings"
  | "genres"
  | "persons"
  | "seasons"
  | "episodes"
  | "alternative_titles";
```

## ProviderInfo

```ts
export interface ProviderInfo {
  name: string;
  version?: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
}
```

`ProviderInfo` is safe to return from `MediaEngine.getProviders()` and from the REST API. It must not include secrets, API keys, internal HTTP clients, or provider raw configuration. Capability arrays are returned as copies so callers cannot mutate provider internals through metadata.

## ProviderContext

```ts
export interface ProviderContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  debug?: boolean;
  language?: string;
}
```

Request-specific data is passed through context. Providers should not store request state globally.

## Provider Queries

```ts
export interface ProviderSearchQuery {
  title?: string;
  type?: MediaType;
  year?: number;
  ids?: ExternalIds;
  limit?: number;
  language?: string;
}
```

```ts
export interface ProviderDetailsQuery {
  id?: string;
  ids?: ExternalIds;
  type?: MediaType;
  language?: string;
}
```

## Provider Results

```ts
export interface ProviderSearchResult {
  provider: string;
  item: MediaItem;
  confidence?: number;
  source?: ProviderSource;
  raw?: unknown;
}
```

```ts
export interface ProviderDetailsResult {
  provider: string;
  details: MediaDetails;
  confidence?: number;
  source?: ProviderSource;
  raw?: unknown;
}
```

`raw` is only for debug and tests.

## Provider Selection

The engine selects providers by capabilities:

- `mediaTypes` must match query type if type is provided;
- title search requires `search.byTitle`;
- ID search requires `search.byExternalIds`;
- details requires `getDetails` and matching `details.byExternalIds`.

Public query shortcuts such as `imdb`, `tmdb`, `kinopoisk`, `shikimori`, `myAnimeList`, and `aniList` are normalized into `ids` before provider selection. Providers should receive `ProviderSearchQuery` and `ProviderDetailsQuery` with normalized `ids`.

## Planned Metadata Providers

TMDB, Shikimori, Wikidata, and local IMDb datasets prove the first provider contract. Additional metadata providers should be added only after their data source, usage terms, and mapping strategy are clear.

### Wikidata

Role: no-token baseline metadata for movies and series, especially when TMDB credentials are not configured.

Source:

- Wikidata public APIs and Wikidata Query Service;
- Wikidata data is CC0, but clients should follow Wikimedia API etiquette, including a useful User-Agent and conservative request volume.

Provider shape:

- provider name: `wikidata`;
- media types: `movie`, `series`;
- search: title and IMDb ID lookup;
- details: IMDb ID lookup;
- external IDs: `imdb` when present;
- features: posters when a Commons image is available.

Implementation notes:

- do not scrape imdb.com or kinopoisk.ru pages;
- keep Wikidata as a baseline fallback, not a replacement for richer dedicated providers;
- prefer TMDB over Wikidata during merge when both return the same title through strong IDs.

### IMDb Dataset

Role: local parser-backed movie and series metadata from official IMDb non-commercial TSV datasets.

Source:

- official IMDb non-commercial datasets;
- no live imdb.com scraping;
- no unofficial IMDb API calls.

Provider shape:

- provider name: `imdb-dataset`;
- media types: `movie`, `series`;
- search: title and IMDb ID lookup;
- details: IMDb ID lookup;
- external IDs: `imdb`;
- features: ratings and genres when the corresponding TSV data is loaded.

Implementation notes:

- applications must download datasets and verify license compliance themselves;
- keep dataset loading explicit because the files are large;
- use this provider for local/non-commercial parsing, not as a production IMDb API replacement.

### IMDb API

Planned role: authoritative movie and series identity, ratings, title basics, alternative titles, people, and episode data.

Preferred source options:

- licensed IMDb API through AWS Data Exchange for production/commercial usage;
- IMDb non-commercial datasets only for local, personal, or non-commercial experiments where the license allows it.

Provider shape:

- provider name: `imdb`;
- media types: `movie`, `series`;
- search: title search only if the selected IMDb source supports it;
- details: IMDb ID lookup;
- external IDs: `imdb`;
- features: ratings, genres, persons, seasons, episodes, alternative titles when available.

Implementation notes:

- do not scrape IMDb pages;
- do not treat non-commercial TSV datasets as a production API;
- if using bulk datasets, add a separate indexing/cache plan before implementation.

### Kinopoisk

Planned role: Russian-language metadata, ratings, localized titles, countries, posters, persons, and IDs for movies and series.

Source rule:

- use only an allowed, documented, and licensed Kinopoisk-compatible API;
- do not scrape kinopoisk.ru pages;
- if the chosen API is unofficial, document its usage terms and risk before implementation.

Provider shape:

- provider name: `kinopoisk`;
- media types: `movie`, `series`;
- search: title and Kinopoisk ID lookup if supported;
- details: Kinopoisk ID lookup;
- external IDs: `kinopoisk`, plus `imdb` or `tmdb` when the source provides them;
- features: posters, ratings, genres, persons, seasons, alternative titles when available.

Implementation notes:

- keep API token configuration outside core;
- normalize Russian and original titles without overwriting stronger IDs from other providers;
- treat provider availability and rate limits as first-class failure modes.

### AniList

Planned role: anime metadata that complements Shikimori with AniList IDs, formats, studios, characters, staff, tags, ratings, and airing data.

Preferred source:

- AniList GraphQL API.

Provider shape:

- provider name: `anilist`;
- media types: `anime`;
- search: title and AniList ID lookup;
- details: AniList ID lookup;
- external IDs: `aniList`, plus `myAnimeList` when available;
- features: posters, backdrops, ratings, genres, persons, episodes, alternative titles.

Implementation notes:

- use a small fixed GraphQL query set rather than arbitrary user-provided GraphQL;
- keep query cost and rate limiting visible in tests;
- map AniList media format into `AnimeKind` conservatively.

## Provider Errors

```ts
export class ProviderError extends Error {
  provider: string;
  code: ProviderErrorCode;
  retryable: boolean;
  cause?: unknown;
}
```

```ts
export type ProviderErrorCode =
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAUTHORIZED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_NOT_SUPPORTED";
```

Provider failures become response metadata when possible.

## Timeouts

Provider-specific timeout has priority over engine default timeout. Providers should respect `AbortSignal` where possible.

## Mock Provider

Core must include testing utilities:

- success provider;
- failing provider;
- timeout provider;
- fixtures for movie, series, and anime.

## Streaming Provider Contract

Streaming providers are separate from metadata providers and use the model in `docs/11-streaming-data-model.md`.

Core exposes the type-only contract under `packages/core/src/streaming`.

```ts
export interface StreamingProvider {
  name: string;
  version?: string;
  kind: "streaming";
  capabilities: StreamingProviderCapabilities;

  getAvailability(
    query: StreamQuery,
    context: ProviderContext
  ): Promise<MediaAvailability | null>;
}
```

The future streaming contract should support a UI flow where one media item or episode can return multiple player options. For example, a Kodik provider and later alternative providers can return normalized embed/HLS/MP4 options with provider name, player label, translation, subtitles, quality, episode number, and required headers when allowed.

Streaming provider `name` follows the same rule as metadata providers: unique, lowercase, stable, non-empty, and no leading or trailing whitespace. `MediaEngine.getStreamingProviders()` returns safe copied metadata for the same reason as `getProviders()`.

This contract is part of the v0.5 streaming architecture. It does not make metadata providers depend on streaming providers.
