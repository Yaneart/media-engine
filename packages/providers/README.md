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

No API keys, environment reads, HTTP clients, or real provider implementations are included in `TASK-020`.
