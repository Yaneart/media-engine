# Media Engine Public API

## Basic Usage

```ts
import { MediaEngine } from "@media-engine/core";

const media = new MediaEngine({
  providers: [],
});

const result = await media.search({
  title: "Interstellar",
});
```

## Usage with Providers

```ts
import { MediaEngine } from "@media-engine/core";
import { shikimoriProvider, tmdbProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    tmdbProvider({
      apiKey: process.env.TMDB_API_KEY,
      language: "ru-RU",
    }),
    shikimoriProvider(),
  ],
});
```

Concrete providers are always passed from outside. Core does not create them.

## MediaEngine

```ts
class MediaEngine {
  constructor(options?: MediaEngineOptions);

  search(query: SearchQuery): Promise<SearchResponse>;

  getDetails(query: DetailsQuery): Promise<DetailsResponse>;

  getProviders(): ProviderInfo[];
}
```

Only these methods are part of the early public API:

- `search`;
- `getDetails`;
- `getProviders`.

## MediaEngineOptions

```ts
interface MediaEngineOptions {
  providers?: MediaProvider[];
  cache?: Cache;
  mergeStrategy?: MergeStrategy;
  timeoutMs?: number;
  debug?: boolean;
}
```

`providers` are passed from the outside. Core never imports or creates concrete providers by name.

`timeoutMs` is the default timeout for provider calls. A provider may also have its own internal timeout, but the engine-level timeout is the upper orchestration boundary.

## SearchQuery

```ts
interface SearchQuery {
  title?: string;
  type?: MediaType;
  year?: number;
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  limit?: number;
  language?: string;
}
```

A valid query must contain `title`, `ids`, or at least one top-level external ID shortcut.

Top-level external ID fields are convenience shortcuts for the public API. The engine normalizes them into `ids` before provider selection.

Examples:

```ts
await media.search({ title: "Interstellar" });
await media.search({ title: "Naruto", type: "anime" });
await media.search({ imdb: "tt0816692" });
await media.search({ ids: { imdb: "tt0816692" } });
```

## DetailsQuery

```ts
interface DetailsQuery {
  id?: string;
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  type?: MediaType;
  language?: string;
}
```

Example:

```ts
await media.getDetails({
  imdb: "tt0816692",
});

await media.getDetails({
  ids: {
    tmdb: "157336",
    imdb: "tt0816692",
  },
});
```

`id` is reserved for an internal engine ID or a previously returned `MediaItem.id`. Early versions should prefer external IDs for details requests.

## SearchResponse

```ts
interface SearchResponse {
  query: SearchQuery;
  results: MediaSearchResult[];
  meta: ResponseMeta;
}
```

## MediaSearchResult

```ts
interface MediaSearchResult {
  item: MediaItem;
  score: number;
  sources: ProviderSource[];
}
```

`score` is a value from `0` to `1`.

## DetailsResponse

```ts
interface DetailsResponse {
  query: DetailsQuery;
  details: MediaDetails | null;
  meta: ResponseMeta;
}
```

## ResponseMeta

```ts
interface ResponseMeta {
  providers: ProviderExecutionMeta;
  cached: boolean;
  tookMs: number;
  warnings?: EngineWarning[];
  debug?: unknown;
}
```

## ProviderExecutionMeta

```ts
interface ProviderExecutionMeta {
  requested: string[];
  successful: string[];
  failed: ProviderFailure[];
}
```

## Cache

```ts
interface Cache {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

interface CacheSetOptions {
  ttlMs?: number;
}
```

The cache interface is optional. `@media-engine/core` provides a simple `MemoryCache` for v0.1.

## MergeStrategy

```ts
interface MergeStrategy {
  mergeSearchResults(
    results: ProviderSearchResult[],
    context: MergeContext
  ): MediaSearchResult[];

  mergeDetails(
    results: ProviderDetailsResult[],
    context: MergeContext
  ): MediaDetails | null;
}
```

Custom merge strategies may be passed through `MediaEngineOptions`, but the default strategy is enough for v0.1.

```ts
interface ProviderFailure {
  provider: string;
  code: ErrorCode;
  message: string;
}
```

## EngineWarning

```ts
interface EngineWarning {
  code: string;
  message: string;
  provider?: string;
}
```

## Errors

Invalid engine usage throws `MediaEngineError`.

Provider failures should usually be represented in `meta.providers.failed` if at least one provider succeeds.

```ts
class MediaEngineError extends Error {
  code: ErrorCode;
  cause?: unknown;
}
```

## Future API

Possible later methods:

```ts
media.getAvailability(query);
media.getSimilar(query);
media.getExternalIds(query);
```

They are intentionally excluded from early versions.
