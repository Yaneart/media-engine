# @media-engine/sdk

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/sdk/README.ru.md)

A small typed client for the Media Engine HTTP API. Use it in a browser, bot, or another service
instead of building request URLs by hand.

## Install

```bash
npm install @media-engine/sdk
```

Node.js 20 or newer is required when you use the SDK on the server.

## Basic example

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const media = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await media.search({ title: "Interstellar" });
const details = await media.getDetails({ imdb: "tt0816692" });
```

The client has methods for the public API:

- `search()`;
- `getDetails()`;
- `getAvailability()`;
- `discoverTorrents()`;
- `getProviders()`, `getStreamingProviders()`, and `getTorrentProviders()`;
- `getHealth()`, `getLiveness()`, and `getReadiness()`.

For details, pass an external ID together with its namespace, for example
`media.getDetails({ imdb: "tt0816692" })`.

## Requests and errors

You can set headers once for the whole client or for one request. Every method also accepts an
`AbortSignal`:

```ts
const controller = new AbortController();

const request = media.search(
  { title: "Dune" },
  { signal: controller.signal },
);
```

You may pass your own fetch-compatible function through the constructor's `fetch` option. Failed
HTTP responses and invalid JSON throw `MediaEngineApiError`; it keeps the HTTP status and response
body when available.

The SDK only talks to the API. It does not call providers directly, render players, or run a torrent
client. Follow the [beginner quick start](https://github.com/Yaneart/media-engine/blob/main/docs/quick-start.md)
for a complete backend and frontend example.

## License

MIT
