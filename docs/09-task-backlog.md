# Media Engine Task Backlog

## Rules

Tasks are executed in order. Do not jump to API, UI, or real providers before core foundation is complete.

Each task has:

- goal;
- allowed changes;
- not allowed;
- done when;
- checks.

## Phase 0

### TASK-000: Approve Project Design Documents

Goal: finalize design documents before implementation.

Allowed changes:

- `README.md`;
- `docs/00-project-charter.md`;
- `docs/01-product-scope.md`;
- `docs/02-architecture.md`;
- `docs/03-public-api.md`;
- `docs/04-data-model.md`;
- `docs/05-provider-system.md`;
- `docs/06-merge-strategy.md`;
- `docs/07-repository-structure.md`;
- `docs/08-roadmap.md`;
- `docs/09-task-backlog.md`;
- `docs/10-execution-rules.md`.

Not allowed:

- create packages;
- implement core;
- add providers;
- create API;
- create UI.

Done when:

- documents are reviewed;
- key decisions are accepted;
- implementation start is explicitly approved.

## v0.1 Core Foundation

### TASK-001: Initialize pnpm Monorepo

Goal: create basic monorepo skeleton.

Allowed changes:

- root `package.json`;
- `pnpm-workspace.yaml`;
- `tsconfig.base.json`;
- lint/format config;
- test config;
- `packages/core/package.json`;
- `packages/core/tsconfig.json`;
- `packages/core/src/index.ts`.

Not allowed:

- implement `MediaEngine`;
- add real providers;
- create API;
- create UI.

Done when:

- workspace exists;
- empty core package builds;
- root scripts exist.

Checks:

```bash
pnpm install
pnpm build
pnpm typecheck
```

### TASK-002: Add Core Media Data Types

Goal: add data model types.

Allowed changes:

- `packages/core/src/media/*`;
- `packages/core/src/index.ts`;
- media type tests.

Types:

- `MediaType`;
- `ExternalIds`;
- `Image`;
- `ImageType`;
- `Rating`;
- `RatingSource`;
- `Genre`;
- `Person`;
- `PersonExternalIds`;
- `MediaPerson`;
- `PersonRole`;
- `Season`;
- `Episode`;
- `MediaStatus`;
- `MediaItem`;
- `MediaDetails`;
- `MovieDetails`;
- `SeriesDetails`;
- `AnimeDetails`.

Done when types compile and are exported.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-003: Add Query and Response Types

Goal: add search/details public API types.

Allowed changes:

- `packages/core/src/search/*`;
- `packages/core/src/details/*`;
- `packages/core/src/response/*`;
- `packages/core/src/index.ts`.

Types:

- `SearchQuery`;
- `SearchResponse`;
- `MediaSearchResult`;
- `DetailsQuery`;
- `DetailsResponse`;
- `ResponseMeta`;
- `ProviderExecutionMeta`;
- `ProviderFailure`;
- `EngineWarning`.

Required behavior:

- include public external ID shortcuts on `SearchQuery` and `DetailsQuery`;
- keep provider-facing queries normalized through `ids`;
- export all public query and response types.

Done when:

- query and response types compile;
- public API examples from `docs/03-public-api.md` typecheck;
- no provider execution code is added.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-004: Add Provider Contract Types

Goal: add metadata provider contract.

Allowed changes:

- `packages/core/src/providers/*`;
- `packages/core/src/errors/*`;
- `packages/core/src/index.ts`.

Types:

- `MediaProvider`;
- `ProviderCapabilities`;
- `ProviderContext`;
- `ProviderSearchQuery`;
- `ProviderDetailsQuery`;
- `ProviderSearchResult`;
- `ProviderDetailsResult`;
- `ProviderSource`;
- `ProviderInfo`;
- `ProviderError`;
- `ProviderErrorCode`.

Required behavior:

- define `ProviderInfo`;
- keep provider raw responses out of public API types except optional debug/test fields;
- keep concrete provider imports out of core.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-005: Implement ProviderRegistry

Goal: implement provider registration and selection.

Required behavior:

- register providers;
- reject duplicate names;
- return provider info;
- select providers by title support;
- select providers by external IDs;
- respect media type capabilities;
- select details providers.

Done when:

