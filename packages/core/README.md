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

Optional search ID/poster enrichment failures do not discard the base results. They produce bounded `meta.warnings`, remain cacheable with those warnings, and expose attempted/skipped/succeeded/failed counters plus phase-aware timings when debug mode is enabled.

`MemoryCache` can retain metadata for a separate bounded stale window. `MediaEngine` uses it only for search and details when every selected provider fails retryably; stale streaming links are never returned. Such responses set `meta.cached` and `meta.stale` to `true`.

A streaming provider that resolves `null` is recorded as a successful no-result lookup. The engine reports an all-failed error only when every selected streaming provider actually failed. Discovered player options with an uncertain validation result remain visible with `availability: "unknown"`; the response includes `STREAM_VALIDATION_DEGRADED` and is retried instead of being stored in the normal availability cache.

The constructor also accepts streaming providers, a cache, global and per-provider timeouts, a custom merge strategy, and debug mode. Provider calls are bounded to two concurrent operations per provider by default, with a cancellable queue of 100; `providerConcurrency` can tune per-provider limits or disable the gate. Queue waiting remains inside the existing provider timeout. Core never imports concrete provider packages itself.

Exact types are available from the package exports. The short [public API guide](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) explains the three main operations without repeating every field.

## License

MIT
