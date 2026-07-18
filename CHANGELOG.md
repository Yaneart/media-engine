# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

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
