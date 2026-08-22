# Media Engine API

**English** | [Русский](README.ru.md)

This is a ready-made HTTP API for Media Engine. Use it when a browser, mobile app, bot, or another
service needs to talk to the engine over the network.

The API is part of this repository. It is not published as a separate npm package.

## Run it locally

From the repository root:

```bash
pnpm install
cp .env.example .env
pnpm dev:api
```

The API starts at <http://127.0.0.1:3000>. Its Swagger page is available at
<http://127.0.0.1:3000/docs>.

Try a search:

```bash
curl 'http://127.0.0.1:3000/media/search?title=Interstellar&language=en'
```

## Main routes

- `GET /media/search` — search for a movie, series, or anime;
- `GET /media/details` — load merged details by an external ID;
- `GET /media/availability` — find player and stream options;
- `GET /media/torrents` — discover torrent releases when providers are enabled;
- `GET /providers` — see the active providers;
- `GET /health`, `/health/live`, and `/health/ready` — check the service;
- `GET /docs` — open the full interactive API reference.

For details, use a namespaced ID such as `imdb=tt0816692` or `ids.shikimori=20`. A plain `id` is
ambiguous and the API intentionally rejects it.

## Configuration

Local settings live in the root `.env` file. Start with `.env.example`; it already contains safe
development defaults for the port, CORS, timeouts, and rate limits.

Metadata and player providers work without your API keys. Torrent discovery is off by default. To
enable it, set `MEDIA_ENGINE_TORRENT_PROVIDERS` to the providers you want, for example:

Filmix direct guest MP4 is also opt-in. Set `MEDIA_ENGINE_FILMIX_STREAMING_ENABLED=true` to add it;
guest mode needs no account or activation and intentionally returns only full 480p. Its current
metadata endpoint uses plain HTTP, while returned CDN video links use HTTPS.

VeoVeo direct signed HLS is opt-in with `MEDIA_ENGINE_VEOVEO_STREAMING_ENABLED=true`. It needs a
Kinopoisk or IMDb ID, uses DDBB only to resolve VeoVeo's public content ID, and discards the iframe
token without loading the iframe.

VideoHUB direct signed MP4 is opt-in with `MEDIA_ENGINE_VIDEOHUB_STREAMING_ENABLED=true`. It needs
a Kinopoisk ID; series need an exact season and episode. Links are short-lived, bound to the
playback User-Agent, and may also be bound to the API server's public egress IP. The HTTP API
forwards the availability request's User-Agent and isolates these links in cache accordingly. Its
separate timeout defaults to 20 seconds and can be changed with
`MEDIA_ENGINE_VIDEOHUB_STREAMING_PROVIDER_TIMEOUT_MS`.

```dotenv
MEDIA_ENGINE_TORRENT_PROVIDERS=yts-torrent,jacred-torrent
```

The original-file torrent routes also need a private server token. Generate one with
`openssl rand -hex 32` and put it in `.env`:

```dotenv
MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN=paste_the_generated_value_here
```

Never expose this token in browser code or in a `VITE_` variable. The example app keeps it on the
server and calls protected routes through its small backend-for-frontend.

## About torrent streaming

The full Docker Compose stack includes TorrServer. Media Engine gives the browser a short-lived
stream URL for one selected file; it never gives the browser the private lifecycle token or an
internal TorrServer address.

The stream contains the original bytes. There is no conversion or transcoding, so playback still
depends on the browser supporting the file's container and codecs. The complete security and
lifecycle design is documented in the
[original-torrent architecture decision](../../docs/decisions/0001-original-torrent-streaming.md).

## Checks

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Public providers may occasionally be slow or unavailable. The API can return useful partial data
and report which provider failed. A degraded readiness response therefore remains HTTP 200.

## License

MIT
