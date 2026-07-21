# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

## Unreleased

### Changed

- Details lookup now requires a namespaced external ID. The ambiguous `DetailsQuery.id` field is deprecated, and id-only core/API/SDK requests return `INVALID_QUERY` or HTTP 400 instead of a cacheable successful null response.
- Search provider metadata now distinguishes primary, retry, fallback, ID-enrichment, and poster-enrichment phases. Mandatory retryable fallback degradation remains cache-safe, while optional enrichment failures return bounded warnings and debug counters without discarding base results.
- Shared provider HTTP errors retain their response status through `getProviderHttpStatus`, allowing adapters to distinguish confirmed absence from other non-retryable responses.
- Provider JSON and FlixHQ HTML responses are read through a streaming byte limit instead of being fully buffered first. Oversized bodies now fail with `PROVIDER_RESPONSE_TOO_LARGE`, distinct from invalid JSON, and `fetchJson` accepts a bounded `maxResponseBytes` override.
- FlixHQ navigation is confined to its configured origin with manual bounded redirects. Server-side player and subtitle checks now reject private/reserved literal or DNS targets, mixed public/private answers, and unsafe redirect hops while pinning each connection to its validated address.
- Built-in provider artwork, player, subtitle, and related output URLs now share an HTTP(S)-only policy that rejects credentials, raw control characters, and literal local/private/reserved targets without removing valid CDN query parameters or signatures. The example keeps external links as the default and loads sandboxed embeds only after explicit user action with no referrer.
- Search, details, and availability queries now use one canonical validated shape for provider selection, cache, and in-flight keys. External-ID shortcuts collapse into trimmed `ids`, language and provider filters are normalized, known ID formats and field lengths are bounded, and `limit: 0` returns without provider or cache work. `MemoryCache` now rejects non-finite, fractional, negative, or unsafe-integer TTL values; omitted TTL remains the documented no-expiry mode.
- Public engine operations now accept an optional abort signal with subscriber-aware request coalescing. Cancelling one caller leaves shared work available to others; cancelling the last subscriber aborts provider work, removes queued calls, prevents cache writes, and is not recorded as an upstream circuit failure. Nest media endpoints connect HTTP disconnects to this lifecycle.
- Search ID and poster enrichment now use one top-N planner with a six-call global budget, a two-call per-provider budget, and a 1.5-second wall-time boundary. Matching ID-search results and cached or in-flight details are reused instead of starting duplicate poster lookups.
- Metadata providers can declare primary or fallback title discovery and can opt out of best-effort search-card enrichment. The engine broadens supported typos through primary sources first, then invokes fallback sources only for empty or conflicting exact-title candidates; direct external-ID lookup remains immediate across all compatible providers. Built-in Wikidata now uses the fallback role without allowing short optional enrichment calls to consume its circuit and timeout capacity.
- The first healthy search discovery with a strong top identity now retains a separate bounded 30-minute snapshot across equivalent limits. It keeps later cache misses stable across successful upstream drift and retryable partial degradation without refreshing the window, promoting weak ID-less results, hiding current provider failures, caching degraded responses, or merging conflicting strong IDs.
- Mandatory search discovery and eligible snapshot recovery now freeze result identities, scores, and order before optional ID/details/poster enrichment. Enrichment only augments matching cards with presentation data, non-conflicting IDs, and source attribution; it cannot introduce or rerank identities, and conflicting added IDs retain the discovery value with a warning.
- Mandatory title discovery now broadens supported multi-word typos despite weak fuzzy noise and invokes fallback identity sources for multi-word queries without an exact match. Ranking prefers closer token-length matches, broadly reusable external IDs, and audience-backed ratings before the identity order is frozen.
- Built-in debug search results now expose the exact ranking formula, match strength, title match, normalized factor weights/contributions, and score/diversity/final positions. A bounded top-10 diversity pass keeps the first result and every score unchanged while interleaving only similarly ranked candidates after two results from the same normalized title and media type.

### Fixed

