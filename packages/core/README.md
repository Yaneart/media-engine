# @media-engine/core

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/core/README.ru.md)

This is the part of Media Engine that does the thinking: it chooses providers, runs them, merges their answers, caches results, and turns failures into a predictable shape.

It does not contain any real data sources. For those, install `@media-engine/providers` too.

## Install

```bash
npm install @media-engine/core @media-engine/providers
```

## Basic use

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider, kinobdProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), cinemetaProvider()],
});

const search = await media.search({ title: "Interstellar" });
const details = await media.getDetails({ imdb: "tt0816692" });

console.log(search.results[0]?.item);
console.log(details.details);
```

Details lookup requires a namespaced external ID through `ids` or a shortcut such as `imdb`. The plain `id` field is deprecated because provider-native IDs are not globally unique.

The engine also has `getAvailability()` for optional streaming providers.

## What comes from core

- `MediaEngine`;
- search, details, media, and streaming types;
- metadata and streaming provider contracts;
- merge and cache interfaces;
- `MemoryCache`;
- normalized errors and provider failure metadata;
- mock providers and fixtures for tests.

Provider calls run concurrently. If one source fails and another succeeds, the response keeps the useful data and lists the failure in `meta.providers.failed`. Search failures and debug timings include an optional execution `phase`; repeated failures from one provider are represented once in the public failure list. Mandatory retryable primary/fallback degradation is not stored in the normal cache.

Title search distinguishes primary discovery from slower fallback identity sources through optional `capabilities.search.titleDiscovery`. Custom providers are primary by default. Supported multi-word typos are broadened through primary providers when no exact title exists, even if weak fuzzy noise is present. Fallback providers run when the remaining result is empty, a multi-word query has no exact identity, or exact-title identities conflict. External-ID search still calls every compatible provider immediately.

With a cache configured, the first healthy mandatory discovery whose top candidate has a strong external ID stores a separate identity snapshot for 30 minutes without refreshing it inside that window. Equivalent cache misses with another `limit` share up to 20 confirmed candidates and retain their known order even when a successful upstream response drifts. Stabilization adds `SEARCH_IDENTITY_SNAPSHOT_STABILIZED`. A retryably degraded partial search uses `SEARCH_IDENTITY_SNAPSHOT_FALLBACK` while retaining `meta.providers.failed`, `meta.cached: false`, and the no-cache policy. Neither path accepts conflicting strong IDs; non-retryable degradation does not use the snapshot, and a weak top candidate without a strong ID cannot establish one. Debug mode exposes restored/reordered counters. A first cold degraded request has no snapshot to recover from.

Providers can separately set `capabilities.searchEnrichment: false` to stay out of best-effort search-card ID/poster work. This keeps short optional enrichment deadlines from consuming the reliability budget of a mandatory fallback identity source.

Optional search ID/poster enrichment failures do not discard the base results. They produce bounded `meta.warnings`, remain cacheable with those warnings, and expose attempted/skipped/succeeded/failed counters plus phase-aware timings when debug mode is enabled. One planner limits enrichment to the bounded top discovery window, at most six additional calls, at most two calls per provider, and 1.5 seconds total. It skips providers that cannot improve a missing field and reuses matching ID-search plus cached or in-flight details outcomes for poster selection.

Mandatory discovery and eligible snapshot recovery freeze result identity, score, and order before optional enrichment. Matching enrichment may add presentation fields, non-conflicting external IDs, and source attribution, including aliases that make an unresolved candidate relevant. It never adds provider candidates as new results, changes `id`, `type`, `title`, `originalTitle`, or `year`, recalculates a score, or reranks the response. Conflicting added IDs retain the discovery value and emit `EXTERNAL_ID_CONFLICT`.

Mandatory ranking favors close multi-word title completions and external IDs that support reliable cross-catalog follow-up. Popular anime catalog identities remain competitive when their audience is established; small audience counters and ratings without vote counts do not receive full ranking weight.

The built-in strategy keeps the first result and every score unchanged, but may interleave a similarly ranked candidate inside the top ten after two results from the same normalized matched-title/media-type family. The alternative must be within `0.03` score and `0.05` title relevance, so weak noise is not promoted merely for variety. Debug mode adds optional per-result `ranking` evidence with the formula, match/title evidence, weighted signal contributions, and raw-score/diversity/final positions; normal responses omit it.

`MemoryCache` can retain metadata for a separate bounded stale window. `MediaEngine` uses it only for search and details when every selected provider fails retryably; stale streaming links are never returned. Such responses set `meta.cached` and `meta.stale` to `true`.

Public search, details, and availability inputs are canonicalized before provider selection and cache/coalescing keys are built: strings and IDs are trimmed, language is lowercased, top-level ID shortcuts become `ids`, and streaming provider filters are trimmed, deduplicated, and sorted. Known IMDb/numeric ID formats and bounded field lengths are validated. A search with `limit: 0` returns an empty uncached response without provider or cache work.

`MemoryCache` accepts only non-negative safe-integer TTL values. Omit `defaultTtlMs` and per-entry `ttlMs` for entries without expiration; negative values are not a no-expiry sentinel. Stale TTL values follow the same numeric validation.

`search`, `getDetails`, and `getAvailability` accept optional `{ signal }` operation options. Identical requests still share one provider operation, but each caller has an independent subscription: aborting one caller does not affect the others, while the shared provider signal is aborted once no active subscribers remain. Fully cancelled work is not cached, and client cancellation is not counted as an upstream circuit-breaker failure.

A streaming provider that resolves `null` is recorded as a successful no-result lookup. The engine reports an all-failed error only when every selected streaming provider actually failed. Discovered player options with an uncertain validation result remain visible with `availability: "unknown"`; the response includes `STREAM_VALIDATION_DEGRADED` and is retried instead of being stored in the normal availability cache.

The constructor also accepts streaming providers, a cache, global and per-provider timeouts, a custom merge strategy, and debug mode. Provider calls are bounded to two concurrent operations per provider by default, with a cancellable queue of 100; `providerConcurrency` can tune per-provider limits or disable the gate. Queue waiting remains inside the existing provider timeout. Core never imports concrete provider packages itself.

Exact types are available from the package exports. The short [public API guide](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) explains the three main operations without repeating every field.

## License

MIT
