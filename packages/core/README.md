# @media-engine/core

Core TypeScript package for Media Engine.

It owns the framework-independent engine, public media types, provider contracts, streaming provider contracts, provider registry, merge strategy, cache interface, error model, and testing utilities.

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

Applications can bound slower optional providers independently while keeping a global upper limit:

```ts
const media = new MediaEngine({
  providers,
  timeoutMs: 5_000,
  providerTimeouts: {
    cinemeta: 2_500,
    wikidata: 2_500,
  },
});
```

The effective timeout is the smaller of `timeoutMs` and the matching `providerTimeouts` value.

## Streaming Availability Contract

Streaming availability is separate from metadata search and details. Configure streaming providers through `streamingProviders` and call `getAvailability` with a media or episode identity.

```ts
import { MediaEngine, createMockProvider } from "@media-engine/core";
import type { StreamingProvider } from "@media-engine/core";

const streamingProvider: StreamingProvider = {
  name: "example-streaming",
  kind: "streaming",
  capabilities: {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: true,
      byExternalIds: ["imdb"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities"],
  },
  async getAvailability(query) {
    return {
      query,
      options: [],
      sourceProviders: [{ provider: "example-streaming" }],
      checkedAt: new Date().toISOString(),
    };
  },
};

const media = new MediaEngine({
  providers: [createMockProvider()],
  streamingProviders: [streamingProvider],
});

const availability = await media.getAvailability({
  type: "movie",
  imdb: "tt0816692",
});
```

Core does not decide whether a third-party player source is appropriate for a product. Concrete streaming providers must document their own source rules and expose only safe access URLs.

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

## Availability Response Example

```ts
import { MediaEngine, createSuccessProvider } from "@media-engine/core";

const media = new MediaEngine({
  providers: [createSuccessProvider()],
});

const response = await media.getAvailability({
  type: "movie",
  imdb: "tt0816692",
});
```

When no streaming providers are configured, `options` is empty and `sourceProviders` is empty. Provider failures are exposed through response metadata when configured providers fail.

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
