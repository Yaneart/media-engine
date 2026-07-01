# @media-engine/providers

Provider package for Media Engine.

This package will contain concrete metadata provider factories such as TMDB and Shikimori. It is intentionally empty at initialization time; real provider implementations are added by later backlog tasks.

The package depends on `@media-engine/core` for provider contracts and normalized media types. Core must not import this package.

Planned structure:

```txt
src/
  shared/
  tmdb/
  shikimori/
  index.ts
```

No API keys, environment reads, or real provider implementations are included yet.

## Shared Utilities

`src/shared` contains provider-side helpers used by future concrete providers:

- `fetchJson`;
- `parseJsonResponse`;
- `mapProviderHttpError`;
- `mapHttpStatusToProviderErrorCode`.

These helpers map HTTP, JSON parsing, network, and timeout failures into `ProviderError` from `@media-engine/core`.
