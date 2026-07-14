# Roadmap

This roadmap is intentionally short. Detailed task lists and session plans are kept outside the public repository because they become stale quickly.

## Released

Version `0.1.0` established the first public baseline:

- framework-independent core engine;
- normalized movie, series, anime, and streaming models;
- concurrent metadata and streaming provider orchestration;
- no-token built-in providers plus optional local IMDb datasets;
- deterministic merging, caching, timeouts, retries, and partial failures;
- NestJS API, typed SDK, and React example;
- public npm packages for core, providers, and SDK.

## Current focus

1. Make repository and package documentation shorter, clearer, and available in English and Russian.
2. Refactor large internal modules without changing public APIs or search behavior.
3. Strengthen repeatable search-quality and performance regression checks.
4. Audit code quality, cancellation, caching, complexity, and hot paths.

## Later

- improve resilience when public upstream providers change;
- add providers only when their access model and usage boundaries are clear;
- expand localization and normalized subtitle/audio metadata;
- improve contributor documentation and release automation;
- stabilize contracts toward `1.0.0` based on real consumer feedback.

## Principles

- built-in providers should not require private credentials or account cookies;
- metadata and streaming remain separate layers;
- external IDs and provider attribution stay visible;
- live upstream data is described honestly as best-effort;
- measured reliability and performance matter more than a long feature checklist.
