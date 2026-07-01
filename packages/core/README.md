# @media-engine/core

Core TypeScript package for Media Engine.

It owns the framework-independent engine, public media types, provider contracts, provider registry, merge strategy, cache interface, error model, and testing utilities.

Core does not import concrete providers and does not read API keys from the environment. Providers are passed in from the outside.

## Basic Usage

```ts
import { MediaEngine, createMockProvider } from "@media-engine/core";

const media = new MediaEngine({
  providers: [createMockProvider()],
});

const response = await media.search({
  title: "Interstellar",
});

console.log(response.results[0]?.item.title);
console.log(response.meta.providers.successful);
```

## Usage With Mock Provider

```ts
import {
  MediaEngine,
  createDetailsResult,
  createMockProvider,
  createSearchResult,
  sampleMovie,
} from "@media-engine/core";

const mockProvider = createMockProvider({
  name: "local-fixture",
  searchResults: [createSearchResult("local-fixture", sampleMovie)],
  detailsResult: createDetailsResult("local-fixture", sampleMovie),
});

const media = new MediaEngine({
  providers: [mockProvider],
});

const search = await media.search({
  imdb: "tt0816692",
});

const details = await media.getDetails({
  imdb: "tt0816692",
});

console.log(search.results.length);
console.log(details.details?.title);
```

## Provider Contract Overview

A provider is a small object that implements the `MediaProvider` contract:

```ts
import type { MediaProvider } from "@media-engine/core";

export const provider: MediaProvider = {
  name: "example",
  kind: "metadata",
  capabilities: {
    mediaTypes: ["movie", "series", "anime"],
    search: {
      byTitle: true,
      byExternalIds: ["imdb", "tmdb"],
    },
    details: {
      byExternalIds: ["imdb", "tmdb"],
    },
  },
  async search(query, context) {
    return [];
  },
  async getDetails(query, context) {
    return null;
  },
};
```

`capabilities` tell the engine when a provider can be selected. `search` returns normalized provider search results. `getDetails` is optional; providers without it are skipped by `MediaEngine.getDetails`.

Provider methods receive a `context` with `signal`, `timeoutMs`, `debug`, and `language`. Providers should respect `context.signal` when they perform slow work.

## Search Response Example

```ts
import { MediaEngine, createSuccessProvider } from "@media-engine/core";

const media = new MediaEngine({
  providers: [createSuccessProvider()],
});

const response = await media.search({
  title: "Interstellar",
});
```

Shape:

```ts
{
  query: {
    title: "Interstellar",
  },
  results: [
    {
      item: {
        id: "sample-movie-interstellar",
        type: "movie",
        title: "Interstellar",
        year: 2014,
      },
      score: 0.5,
      sources: [
        {
          provider: "success-provider",
        },
      ],
    },
  ],
  meta: {
    providers: {
      requested: ["success-provider"],
      successful: ["success-provider"],
      failed: [],
    },
    cached: false,
    tookMs: 1,
  },
}
```

`score`, `tookMs`, and optional fields can vary with the provider result and merge strategy.

## Details Response Example

```ts
import { MediaEngine, createSuccessProvider } from "@media-engine/core";

const media = new MediaEngine({
  providers: [createSuccessProvider()],
});

const response = await media.getDetails({
  imdb: "tt0816692",
});
```

Shape:

```ts
{
  query: {
    imdb: "tt0816692",
    ids: {
      imdb: "tt0816692",
    },
  },
  details: {
    id: "sample-movie-interstellar",
    type: "movie",
    title: "Interstellar",
    year: 2014,
  },
  meta: {
    providers: {
      requested: ["success-provider"],
      successful: ["success-provider"],
      failed: [],
    },
    cached: false,
    tookMs: 1,
  },
}
```

If selected providers return no details, `details` is `null`.

## Testing Utilities

The core package exports deterministic helpers for tests and examples:

- `createMockProvider`;
- `createSuccessProvider`;
- `createFailingProvider`;
- `createTimeoutProvider`;
- `sampleMovie`;
- `sampleSeries`;
- `sampleAnime`.

These helpers do not call real APIs and do not require API keys.
