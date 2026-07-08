# Public API Audit

## Scope

This document records the public API status after v0.6 SDK work and before v1.0 release preparation.

The audit covers:

- `@media-engine/core`;
- `@media-engine/providers`;
- `@media-engine/sdk`;
- the REST API shape used by the SDK and example app;
- the current streaming availability surface.

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
  kinobdStreamingProvider,
  kodikProvider,
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
- streaming availability types such as `StreamQuery`, `MediaAvailability`, `StreamOption`, `PlayerSource`, `StreamAccess`, and `StreamingProvider`;
- testing utilities under the root `@media-engine/core` export.

The stable engine methods are:

```ts
const engine = new MediaEngine(options);

await engine.search(query);
await engine.getDetails(query);
await engine.getAvailability(query);
engine.getProviders();
engine.getStreamingProviders();
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

The provider package also exports streaming provider factories:

- `kinobdStreamingProvider`;
- `kodikProvider`;
- `experimentalStreamingProvider`.

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
await client.getAvailability(query);
await client.getProviders();
await client.getStreamingProviders();
await client.getHealth();
```

SDK methods must call the public REST API and must not import NestJS, React, or provider packages.

## REST API Baseline

The SDK and example app currently depend on these REST endpoints:

- `GET /health`;
- `GET /providers`;
- `GET /providers/streaming`;
- `GET /media/search`;
- `GET /media/details`;
- `GET /media/availability`;
- `GET /docs`;
- `GET /docs-json`.

The stable data responses for `search`, `details`, `availability`, `providers`, and `providers/streaming` should continue to match the core response, availability, and provider metadata types.

Error responses may evolve before v1.0, but SDK error handling must keep exposing `MediaEngineApiError` with HTTP status and parsed response body.

## Streaming Availability Surface

Streaming is intentionally separate from metadata search/details.

The current streaming model, `StreamingProvider` contract, `MediaEngine.getAvailability`, SDK `getAvailability`, and REST `/media/availability` endpoint are part of the pre-release public surface.

The `experimentalStreamingProvider` factory remains test/demo infrastructure, not a production provider. Real streaming providers are best-effort integrations over allowed embed/API surfaces and must document source rules.

Breaking changes are still allowed in:

- `StreamQuery`;
- `MediaAvailability`;
- `StreamOption`;
- `PlayerSource`;
- `StreamAccess`;
- `StreamingProvider`;
- `experimentalStreamingProvider`;
- real streaming provider option shapes before v1.0;
- related translation, quality, subtitle, audio, and episode mapping types.

Before v1.0, streaming changes must update `docs/11-streaming-data-model.md` and this audit document.

## Breaking Change Rules

Before v1.0, breaking changes are allowed only when they are deliberate and documented.

After v1.0, the following changes are breaking:

- removing a root export from `@media-engine/core`, `@media-engine/providers`, or `@media-engine/sdk`;
- renaming public classes, functions, interfaces, type aliases, or enum-like string unions;
- changing required constructor options or method parameters;
- changing `MediaEngine.search`, `MediaEngine.getDetails`, `MediaEngine.getAvailability`, `MediaEngine.getProviders`, `MediaEngine.getStreamingProviders`, or SDK method behavior in a way that valid existing calls fail;
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

The current public surface is coherent enough to proceed to final documentation and release audit.

No runtime API change is required before release preparation. The main release risk is not the API shape, but the best-effort nature of live third-party metadata and player providers; release notes must describe that honestly and keep smoke checks in the release gate.
