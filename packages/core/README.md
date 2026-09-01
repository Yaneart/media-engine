# @media-engine/core

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/core/README.ru.md)

This is the heart of Media Engine. It calls several data sources, understands which results describe
the same title, merges their answers, and keeps one slow or broken source from ruining the whole
request.

Core does not include real data sources. The easiest way to start is to install the providers package
with it.

## Install

```bash
npm install @media-engine/core @media-engine/providers
```

Node.js 20 or newer is required.

## Basic example

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider, kinobdProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), cinemetaProvider()],
});

const result = await media.search({
  title: "Interstellar",
  language: "en",
});

console.log(result.results[0]?.item);
```

Create one `MediaEngine` instance and reuse it while your application is running.

## Main operations

```ts
await media.search({ title: "Interstellar" });
await media.getDetails({ imdb: "tt0816692" });
await media.getAvailability({
  type: "series",
  title: "Game of Thrones",
  seasonNumber: 1,
  episodeNumber: 1,
});

for await (const snapshot of media.getAvailabilityProgressively({
  type: "series",
  title: "Game of Thrones",
  seasonNumber: 1,
  episodeNumber: 1,
})) {
  renderSources(snapshot.availability?.options ?? []);
  if (snapshot.state === "complete") stopLoading();
}
await media.discoverTorrents({
  type: "movie",
  title: "Interstellar",
  ids: { imdb: "tt0816692" },
});
```

`getDetails()` needs an external ID with its namespace, such as `imdb`, `kinopoisk`, or
`ids.shikimori`. A plain provider-native `id` is not globally unique.

Availability and torrent discovery only do work when you give the engine matching streaming or
torrent providers.

`getAvailabilityProgressively()` is a transport-neutral `AsyncIterable`. It emits merged snapshots
while `pendingProviders` is non-empty and always marks the final snapshot as `complete`. The existing
`getAvailability()` Promise remains the final-result API. HTTP applications must choose their own
streaming transport; Core does not couple this contract to SSE or WebSockets.

## What core handles for you

- calls compatible providers concurrently;
- merges duplicate movies, series, and anime;
- returns useful partial data when only one source fails;
- supports timeouts, caching, cancellation, and shared in-flight requests;
- normalizes errors and reports failed providers in response metadata;
- exports the public types and provider contracts needed by applications.

Core does not host video, open torrent files, join a swarm, or transcode media. Streaming and torrent
providers return normalized options; your application decides what to do with them.

For query fields, configuration, custom providers, and response shapes, read the
[public API guide](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md). The exported
TypeScript types are the exact reference.

## License

MIT
