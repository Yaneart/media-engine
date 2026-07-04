# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

## Unreleased

### Added

- `@media-engine/core` with media data types, provider contracts, registry, engine search/details orchestration, merge strategy, error model, memory cache, streaming contract types, and testing utilities.
- `@media-engine/providers` with shared HTTP utilities, TMDB provider, Shikimori provider, and experimental streaming provider.
- `@media-engine/api` NestJS REST API with health, providers, search, details, and Swagger/OpenAPI endpoints.
- `@media-engine/example` React app that calls the API through `@media-engine/sdk`.
- `@media-engine/sdk` with typed search, details, providers, health, and API error handling.
- Development Docker Compose stand for the API and React example app.

### Release Notes

- Package versions remain `0.0.0` until the first published release version is chosen.
- Streaming types and `experimentalStreamingProvider` are architecture-validation APIs and are not yet v1.0-stable.
