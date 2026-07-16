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

Each result contains a normalized item, a score, and source attribution. Response metadata reports requested, successful, and failed providers, cache state, total elapsed time, and optional warnings/debug timings. Retries, fallback queries, and enrichment share one timeout budget per provider within the operation.

## Details

```ts
const response = await engine.getDetails({
  imdb: "tt0816692",
  type: "movie",
  language: "en",
});
```

Details merge compatible provider responses into one movie, series, or anime object. A valid request can return `details: null` when no provider has a matching item.

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

Query parameters mirror the core query objects. The API also exposes generated OpenAPI documentation when running locally.

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
