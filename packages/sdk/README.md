# @media-engine/sdk

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/packages/sdk/README.ru.md)

A typed `fetch` client for the Media Engine REST API.

Use it when your browser, bot, or another service talks to `apps/api` instead of creating `MediaEngine` directly.

```bash
npm install @media-engine/sdk
```

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const media = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await media.search({ title: "Interstellar" });
const details = await media.getDetails({ imdb: "tt0816692" });
const torrents = await media.discoverTorrents({ type: "movie", imdb: "tt0816692" });
const health = await media.getHealth();
const live = await media.getLiveness();
const ready = await media.getReadiness();
```

Pass a namespaced external ID to `getDetails()`, through `ids` or a shortcut such as `imdb`. The API rejects the deprecated plain `id` lookup with HTTP 400.

The main client methods are:

- `search()`;
- `getDetails()`;
- `getAvailability()`;
- `discoverTorrents()`;
- `getProviders()`;
- `getStreamingProviders()`;
- `getTorrentProviders()`;
- `getHealth()`.

Each method accepts optional headers and an `AbortSignal`. You can also provide your own compatible `fetch` implementation.

Failed HTTP responses and invalid payloads throw `MediaEngineApiError`, which keeps the HTTP status and response body when possible.

The SDK does not call providers, render players, or run a torrent client. It only turns typed method calls into HTTP requests.

See the [public API guide](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) for query examples.

## License

MIT
