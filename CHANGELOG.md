# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

## Unreleased

### Added

- `@media-engine/core` with media data types, provider contracts, registry, engine search/details orchestration, merge strategy, error model, memory cache, streaming contract types, and testing utilities.
- `@media-engine/providers` with shared HTTP utilities, KinoBD, Cinemeta, TMDB, Shikimori, Wikidata, local IMDb dataset, Kodik streaming, KinoBD/ReYohoho-style streaming, and experimental streaming providers.
- `@media-engine/api` NestJS REST API with health, providers, streaming providers, search, details, availability, and Swagger/OpenAPI endpoints.
- `@media-engine/example` React app that calls the API through `@media-engine/sdk` and demonstrates search, details, availability, provider failures, grouped player options, and embed preview/open flows.
- `@media-engine/sdk` with typed search, details, availability, providers, streaming providers, health, and API error handling.
- Development Docker Compose stand for the API and React example app.
- Live provider and availability smoke scripts plus npm package dry-run checks.

### Release Notes

- Package versions remain `0.0.0` until the first published release version is chosen.
- Live no-token metadata and player providers are best-effort integrations over third-party sources. They should be described honestly in release notes and guarded by smoke checks.
