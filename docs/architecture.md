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
2. if no exact candidate exists, broaden a supported typo or joined-title query through the same primary providers even when weak fuzzy noise is present;
3. run `fallback` title-discovery providers when primary candidates remain empty, a multi-word query has no exact identity, or multiple conflicting exact-title identities remain;
4. merge mandatory candidates and freeze their identities, scores, and order, applying a prior identity snapshot when eligible;
5. execute bounded ID/details/poster enrichment against the frozen candidates and remove any candidate that remains textually unrelated without reranking;
6. after healthy mandatory discovery, retain the visible frozen identities independently of the full response cache.

External-ID search is not tiered: every compatible provider remains eligible immediately. A custom metadata provider defaults to primary title discovery unless it opts into `capabilities.search.titleDiscovery: "fallback"`.

Optional search-card enrichment is a separate role. Providers participate by default but can set `capabilities.searchEnrichment: false`; built-in Wikidata does so because its slower identity lookup must not consume circuit and timeout capacity during best-effort poster enrichment.

Optional enrichment never joins its provider results back into mandatory discovery. It can add alternative titles, descriptions, artwork, genres, ratings, non-conflicting external IDs, and source attribution to a matching frozen candidate. It cannot add a new result, replace `id`, `type`, `title`, `originalTitle`, or `year`, change the discovery score, or reorder candidates. An added alias may make a previously unresolved discovery candidate textually relevant, but that candidate keeps its frozen relative position. Conflicting secondary IDs retain the discovery value and produce a warning.

For the next 30 minutes, equivalent cache misses use the first healthy identity snapshot whose top candidate has a strong external ID to keep confirmed candidates and ordering stable even if a successful upstream response drifts. The snapshot is not refreshed inside that window. It ignores the public `limit`, keeps at most 20 candidates, never replaces a current candidate with conflicting strong IDs, and does not mark the response as cached. Retryably degraded partial searches can use the same recovery while retaining current provider failures; non-retryable degradation does not. A cold request without a prior confirmed snapshot remains dependent on the currently available identity sources, and a weak top candidate without a strong ID is never promoted into the snapshot.

Availability is separate from metadata. Streaming providers receive a normalized media or episode identity and return selectable player or stream options.

## Identity and merging

Strong external IDs such as IMDb, Kinopoisk, Shikimori, MyAnimeList, and AniList are preferred when grouping results. Exact title, year, and compatible media type provide a secondary match.

Results with conflicting strong identities are not silently combined. When at least one strong ID agrees, compatible metadata may still be merged and secondary conflicts are reported as warnings.

Mandatory search ranking combines title relevance, provider confidence, source authority, audience-backed ratings, follow-up external-ID quality, and metadata completeness. Partial and fuzzy matches prefer the closest token-length completion. Small catalog audience counts and ratings without vote counts receive bounded trust, while broadly resolvable IMDb/Kinopoisk identities and well-established anime catalog identities remain comparable. The result order remains deterministic even though providers run concurrently, and later optional enrichment cannot recalculate it.

## Reliability boundaries

- Provider timeouts and abort signals bound slow upstream calls.
- Partial provider failures are returned in response metadata.
- Slower fallback identity sources stay off the healthy primary title-search path.
- Retryably degraded partial searches can recover prior confirmed identity order without caching the degraded response.
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
