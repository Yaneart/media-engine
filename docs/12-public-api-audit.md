# Public API Audit

## Scope

This document records the public API status after v0.6 SDK work and before v1.0 release preparation.

The audit covers:

- `@media-engine/core`;
- `@media-engine/providers`;
- `@media-engine/sdk`;
- the REST API shape used by the SDK and example app;
- the current experimental streaming surface.

## Package Entry Points

All publishable packages expose only their package root as a supported import path.

Supported:

```ts
import { MediaEngine } from "@media-engine/core";
import {
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tmdbProvider,
  wikidataProvider,
} from "@media-engine/providers";
import { MediaEngineClient } from "@media-engine/sdk";
```

Not supported:

```ts
import { MediaEngine } from "@media-engine/core/dist/engine/engine.js";
import { tmdbProvider } from "@media-engine/providers/dist/tmdb/index.js";
import { MediaEngineClient } from "@media-engine/sdk/dist/client.js";
```

Deep imports are internal implementation details and may change without a deprecation window before v1.0.

## Stable Core Surface

The stable core surface for the first release is:

- `MediaEngine`;
- `MediaEngineOptions`;
- `SearchQuery`;
- `SearchResponse`;
- `MediaSearchResult`;
- `DetailsQuery`;
- `DetailsResponse`;
- media data model types such as `MediaItem`, `MediaDetails`, `MovieDetails`, `SeriesDetails`, and `AnimeDetails`;
- provider contract types such as `MediaProvider`, `ProviderInfo`, `ProviderCapabilities`, and provider query/result types;
- `ProviderRegistry`;
- `MediaEngineError`;
- `ProviderError`;
- `ErrorCode`;
- `ProviderErrorCode`;
- `Cache`;
- `MemoryCache`;
- `MergeStrategy`;
- `DefaultMergeStrategy`;
- testing utilities under the root `@media-engine/core` export.

The stable engine methods are:

```ts
const engine = new MediaEngine(options);

await engine.search(query);
await engine.getDetails(query);
engine.getProviders();
```

The engine must stay framework-independent. It must not depend on NestJS, React, Express, or concrete provider packages.

## Stable Provider Surface

The stable metadata provider factories are:

- `tmdbProvider`;
- `shikimoriProvider`;
- `wikidataProvider`;
- `kinobdProvider`;
- `cinemetaProvider`;
- `imdbDatasetProvider`.

The provider package also exports shared HTTP helpers for provider implementation work:

- `fetchJson`;
- `parseJsonResponse`;
- `mapProviderHttpError`;
- `mapHttpStatusToProviderErrorCode`.

Provider factories must not read environment variables directly. Applications pass credentials and options from the outside.

## Stable SDK Surface

The stable SDK surface is:

- `MediaEngineClient`;
- `MediaEngineClientOptions`;
- `MediaEngineRequestOptions`;
- `MediaEngineFetch`;
- `MediaEngineApiError`;
- `MediaEngineHealthResponse`;
- response aliases exported by the SDK.

The stable SDK methods are:

```ts
const client = new MediaEngineClient({ baseUrl });

await client.search(query);
await client.getDetails(query);
await client.getProviders();
await client.getHealth();
```

SDK methods must call the public REST API and must not import NestJS, React, or provider packages.

## REST API Baseline

The SDK and example app currently depend on these REST endpoints:

- `GET /health`;
- `GET /providers`;
- `GET /media/search`;
- `GET /media/details`;
- `GET /docs`;
- `GET /docs-json`.

The stable data responses for `search`, `details`, and `providers` should continue to match the core response and provider metadata types.

Error responses may evolve before v1.0, but SDK error handling must keep exposing `MediaEngineApiError` with HTTP status and parsed response body.

## Experimental Streaming Surface

Streaming is intentionally separate from metadata search/details.

The current streaming model and `StreamingProvider` contract are public for architecture validation, but not yet v1.0-stable. The `experimentalStreamingProvider` factory is test/demo infrastructure, not a production provider.

Breaking changes are still allowed in:

- `StreamQuery`;
- `MediaAvailability`;
- `StreamOption`;
- `PlayerSource`;
- `StreamAccess`;
- `StreamingProvider`;
- `experimentalStreamingProvider`;
- related translation, quality, subtitle, audio, and episode mapping types.

Before v1.0, streaming changes must update `docs/11-streaming-data-model.md` and this audit document.

## Breaking Change Rules

Before v1.0, breaking changes are allowed only when they are deliberate and documented.

After v1.0, the following changes are breaking:

- removing a root export from `@media-engine/core`, `@media-engine/providers`, or `@media-engine/sdk`;
- renaming public classes, functions, interfaces, type aliases, or enum-like string unions;
- changing required constructor options or method parameters;
- changing `MediaEngine.search`, `MediaEngine.getDetails`, `MediaEngine.getProviders`, or SDK method behavior in a way that valid existing calls fail;
- removing fields from response objects;
- changing public REST endpoint paths used by the SDK;
- changing error class names or removing `MediaEngineApiError.status`;
- making core depend on providers, API, SDK, React, or NestJS.

The following changes are not breaking when documented:

- adding optional fields to public interfaces;
- adding new provider factories;
- adding new optional query fields;
- adding new provider metadata fields;
- adding new warning codes;
- adding new SDK methods;
- adding new REST endpoints;
- improving merge scoring when response shape stays compatible.

## Audit Result

The current public surface is coherent enough to proceed to documentation audit.

No runtime API change is required for `TASK-100`. The main release risk is that streaming types and the experimental streaming provider are still architecture-validation APIs, not stable v1.0 contracts.

Follow-up release task:

```txt
TASK-102: Release Preparation
```
