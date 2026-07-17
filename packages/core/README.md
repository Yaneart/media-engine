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

The engine also has `getAvailability()` for optional streaming providers.

## What comes from core

- `MediaEngine`;
- search, details, media, and streaming types;
- metadata and streaming provider contracts;
- merge and cache interfaces;
- `MemoryCache`;
- normalized errors and provider failure metadata;
- mock providers and fixtures for tests.

Provider calls run concurrently. If one source fails and another succeeds, the response keeps the useful data and lists the failure in `meta.providers.failed`.

`MemoryCache` can retain metadata for a separate bounded stale window. `MediaEngine` uses it only for search and details when every selected provider fails retryably; stale streaming links are never returned. Such responses set `meta.cached` and `meta.stale` to `true`.

The constructor also accepts streaming providers, a cache, global and per-provider timeouts, a custom merge strategy, and debug mode. Provider calls are bounded to two concurrent operations per provider by default, with a cancellable queue of 100; `providerConcurrency` can tune per-provider limits or disable the gate. Queue waiting remains inside the existing provider timeout. Core never imports concrete provider packages itself.

Exact types are available from the package exports. The short [public API guide](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) explains the three main operations without repeating every field.

## License

MIT
