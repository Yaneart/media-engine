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

Each result contains a normalized item, a score, and source attribution. Response metadata reports requested, successful, and failed providers, cache state, total elapsed time, and optional warnings/debug timings. Search failures and timings may identify their primary, retry, fallback, ID-enrichment, or poster-enrichment phase. Optional enrichment failures preserve base results and normal cache behavior while returning bounded warnings and debug counters; mandatory retryable degradation prevents a normal cache write. Retries and fallback queries share one timeout budget per provider within the operation. Optional enrichment is additionally bounded to the top discovery window, six calls globally, two calls per provider, and 1.5 seconds total; matching ID-search and cached/in-flight details outcomes are reused for canonical poster selection.

Mandatory discovery and snapshot recovery freeze each result's identity, score, and relative order before optional enrichment. Enrichment can add presentation fields, non-conflicting external IDs, source attribution, and an alias that makes a frozen unresolved candidate relevant. It cannot introduce a new result, replace `id`, `type`, `title`, `originalTitle`, or `year`, change the score, or rerank results. An external-ID conflict keeps the mandatory discovery value and emits `EXTERNAL_ID_CONFLICT`.

For title discovery, a supported multi-word typo is broadened through primary providers whenever no exact title exists, including when weak fuzzy candidates are non-empty. Fallback title providers also run for a multi-word query without an exact identity. Mandatory ranking prefers close token-length matches, broadly reusable external IDs, and audience signals with known vote counts before its order is frozen.

When a cache is configured, the first healthy mandatory discovery whose top candidate has a strong external ID also stores a separate 30-minute identity snapshot of at most 20 candidates without refreshing it inside that window. Equivalent cache misses with different limits use it to keep confirmed identities stable across successful upstream drift and report `SEARCH_IDENTITY_SNAPSHOT_STABILIZED` when the result changes. A partial response with retryable mandatory degradation can use the same recovery while retaining current provider failures and `cached: false`; it reports `SEARCH_IDENTITY_SNAPSHOT_FALLBACK`. Both paths expose optional debug recovery counters and refuse conflicting strong IDs. Non-retryable degradation does not use or update the snapshot, weak top candidates cannot establish it, and a first cold degraded request cannot recover this way.

Engine queries are canonicalized before provider selection and cache/coalescing key creation. Top-level external-ID shortcuts and nested `ids` share one normalized representation, string fields are trimmed and bounded, known IMDb/numeric ID formats are validated, language is lowercased, and availability provider filters are deduplicated and sorted. `limit: 0` is a valid search that returns immediately without provider or cache work.

All three engine operations accept an optional second argument:

```ts
const controller = new AbortController();
const pending = engine.search({ title: "Interstellar" }, { signal: controller.signal });

controller.abort();
await pending;
```

Every caller of a coalesced request owns an independent subscription. Cancelling one caller leaves shared provider work running for other subscribers; cancelling the last subscriber aborts the shared provider signal, removes queued work, and prevents a later cache write. Client cancellation is distinct from provider timeout and does not increment provider circuit failure counters.

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

The media endpoints connect request/response disconnect events to the engine operation signal and remove their lifecycle listeners when the operation settles. An HTTP client that closes early therefore stops waiting immediately and cancels shared provider work only when no other identical request is still subscribed.

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