- Cinemeta untyped IMDb details lookups no longer turn movie/series branch outages into cacheable successful null responses.
- AniList HTTP-200 GraphQL rate-limit and server errors now remain retryable provider failures, while validation errors and malformed payloads receive non-retryable typed categories.
- Streaming providers that resolve `null` now count as successful no-result responses, so a separate provider failure no longer causes a false all-failed error.
- Player validation removes options only after 404/410 or a stable deletion marker. Transient HTTP, network, and timeout failures keep the discovered option as `unknown`, add a bounded warning, and prevent normal availability caching until validation recovers.
- Example embed sandboxing now preserves the third-party player origin after explicit iframe opt-in, avoiding `Origin: null` CORS failures in players that load their own resources.

## 0.1.1 - 2026-07-18

### Added

- Process-local provider health telemetry, per-provider circuit breaking with recovery probes, bounded provider concurrency, and provider-specific timeout budgets.
- Optional stale metadata cache retention for retryable upstream outages. Availability links remain fresh-only.
- Adaptive HTTP retry delays with jitter, `Retry-After` support, and shared per-provider rate-limit cooldowns.
- English and Russian package documentation covering the current engine, provider, SDK, API, and Docker workflows.

### Changed

- Identical in-flight search, details, and availability requests are coalesced while preserving isolated response objects for each caller.
- Search performs fewer poster-enrichment requests, keeps canonical search/details posters consistent, and applies bounded provider work throughout fallback and enrichment paths.
- Engine, merge, KinoBD streaming, and example-app internals were split into responsibility-focused modules without changing package entrypoints.
- Cache ownership and provider cancellation boundaries were hardened; numeric provider options are validated and direct streaming cache lifetimes respect advertised expiration.

### Fixed

- Partial search, details, and availability responses containing retryable provider failures are no longer stored as complete cache entries; a repeated request can recover missing metadata or players.
- Provider-specific streaming timeouts are no longer silently capped by a shorter global default.
- English details titles prefer independently corroborated localized values, fixing mixed-ID results such as Death Note.
- Provider failures now retain bounded timeout, rate-limit, unavailable, and other diagnostic counters.

### Performance

- Cold representative searches reduced upstream request amplification by up to roughly half while keeping per-provider concurrency at or below the configured limit.
- The final `0.1.1` strict title matrix passed all 17 canonical English, Russian, typo, and anime cases with no warnings or deterministic failures, compared with 3 passes and 14 upstream warnings before the performance work.

### Public API

- No existing package exports or method signatures were removed.
- `MediaEngineOptions` gained optional circuit-breaker and provider-concurrency tuning, and `MediaEngine` gained `getProviderHealth()`.
- The cache contract gained optional stale-read support, response metadata gained an optional stale marker, and metadata providers gained an optional poster-consistency capability flag.
- Provider HTTP utilities gained bounded retry tuning and the exported `ProviderRateLimitGate`; SDK health responses now expose provider health data.

## 0.1.0 - 2026-07-13

### Added

- `@media-engine/core` with media data types, provider contracts, registry, engine search/details orchestration, merge strategy, error model, memory cache, streaming contract types, and testing utilities.
- `@media-engine/providers` with shared HTTP utilities; KinoBD, Cinemeta, Shikimori, AniList, Wikidata, and local IMDb dataset metadata providers; plus KinoBD/ReYohoho-style, FlixHQ, and experimental streaming providers.
- `@media-engine/api` NestJS REST API with health, providers, streaming providers, search, details, availability, and Swagger/OpenAPI endpoints.
- `@media-engine/example` React app that calls the API through `@media-engine/sdk` and demonstrates search, details, availability, provider failures, grouped player options, and embed preview/open flows.
- `@media-engine/sdk` with typed search, details, availability, providers, streaming providers, health, and API error handling.
- Development Docker Compose stand for the API and React example app.
- Live provider, search-quality, latency, availability, and source-filter smoke scripts plus npm package dry-run checks.
- FlixHQ international movie and requested-episode discovery with bounded embed validation and normalized public subtitle tracks.

### Release Notes

- This is the first `0.1.0` pre-release candidate for the three public npm packages.
- Live no-token metadata and player providers are best-effort integrations over third-party sources. They should be described honestly in release notes and guarded by smoke checks.
- Streaming providers expose normalized player access metadata; Media Engine does not host video or guarantee third-party availability.
- Removed token-based TMDB and direct Kodik API providers. TMDB IDs may still appear when returned by no-token upstream metadata sources, and Kodik may still be one player discovered through KinoBD.
