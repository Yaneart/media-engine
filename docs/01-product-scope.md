# Media Engine Product Scope

## Purpose

This document defines what belongs to each project phase and what is intentionally delayed.

The main rule is to build a small but correct engine first, then add providers, API, UI, SDK, and streaming features.

## Version Strategy

```txt
Phase 0 -> project design
v0.1    -> core foundation
v0.2    -> real metadata providers
v0.3    -> NestJS API
v0.4    -> React example app
v0.5    -> streaming provider architecture
v0.6    -> SDK and client contracts
v1.0    -> stable public release
```

## Phase 0: Project Design

Includes:

- project charter;
- product scope;
- architecture;
- public API;
- data model;
- provider system;
- merge strategy;
- repository structure;
- roadmap;
- task backlog;
- execution rules.

No production code is written in this phase.

## v0.1: Core Foundation

Goal: create framework-independent `@media-engine/core`.

Includes:

- pnpm monorepo skeleton;
- TypeScript configuration;
- core data types;
- `MediaEngine` class;
- `MediaProvider` contract;
- provider registry;
- search flow;
- details flow;
- default merge strategy;
- error model;
- optional memory cache;
- mock provider for tests;
- unit tests.

Does not include:

- real TMDB, IMDb, Kinopoisk, or Shikimori requests;
- NestJS API;
- React app;
- streaming providers;
- database;
- authentication;
- SDK.

Done when `MediaEngine` works with mock providers and returns normalized search/details responses.

## v0.2: Metadata Providers

Goal: prove provider contract with real metadata sources.

Includes:

- `@media-engine/providers`;
- TMDB provider;
- Shikimori provider;
- Wikidata provider;
- shared HTTP utilities;
- provider-specific config;
- mappers from external responses to core model;
- provider error mapping;
- mock HTTP tests;
- provider documentation.

KinoBD, Cinemeta, and Wikidata are merged as the no-token metadata baseline for movies and series. Shikimori is first for anime.

IMDb, Kinopoisk, and AniList are important planned metadata sources, but they are not required to prove the first provider architecture. Add them after TMDB, Shikimori, and Wikidata are stable.

## v0.3: NestJS API

Goal: expose Media Engine through HTTP.

Includes:

- `apps/api`;
- NestJS setup;
- MediaEngine module configuration;
- provider configuration through env;
- search endpoint;
- details endpoint;
- providers endpoint;
- health endpoint;
- DTO validation;
- Swagger/OpenAPI.

API-level cache and rate limiting are future hardening work and are not part of the current REST API baseline.

Initial endpoints:

```txt
GET /health
GET /providers
GET /media/search
GET /media/details
```

## v0.4: React Example App

Goal: demonstrate API usage through a simple UI.

Includes:

- `apps/example`;
- search page;
- result list;
- details page;
- poster, ratings, genres, and external IDs;
- loading, error, and empty states;
- responsive layout.

It is a demo, not the main product.

## v0.5: Streaming Provider Architecture

Goal: add an availability/streaming layer without mixing it with metadata.

Includes:

- `StreamingProvider` contract;
- availability model;
- stream/player result model;
- translations;
- episode sources;
- player sources;
- player selection data for UI;
- one experimental streaming provider;
- docs and tests.

Streaming providers are separate from metadata providers.

Target user experience: an application can open a media details page, choose an episode, show a video window, and let the user choose between available players/providers such as Kodik and later alternatives. Media Engine should return normalized player/stream options; the frontend owns rendering the iframe/video UI.

Example future flow:

```txt
search title -> get details -> choose episode -> get stream options -> UI selects player
```

Example future player grouping:

```txt
Kodik
  AniDUB / 720p
  Subtitles / 1080p

Other provider
  Voice / 720p
```

## v0.6: SDK

Goal: add a typed client for Media Engine API.

Includes:

- `@media-engine/sdk`;
- typed `MediaEngineClient`;
- search/details methods;
- providers and health methods;
- API error handling;
- browser and Node.js compatibility;
- example app integration.

## v1.0: Stable Release

Goal: stabilize public contracts.

Includes:

- stable core API;
- stable provider contract;
- stable data model;
- stable REST API baseline;
- tests;
- contributor docs;
- README;
- changelog;
- license;
- release workflow.

## Explicitly Delayed

Delayed until separate decisions:

- scraping without stable API;
- bypassing protections;
- video hosting;
- own media player;
- user accounts;
- favorites;
- history;
- recommendations;
- ML matching;
- distributed workers;
- database-first architecture.
