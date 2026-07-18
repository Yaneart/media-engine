# Public API

The exact TypeScript declarations exported by the packages are the API source of truth. This document describes the main operations and response behavior.

## Install

```bash
pnpm add @media-engine/core @media-engine/providers
```

Install `@media-engine/sdk` instead when an application talks to the HTTP API.

## Create an engine

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  wikidataProvider,
} from "@media-engine/providers";

const engine = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
    wikidataProvider(),
  ],
});
```

`MediaEngineOptions` also accepts streaming providers, a cache, a custom merge strategy, a global timeout, provider-specific timeouts, debug mode, and optional circuit-breaker tuning. The circuit breaker is enabled by default, opens after three consecutive retryable failures, and permits one recovery probe after 30 seconds. Use `failureThreshold` and `recoveryTimeoutMs` to tune it, or pass `circuitBreaker: false` to disable it.

Provider work is also limited to two concurrent calls per provider by default, with a bounded cancellable queue. Configure `providerConcurrency.defaultMaxConcurrent`, `maxQueueSize`, and `providerLimits` for local overrides, or pass `providerConcurrency: false` to disable the gate. Queue waiting consumes the same provider timeout budget as network work.

## Search

```ts
const response = await engine.search({
  title: "Interstellar",
  type: "movie",
  language: "en",
  limit: 10,
});
```

A search query may use a title, media type, year, external IDs, language, and limit. Common external IDs can be passed inside `ids` or through shortcut fields such as `imdb`, `kinopoisk`, and `shikimori`.

Each result contains a normalized item, a score, and source attribution. Response metadata reports requested, successful, and failed providers, cache state, total elapsed time, and optional warnings/debug timings. Search failures and timings may identify their primary, retry, fallback, ID-enrichment, or poster-enrichment phase. Optional enrichment failures preserve base results and normal cache behavior while returning bounded warnings and debug counters; mandatory retryable degradation prevents a normal cache write. Retries, fallback queries, and enrichment share one timeout budget per provider within the operation.

## Details

```ts
const response = await engine.getDetails({
  imdb: "tt0816692",
  type: "movie",
  language: "en",
});
```

Details queries require at least one namespaced external ID, either inside `ids` or through a shortcut such as `imdb`, `kinopoisk`, or `shikimori`. The plain `DetailsQuery.id` field is deprecated because provider-native IDs do not share a global namespace; an id-only query throws `INVALID_QUERY`. A valid external-ID request can return `details: null` when selected providers have no matching item.

## Availability

```ts
import { kinobdStreamingProvider } from "@media-engine/providers";

const streamingEngine = new MediaEngine({
  streamingProviders: [kinobdStreamingProvider()],
});

const availability = await streamingEngine.getAvailability({
  type: "series",
  imdb: "tt0944947",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

Availability responses contain normalized player/stream options and optional episode groups. Options may describe an embed, HLS, MP4, or external target together with translation, quality, subtitle, audio, expiry, and provider metadata when available.

Returned options are discovered from third-party sources. They are not a guarantee that playback works in every browser, country, or network.

## Errors and partial failures

Invalid queries throw `MediaEngineError`. Provider failures are normalized and include a stable code plus retryability. If at least one selected provider succeeds, the engine normally returns a partial response and records other failures in `meta.providers.failed`. If every selected provider fails, the operation throws.

## HTTP API

The example NestJS application exposes:

```text
GET /health
GET /providers
GET /providers/streaming
GET /media/search
GET /media/details
GET /media/availability
```

Query parameters mirror the core query objects. `GET /media/details` documents only namespaced external IDs and returns HTTP 400 for an id-only lookup. The API also exposes generated OpenAPI documentation when running locally.

`GET /health` includes process-local provider counters and circuit states. These diagnostics contain provider names, success/failure counts, timestamps, and recovery delay only; they do not expose credentials or provider internals.

## SDK

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const client = new MediaEngineClient({
  baseUrl: "http://localhost:3000",
});

const response = await client.search({ title: "One Piece" });
```

The SDK provides `search`, `getDetails`, `getAvailability`, `getProviders`, `getStreamingProviders`, and `getHealth`. Requests accept an abort signal and extra headers.
