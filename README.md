# Media Engine

Media Engine is an open source TypeScript engine for searching, aggregating, normalizing, and merging media metadata from multiple sources through one API.

It is not a website. It is a reusable engine that can be used from Node.js applications, APIs, bots, CLI tools, and client applications through an API or SDK.

## Project Status

Current phase: **v1.0 stabilization**.

The core engine, metadata providers, streaming availability API, REST API, SDK, React example, smoke checks, and package dry-run checks are implemented. The remaining work before a public release is documentation, final audit, versioning, and changelog polish.

## Core Idea

Developers should work with Media Engine, not with every provider separately.

Instead of manually integrating TMDB, IMDb, Kinopoisk, Shikimori, Kodik, Collaps, VideoCDN, and other services, a developer calls one typed API:

```ts
const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    wikidataProvider(),
  ],
});

const result = await media.search({
  title: "Interstellar",
});
```

Search by external IDs is also part of the intended public API:

```ts
const result = await media.search({
  imdb: "tt0816692",
});
```

Media Engine is responsible for:

- selecting useful providers;
- calling providers safely;
- resolving external IDs;
- normalizing provider responses;
- merging duplicated results;
- returning one strongly typed response.

## Install

For direct Node.js usage:

```bash
npm install @media-engine/core @media-engine/providers
```

For applications that call the REST API:

```bash
npm install @media-engine/sdk
```

The publishable npm packages are `packages/core`, `packages/providers`, and `packages/sdk`.
`apps/api` and `apps/example` are included in the GitHub repository as runnable integration examples, not as npm packages.

## Quickstart

```ts
import { MediaEngine } from "@media-engine/core";
import {
  cinemetaProvider,
  kinobdProvider,
  kinobdStreamingProvider,
  shikimoriProvider,
  wikidataProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent: "MyApp/1.0.0",
    }),
    wikidataProvider(),
  ],
  streamingProviders: [kinobdStreamingProvider()],
});

const search = await media.search({
  title: "Interstellar",
  type: "movie",
});

const details = await media.getDetails({
  kinopoisk: "258687",
  type: "movie",
});

const availability = await media.getAvailability({
  kinopoisk: "258687",
  type: "movie",
});
```

Streaming availability is a best-effort player discovery layer. Media Engine returns normalized embed/player options and provider failures; it is not a streaming service, does not host video, and does not extract direct video files by default.

## Release Checks

Useful release gates:

```bash
pnpm release:check
pnpm smoke:providers -- --strict
pnpm smoke:latency
pnpm smoke:availability-latency
pnpm smoke:availability -- --strict
pnpm pack:check
```

Live smoke commands call third-party providers and can fail when an upstream source is rate-limited or temporarily unavailable. `pnpm smoke:latency` prints per-provider search timings for broad-query debugging. `pnpm smoke:availability-latency` does the same for player/video availability.

## Products

The project contains three main products.

### 1. Media Engine Core

Package:

```bash
npm install @media-engine/core
```

Responsibilities:

- public TypeScript API;
- media data model;
- provider contracts;
- provider registry;
- search and details orchestration;
- merge strategy;
- error model;
- cache interfaces;
- test utilities.

Core must stay framework-independent. It must not depend on NestJS, React, Express, or concrete providers.

### 2. Media Engine API

Path:

```txt
apps/api
```

Technology: NestJS.

Responsibilities:

- REST endpoints;
- DTO validation;
- provider configuration from environment variables;
- Swagger/OpenAPI;
- health checks;

API-level cache and rate limiting are future hardening work, not part of the current release baseline.

### 3. Example React App

Path:

```txt
apps/example
```

Purpose: demonstrate how to use Media Engine through the API or SDK.

The example app must not contain provider API keys or import provider packages directly.

## Local Docker Compose

Run the API and React example app together for local development:

```bash
pnpm dev:compose
```

The command uses the local workspace dependencies mounted into the Node containers, so run `pnpm install` on the host first when dependencies are missing.

The dev stand exposes:

- API: `http://127.0.0.1:3000`
- Swagger UI: `http://127.0.0.1:3000/docs`
- React example: `http://127.0.0.1:5173`

Stop the containers:

```bash
pnpm dev:compose:down
```

## Repository Structure

```txt
media-engine/
  packages/
    core/
    providers/
    plugins/
    sdk/
  apps/
    api/
    example/
  docs/
```

The current monorepo includes `packages/core`, `packages/providers`, `packages/sdk`, `apps/api`, and `apps/example`. `packages/plugins` remains reserved for future plugin contracts.

## Version Roadmap

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

## Documentation

Current design documents:

```txt
docs/00-project-charter.md
docs/01-product-scope.md
docs/02-architecture.md
docs/03-public-api.md
docs/04-data-model.md
docs/05-provider-system.md
docs/06-merge-strategy.md
docs/07-repository-structure.md
docs/08-roadmap.md
docs/09-task-backlog.md
docs/10-execution-rules.md
docs/11-streaming-data-model.md
docs/12-public-api-audit.md
docs/13-release-preparation.md
docs/14-parser-release-hardening.md
docs/15-next-implementation-plan.md
```

## Development Rules

- Documentation comes before code.
- Work follows the task backlog in order.
- Only one task is active at a time.
- Public API changes must be reflected in `docs/03-public-api.md`.
- Data model changes must be reflected in `docs/04-data-model.md`.
- Provider contract changes must be reflected in `docs/05-provider-system.md`.
- Merge logic changes must be reflected in `docs/06-merge-strategy.md`.
- Core must not import concrete providers.
- Completed phases should remain documented before follow-up changes are added.

## Non Goals

Media Engine is not:

- a streaming service;
- a movie website;
- a frontend framework;
- a media player;
- a torrent client;
- a download manager;
- a database-first application.

## License

MIT