- duplicate provider names are rejected;
- provider selection is covered by unit tests;
- `getProviders()` can return safe `ProviderInfo` objects without secrets.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-006: Add Engine Error Model

Goal: implement engine errors and provider failure normalization.

Required behavior:

- `MediaEngineError`;
- `ErrorCode`;
- unknown error mapping;
- provider errors converted to `ProviderFailure`.

Done when:

- invalid user queries throw `MediaEngineError`;
- unknown thrown values are mapped predictably;
- provider errors preserve provider name, code, retryable flag, and message.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-007: Implement DefaultMergeStrategy for Search

Goal: implement search result merge.

Required behavior:

- group by exact external IDs;
- fallback group by normalized title + year + type;
- merge IDs, ratings, genres, alternative titles;
- choose title, poster, description;
- calculate score;
- sort by score;
- warn on ID conflicts.

Not allowed:

- fuzzy matching;
- HTTP calls;
- provider-specific imports.

Done when:

- exact external ID matches merge into one result;
- conflicting strong IDs do not silently overwrite each other;
- weak title matches are not auto-merged;
- output order is deterministic.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-008: Implement DefaultMergeStrategy for Details

Goal: implement details merge.

Required behavior:

- return `null` for no results;
- choose primary result by provider priority;
- merge IDs, ratings, genres, images;
- keep persons/seasons/episodes from primary result;
- warn on conflicts.

Done when:

- no results returns `null`;
- primary provider selection follows provider priority;
- persons/seasons/episodes are not merged unsafely;
- conflicts create warnings.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-009: Implement Cache Interface and Memory Cache

Goal: add optional cache layer.

Types:

- `Cache`;
- `MemoryCache`.

Required behavior:

- `get`;
- `set`;
- `delete`;
- `clear`;
- TTL support.

Done when:

- expired entries are not returned;
- `delete` removes one key;
- `clear` removes all keys;
- cache works with sync or async engine usage.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-010: Implement MediaEngine Constructor and getProviders

Goal: create engine class and provider registration.

Required behavior:

- accepts `MediaEngineOptions`;
- creates registry;
- accepts cache and merge strategy;
- accepts timeout;
- `getProviders()` returns `ProviderInfo[]`.

Done when:

- engine can be constructed with no providers;
- engine can be constructed with mock providers;
- custom cache and merge strategy can be passed;
- returned provider info contains no secrets.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-011: Implement MediaEngine.search

Goal: implement main search flow.

Required behavior:

- validate query;
- normalize top-level external ID shortcuts into `ids`;
- select providers;
- call `provider.search`;
- support timeout/cancel;
- collect successful and failed providers;
- tolerate partial provider failure;
- merge results;
- return `SearchResponse`;
- fill `meta.tookMs` and `meta.providers`.

Done when:

- empty/invalid query behavior matches public API docs;
- one provider failure does not fail the whole search if another provider succeeds;
- all-provider failure is predictable;
- cache integration does not change response shape.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-012: Implement MediaEngine.getDetails

Goal: implement details flow.

Required behavior:

- validate query;
- normalize top-level external ID shortcuts into `ids`;
- select detail providers;
- call only providers with `getDetails`;
- tolerate partial failure;
- merge details;
- return `DetailsResponse`.

Done when:

- details query validation matches public API docs;
- providers without `getDetails` are skipped;
- partial provider failure is represented in metadata;
- no details results return `details: null`.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-013: Add Core Testing Utilities

Goal: add mock providers and fixtures.

Required utilities:

- `createMockProvider`;
- success provider;
- failing provider;
- timeout provider;
- sample movie;
- sample series;
- sample anime.

Done when:

- tests can create deterministic providers without real HTTP;
- timeout and failure scenarios are easy to reuse;
- fixtures cover movie, series, and anime basics.

Checks:

```bash
pnpm typecheck
pnpm test
```

### TASK-014: Add Core README and Examples

Goal: document v0.1 core usage.

Required content:

- basic usage;
- usage with mock provider;
- provider contract overview;
- search response example;
- details response example.

Done when:

- README examples match actual exported API;
- examples use mock providers, not real API keys;
- docs explain the provider contract at a high level.

### TASK-015: v0.1 Audit

Goal: verify core foundation.

Done when:

- all v0.1 tasks are complete;
- build/test/typecheck pass;
- public API matches docs;
- no blocking architecture mismatch remains.

