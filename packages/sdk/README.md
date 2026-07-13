# @media-engine/sdk

Typed HTTP SDK for applications that call the Media Engine REST API.

The SDK is framework-independent. It does not depend on React, NestJS, Express, or provider packages.

## Install

```bash
npm install @media-engine/sdk
```

## Usage

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const client = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await client.search({
  title: "Interstellar",
  type: "movie",
});

const details = await client.getDetails({
  imdb: "tt0816692",
  type: "movie",
});

const availability = await client.getAvailability({
  kinopoisk: "258687",
  type: "movie",
});

const providers = await client.getProviders();
const streamingProviders = await client.getStreamingProviders();
const health = await client.getHealth();
```

## Methods

- `search(query)` calls `GET /media/search`.
- `getDetails(query)` calls `GET /media/details`.
- `getAvailability(query)` calls `GET /media/availability`.
- `getProviders()` calls `GET /providers`.
- `getStreamingProviders()` calls `GET /providers/streaming`.
- `getHealth()` calls `GET /health`.

Search, details, and availability methods accept the query types from `@media-engine/core`. External IDs can be sent either as top-level shortcuts such as `imdb`, `kinopoisk`, and `shikimori`, or through `ids`.

## Availability

`getAvailability` returns normalized player options from the API's configured streaming providers:

```ts
const episode = await client.getAvailability({
  type: "anime",
  shikimori: "20",
  absoluteEpisodeNumber: 1,
});

for (const option of episode.options) {
  console.log(option.player.label, option.translation?.title, option.access.url);
}
```

The SDK does not render players and does not know provider secrets. It only serializes query parameters, calls the API, and returns the typed response.

Failed HTTP responses and invalid JSON payloads throw `MediaEngineApiError`.
