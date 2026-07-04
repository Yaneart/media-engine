# Media Engine Project Charter

## Purpose

Media Engine is an open source TypeScript engine for working with movies, series, and anime through a single programmable interface.

The project hides differences between external sources and gives developers one API for search, metadata, external ID mapping, provider aggregation, and normalized results.

Target usage:

```ts
const media = new MediaEngine({
  providers: [
    tmdbProvider({ apiKey: process.env.TMDB_API_READ_ACCESS_TOKEN ?? "" }),
    shikimoriProvider(),
  ],
});

const result = await media.search({
  title: "Interstellar",
});
```

Search by external IDs should also be ergonomic:

```ts
const result = await media.search({
  imdb: "tt0816692",
});
```

Internally, the engine normalizes those shortcut fields into `ExternalIds`.

## Product Goal

Build a modern, modular, strongly typed engine that can be used from:

- Node.js applications;
- NestJS and Express APIs;
- Telegram and Discord bots;
- CLI tools;
- React or Next.js applications through an API or SDK.

Media Engine is engine-first. It is not a movie website, video host, frontend framework, torrent client, or media player.

## Products

### Media Engine Core

`@media-engine/core` is a framework-independent TypeScript package.

It owns:

- public library API;
- core data model;
- provider contracts;
- provider registry;
- search and details orchestration;
- result normalization boundaries;
- merge strategy;
- error model;
- optional cache interfaces.

It must not depend on NestJS, React, Express, or concrete providers.

### Media Engine Providers

`@media-engine/providers` contains real provider implementations.

Initial metadata providers:

- TMDB;
- Shikimori.

Later metadata providers:

- IMDb;
- Kinopoisk;
- MyAnimeList;
- AniList.

Later streaming providers:

- Kodik;
- Collaps;
- VideoCDN;
- Lumex.

Future streaming goal: Media Engine should not make users design video lookup from scratch. After metadata is stable, the engine should provide a separate streaming layer that returns normalized stream/player options for a media item or episode. Applications should be able to show a video window with a player selector, for example Kodik and later alternative players, while the frontend remains responsible for rendering iframe/video UI.

### Media Engine API

`apps/api` is a NestJS REST API over `@media-engine/core`.

It owns:

- HTTP endpoints;
- DTO validation;
- OpenAPI/Swagger;
- provider configuration from environment;
- health checks.

Server cache and rate limiting are future API hardening work.

### Example React App

`apps/example` demonstrates engine usage through the API.

It owns:

- search UI;
- result list;
- details view;
- loading, empty, and error states.

It must not import providers directly or contain provider API keys.

## Core Principle

The developer works with Media Engine, not with every provider separately.

Instead of:

```ts
const tmdb = await tmdbClient.search("Interstellar");
const imdb = await imdbClient.findById("tt0816692");
const merged = mergeManually(tmdb, imdb);
```

The user writes:

```ts
const result = await media.search({
  title: "Interstellar",
});
```

Media Engine decides which providers to call, how to normalize data, how to match external IDs, and how to merge results.

## Development Principle

The project is developed documentation-first:

```txt
Documentation
Architecture
Roadmap
Tasks
Code
Tests
Documentation update
```

Production code starts only after the architecture, API, data model, provider contract, roadmap, task backlog, and execution rules are agreed.

## Learning-Oriented Workflow

This project is also used for learning.

When implementation starts, Codex should default to explaining the purpose of each file, type, and function before showing code. Direct file edits are not the default for code tasks; the user usually wants to type the code manually after understanding it.

Codex may edit files directly only when the user explicitly asks for implementation edits.
