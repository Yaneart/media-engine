# Media Engine Roadmap

## Phase Map

```txt
Phase 0  -> Project Design
v0.1     -> Core Foundation
v0.2     -> Metadata Providers
v0.3     -> NestJS API
v0.4     -> React Example App
v0.5     -> Streaming Provider Architecture
v0.6     -> SDK and Client Contracts
v1.0     -> Stable Release
```

## Phase 0: Project Design

Goal: prepare the full project foundation before writing production code.

Deliverables:

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

Gate:

- all documents are ready;
- v0.1 tasks are clear;
- no open architectural blocker for core;
- user explicitly approves implementation start.

## v0.1: Core Foundation

Goal: create `@media-engine/core` as an independent TypeScript library.

Deliverables:

- pnpm monorepo;
- core package;
- media types;
- query/response types;
- provider contract;
- provider registry;
- error model;
- default merge strategy;
- memory cache;
- `MediaEngine.search`;
- `MediaEngine.getDetails`;
- mock provider;
- core tests.

Gate:

```bash
pnpm build
pnpm test
pnpm typecheck
```

Core must work with mock providers and match public API docs.

## v0.2: Metadata Providers

Goal: add first real metadata providers.

Deliverables:

- providers package;
- shared provider HTTP utilities;
- TMDB provider;
- Shikimori provider;
- mappers;
- provider error mapping;
- mock HTTP tests.

Gate:

- search by movie through TMDB works;
- search by anime through Shikimori works;
- provider tests pass without live API;
- core does not import concrete providers.

Audit status:

- `@media-engine/providers` exists with shared HTTP utilities, TMDB, and Shikimori;
- provider tests use mock `fetch` implementations and do not call live APIs;
- `@media-engine/core` still depends only on provider contracts, not concrete provider packages.

Post-v0.2 provider expansion:

- AniList is the next safest metadata provider to implement because it has a public GraphQL API and complements Shikimori for anime IDs and airing data;
- IMDb should be planned as a licensed API or non-commercial dataset integration, not as scraping;
- Kinopoisk requires an approved documented API source before implementation;
- additional providers are not required before starting v0.3 API work.

## v0.3: NestJS API

Goal: expose Media Engine over HTTP.

Deliverables:

- NestJS app;
- media module;
- provider env config;
- search endpoint;
- details endpoint;
- providers endpoint;
- health endpoint;
- validation;
- Swagger;
- API tests.

Gate:

- API starts locally;
- `/health` works;
- `/providers` works;
- `/media/search?title=Interstellar` returns normalized response;
- e2e tests pass.

## v0.4: React Example App

Goal: demonstrate API usage.

Deliverables:

- React app;
- search UI;
- results list;
- details view;
- loading/error/empty states;
- responsive layout.

Gate:

- app starts locally;
- user can search;
- results and details render;
- frontend has no provider API keys.

## v0.5: Streaming Provider Architecture

Goal: add availability architecture separately from metadata.

Deliverables:

- streaming data model;
- `StreamingProvider` contract;
- `getAvailability`;
- `getStreams` or equivalent stream/player lookup method;
- normalized player options for UI selection;
- translations, subtitles, qualities, and episode mapping;
- mock streaming provider;
- one experimental provider;
- tests and docs.

Gate:

- metadata search does not depend on streaming;
- availability works separately;
- UI can receive multiple player options such as Kodik and alternatives for one episode;
- docs explain separation.

## v0.6: SDK

Goal: provide typed client for API.

Deliverables:

- `@media-engine/sdk`;
- `MediaEngineClient`;
- search/details methods;
- typed errors;
- tests;
- example app integration.

Gate:

- SDK can call the API search/details/providers endpoints;
- SDK response types match API contracts;
- example app can use SDK without knowing provider details.

## v1.0: Stable Release

Goal: stabilize the public project.

Deliverables:

- stable core API;
- stable provider contract;
- stable data model;
- stable REST API baseline;
- docs;
- tests;
- changelog;
- license;
- release workflow.

## Phase Dependencies

```txt
Phase 0 blocks v0.1
v0.1 blocks v0.2
v0.2 blocks v0.3
v0.3 blocks v0.4
v0.2 + v0.3 block v0.5
v0.3 blocks v0.6
v0.1-v0.6 block v1.0
```

## Do Not Do Early

Before v0.1 is complete, do not implement real providers, API, UI, streaming, database, auth, or SDK.

Before v0.2 is complete, do not build API around real providers as if provider contracts were already proven.

Before v0.3 is complete, do not make the example app depend on core internals.