Checks:

```bash
pnpm build
pnpm test
pnpm typecheck
```

## v0.2 Metadata Providers

### TASK-020: Initialize Providers Package

Create `@media-engine/providers` after `TASK-015`.

### TASK-021: Add Shared Provider HTTP Utilities

Add timeout, JSON parsing, and provider error mapping helpers outside core.

### TASK-022: Implement TMDB Provider

Add TMDB search/details, mappers, and tests with mock HTTP.

### TASK-023: Implement Shikimori Provider

Add Shikimori anime search/details, mappers, and tests with mock HTTP.

### TASK-024: v0.2 Audit

Verify provider package and confirm core still does not import concrete providers.

Done when:

- providers package exports shared utilities, TMDB, and Shikimori;
- TMDB and Shikimori tests pass with mock HTTP;
- root checks pass;
- documentation reflects the current v0.2 provider state;
- core has no imports from `@media-engine/providers`.

### TASK-025: Plan Additional Metadata Providers

Goal: plan IMDb, Kinopoisk, and AniList after TMDB/Shikimori prove the provider contract.

Allowed changes:

- provider docs;
- roadmap;
- task backlog.

Not allowed:

- implement these providers before the plan is accepted.

Plan:

- AniList should be the first additional provider candidate because it has a public GraphQL API and maps naturally to the existing anime model.
- IMDb should be treated as a licensed metadata integration or non-commercial dataset integration. Do not scrape IMDb pages.
- Kinopoisk should be implemented only after choosing an allowed documented API source and recording its terms/risks.
- Additional metadata providers are useful, but they are not required before `TASK-030`.

Acceptance criteria:

- provider docs describe source rules and intended capabilities for IMDb, Kinopoisk, and AniList;
- roadmap states whether additional providers block v0.3;
- backlog records that implementation is not allowed until a provider-specific task is approved.

Future provider-specific tasks should be created only after this plan is accepted:

- research and choose an AniList GraphQL query set;
- research IMDb licensed API or non-commercial dataset approach;
- research an allowed Kinopoisk-compatible API;
- implement each provider with mock HTTP/GraphQL tests before any live API integration.

## v0.3 NestJS API

### TASK-030: Initialize NestJS API App

Create `apps/api` after `TASK-024`.

### TASK-031: Add MediaEngine Module Configuration

Create engine through NestJS DI and configure providers from env.

### TASK-032: Add Media Search Endpoint

Add `GET /media/search`.

### TASK-033: Add Details and Providers Endpoints

Add `GET /media/details` and `GET /providers`.

### TASK-034: Add Swagger and API Tests

Add OpenAPI docs and e2e tests.

## v0.4 React Example App

### TASK-040: Initialize React Example App

Create `apps/example` after `TASK-034`.

### TASK-041: Add Search UI

Add input, API call, loading, error, and empty states.

### TASK-042: Add Results and Details UI

Show poster, title, year, ratings, genres, IDs, and details.

## v0.5 Streaming Architecture

### TASK-050: Design Streaming Data Model

Describe availability, streams, translations, subtitles, qualities, episode sources, player sources, and UI player-selection needs.

### TASK-051: Add StreamingProvider Contract

Add streaming provider contract after metadata architecture is stable. It must support returning multiple normalized player/stream options for the same media or episode.

### TASK-052: Add Experimental Streaming Provider

Validate streaming architecture with one source, such as Kodik if it can be used through an allowed API/embed flow. The result should prove the future UI can show a video window with a player selector.

## v0.6 SDK

### TASK-060: Initialize SDK Package

Create `@media-engine/sdk` after `TASK-034`.

Required behavior:

- package builds independently;
- exports `MediaEngineClient`;
- no React or NestJS dependency.

### TASK-061: Add SDK Search and Details Methods

Add typed client methods for:

- search;
- details;
- providers;
- health check.

### TASK-062: Add SDK Error Handling and Tests

Add typed API errors, response parsing, and tests.

### TASK-063: Integrate SDK into Example App

Replace direct API request helpers in the example app with SDK calls after SDK is stable.

## v1.0 Stabilization

### TASK-100: Public API Audit

Review stable public API and breaking changes.

### TASK-101: Documentation Audit

Update README and docs before release.

### TASK-102: Release Preparation

Prepare npm packages and release workflow.
