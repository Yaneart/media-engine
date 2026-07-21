# Architecture

Media Engine is a TypeScript monorepo that separates orchestration, external data sources, HTTP delivery, and UI concerns.

## Packages and applications

```text
@media-engine/core
        ↑
@media-engine/providers

@media-engine/core
        ↑
apps/api ← @media-engine/sdk ← apps/example
```

### `@media-engine/core`

The core package owns:

- normalized media and streaming types;
- metadata and streaming provider contracts;
- provider selection and concurrent execution;
- search, details, and availability orchestration;
- merging, warnings, errors, timeouts, and optional caching.

Core does not import concrete providers, NestJS, React, or environment configuration.

### `@media-engine/providers`

The providers package implements adapters for public upstream services and local datasets. Every provider maps upstream data into core types and reports failures through the shared error model.

Provider factories are configured by the application. Built-in defaults do not require user API keys, private account tokens, or cookies.

### `@media-engine/sdk`

The SDK is a small typed HTTP client for the API. It works with browser or Node.js `fetch` and preserves HTTP status and response bodies in typed errors.

### `apps/api`

The NestJS application wires providers into `MediaEngine` and exposes health, provider, search, details, and availability endpoints. It owns HTTP validation and OpenAPI documentation, but not merge logic or provider HTTP clients.

### `apps/example`

The React application demonstrates search, details, episode selection, and player choice through the API. It does not call upstream providers directly.

## Request flow

Details requests follow this broad path:

1. normalize and validate the query;
2. select providers by declared capabilities;
3. call independent providers concurrently with bounded timeouts;
4. keep successful results when only some providers fail;
5. merge compatible results deterministically;
6. return provider attribution, warnings, cache state, and elapsed time.

Search adds an explicit discovery pipeline before merging:

1. run `primary` title-discovery providers concurrently;
2. if no relevant candidate exists, broaden a supported typo or joined-title query through the same primary providers;
3. run `fallback` title-discovery providers only when the primary candidates remain empty or contain multiple conflicting exact-title identities;
4. merge candidates, then execute bounded ID/details/poster enrichment.

External-ID search is not tiered: every compatible provider remains eligible immediately. A custom metadata provider defaults to primary title discovery unless it opts into `capabilities.search.titleDiscovery: "fallback"`.

Optional search-card enrichment is a separate role. Providers participate by default but can set `capabilities.searchEnrichment: false`; built-in Wikidata does so because its slower identity lookup must not consume circuit and timeout capacity during best-effort poster enrichment.

Availability is separate from metadata. Streaming providers receive a normalized media or episode identity and return selectable player or stream options.

## Identity and merging

Strong external IDs such as IMDb, Kinopoisk, Shikimori, MyAnimeList, and AniList are preferred when grouping results. Exact title, year, and compatible media type provide a secondary match.

Results with conflicting strong identities are not silently combined. When at least one strong ID agrees, compatible metadata may still be merged and secondary conflicts are reported as warnings.

Search ranking combines title relevance, provider confidence, source authority, ratings, popularity, and metadata completeness. Ordering remains deterministic even though providers run concurrently.

## Reliability boundaries

- Provider timeouts and abort signals bound slow upstream calls.
- Partial provider failures are returned in response metadata.
- Slower fallback identity sources stay off the healthy primary title-search path.
- Public query limits and provider fan-out are bounded.
- The in-memory cache isolates stored values from caller mutation.
- Availability cache lifetimes respect expiring direct links.
- Upstream-discovered URLs are checked before server-side fetching or public exposure.
- Live providers remain best-effort because upstream sites can change or become unavailable.

## Repository layout

```text
packages/core       framework-independent engine
packages/providers  metadata and streaming adapters
packages/sdk        typed HTTP client
apps/api            NestJS API
apps/example        React example
scripts             live quality and latency checks
docs                current technical documentation
```

The workspace uses pnpm, strict TypeScript, ESM output, Prettier, focused package tests, and root release checks.
