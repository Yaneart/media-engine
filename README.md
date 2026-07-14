# Media Engine

Media Engine is an open source TypeScript engine for searching, aggregating, normalizing, and merging media metadata from multiple sources through one API.

It is not a website. It is a reusable engine that can be used from Node.js applications, APIs, bots, CLI tools, and client applications through an API or SDK.

## Project Status

Current phase: **v0.1 pre-release**.

The core engine, metadata providers, streaming availability API, REST API, SDK, React example, smoke checks, and package dry-run checks are implemented. Version `0.1.0` is the first package pre-release candidate; live no-token providers remain best-effort integrations.

## Core Idea

Developers should work with Media Engine, not with every provider separately.

Instead of manually integrating IMDb, Kinopoisk, Shikimori, Kodik, Collaps, VideoCDN, and other sources, a developer calls one typed API:

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

## Metadata Quickstart

Use only `providers` when player discovery is not needed:

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  wikidataProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({ userAgent: "MyApp/0.1.0" }),
    aniListProvider(),
    wikidataProvider(),
  ],
});

const result = await media.search({ title: "Interstellar", type: "movie" });
console.log(result.results[0]?.item);
```

## Metadata and Streaming Quickstart

```ts
import { MediaEngine } from "@media-engine/core";
import {
  cinemetaProvider,
  flixHqStreamingProvider,
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
  streamingProviders: [kinobdStreamingProvider(), flixHqStreamingProvider()],
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

## API Server Quickstart

Run the included NestJS API and React example locally:

```bash
pnpm install
pnpm dev:compose
```

The API is available at `http://127.0.0.1:3000`, with Swagger at `http://127.0.0.1:3000/docs`.

## SDK Client Quickstart

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const client = new MediaEngineClient({ baseUrl: "http://127.0.0.1:3000" });
const result = await client.search({ title: "Interstellar", type: "movie" });
console.log(result.results[0]?.item);
```

## Release Checks

Useful release gates:

```bash
pnpm release:check
pnpm smoke:providers -- --strict
pnpm smoke:search-quality
pnpm smoke:latency
pnpm smoke:details-latency
pnpm smoke:availability-latency
pnpm smoke:availability -- --strict
pnpm pack:check
```

Live smoke commands call third-party providers and can fail when an upstream source is rate-limited or temporarily unavailable. `pnpm smoke:search-quality` checks canonical result rank and enrichment for broad queries. `pnpm smoke:latency` prints per-provider search timings for broad-query debugging. `pnpm smoke:details-latency` does the same for details lookups. `pnpm smoke:availability-latency` does the same for player/video availability.

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

Current technical documents:

```txt
docs/README.md
docs/architecture.md
docs/public-api.md
docs/data-model.md
docs/providers.md
docs/roadmap.md
```

## Development Rules

- Documentation comes before code.
- Only one task is active at a time.
- Public API changes must be reflected in `docs/public-api.md`.
- Data model changes must be reflected in `docs/data-model.md`.
- Provider contract changes must be reflected in `docs/providers.md`.
- Architecture changes must be reflected in `docs/architecture.md`.
- Core must not import concrete providers.

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
