# Media Engine Provider System

## Purpose

A provider is an adapter for an external data source. It knows how to call one source and map the response into Media Engine models.

Core knows only the provider contract. It does not know TMDB, Shikimori, Kinopoisk, Kodik, or any concrete API.

## Provider Kinds

```ts
type ProviderKind = "metadata";
```

Early versions implement only metadata providers. Streaming providers are designed later and are not part of the v0.1 core contract.

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

- `name` is unique, lowercase, and stable;
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
const provider = tmdbProvider({
  apiKey: process.env.TMDB_API_KEY,
  language: "ru-RU",
});
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

`ProviderInfo` is safe to return from `MediaEngine.getProviders()` and from the REST API. It must not include secrets, API keys, internal HTTP clients, or provider raw configuration.

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

## Streaming Provider Placeholder

Future contract:

```ts
export interface StreamingProvider {
  name: string;
  version?: string;
  kind: "streaming";
  capabilities: StreamingProviderCapabilities;

  getAvailability(
    query: AvailabilityQuery,
    context: ProviderContext
  ): Promise<MediaAvailability | null>;
}
```

The future streaming contract should support a UI flow where one media item or episode can return multiple player options. For example, a Kodik provider and later alternative providers can return normalized embed/HLS/MP4 options with provider name, player label, translation, subtitles, quality, episode number, and required headers when allowed.

This is not part of v0.1 implementation.
