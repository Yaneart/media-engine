# Media Engine Architecture

## Core Idea

```txt
Application -> MediaEngine -> Providers -> External Sources
```

Applications call `MediaEngine`. The engine validates the query, selects providers, executes provider calls, collects results, merges data, and returns a normalized response.

## Layers

```txt
apps/
  api/
  example/

packages/
  core/
  providers/
  plugins/
  sdk/

docs/
```

## Dependency Rules

Allowed:

```txt
apps/api -> packages/core
apps/api -> packages/providers
apps/example -> HTTP API or packages/sdk
packages/providers -> packages/core
packages/sdk -> API contracts
```

Forbidden:

```txt
packages/core -> packages/providers
packages/core -> NestJS
packages/core -> React
packages/providers -> apps/api
apps/example -> provider packages directly
```

Core defines contracts. Providers implement contracts. Apps compose them.

## Core Package

Package: `@media-engine/core`

Responsibilities:

- `MediaEngine`;
- core types;
- provider contracts;
- provider registry;
- search/details orchestration;
- merge strategy;
- cache interfaces;
- error model;
- testing utilities.

It must not:

- read environment variables;
- import concrete providers;
- use NestJS decorators;
- perform provider-specific HTTP requests;
- contain UI code.

Suggested structure:

```txt
packages/core/src/
  engine/
  providers/
  search/
  details/
  media/
  merge/
  errors/
  cache/
  testing/
  index.ts
```

## Providers Package

Package: `@media-engine/providers`

Responsibilities:

- real provider factories;
- external HTTP clients;
- response mappers;
- provider-specific errors;
- provider capabilities.

Suggested structure:

```txt
packages/providers/src/
  tmdb/
  shikimori/
  shared/
  index.ts
```

## NestJS API

Path: `apps/api`

Responsibilities:

- HTTP endpoints;
- DTO validation;
- provider configuration;
- Swagger/OpenAPI;
- rate limiting;
- server cache;
- health checks.

API must not implement merge logic or provider-specific clients.

## Search Flow

```txt
MediaEngine.search(query)
  -> validate SearchQuery
  -> select providers by capabilities
  -> run provider.search(query)
  -> collect successes and failures
  -> merge provider results
  -> sort by score
  -> return SearchResponse
```

One provider failure must not fail the whole request if other providers returned useful results.

## Details Flow

```txt
MediaEngine.getDetails(query)
  -> validate DetailsQuery
  -> select providers by capabilities
  -> run provider.getDetails(query)
  -> collect successes and failures
  -> merge details
  -> return DetailsResponse
```

## Provider Capabilities

Providers declare what they can do:

```ts
const capabilities = {
  mediaTypes: ["movie", "series"],
  search: {
    byTitle: true,
    byExternalIds: ["tmdb", "imdb"],
  },
  details: {
    byExternalIds: ["tmdb", "imdb"],
  },
};
```

The engine uses capabilities to avoid useless provider calls.

## Merge Strategy

Initial merge priority:

```txt
1. exact external IDs
2. exact title + year + type
3. normalized title + year + type
4. provider confidence
```

Advanced fuzzy matching is delayed.

## Error Handling

Engine errors are predictable. Provider errors are collected in response metadata when possible.

Base error codes:

```ts
type ErrorCode =
  | "INVALID_QUERY"
  | "NO_PROVIDER_AVAILABLE"
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAUTHORIZED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN_ERROR";
```

## Cache

Core supports an optional cache interface and a simple memory implementation in early versions.

External cache systems such as Redis are delayed.

## Testing Strategy

Core tests use mock providers and deterministic fixtures.

Provider tests use mapper tests and mock HTTP by default.

Live API tests are optional and disabled in CI.
