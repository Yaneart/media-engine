# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

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
