# Media Engine API

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/apps/api/README.ru.md)

A ready-to-run NestJS wrapper around Media Engine. It is useful when a browser or another service needs the engine over HTTP.

This app belongs to the GitHub repository and is not an npm package.

## Run it

From the repository root:

```bash
pnpm install
pnpm dev:api
```

The API starts at <http://127.0.0.1:3000>. Swagger is at <http://127.0.0.1:3000/docs>.

Try a request:

```bash
curl 'http://127.0.0.1:3000/media/search?title=Interstellar&language=en'
```

## Routes

```text
GET /health
GET /health/live
GET /health/ready
GET /providers
GET /providers/streaming
GET /providers/torrent
GET /media/search
GET /media/details
GET /media/availability
GET /media/torrents
GET /docs
GET /docs-json
```

`GET /media/details` requires a namespaced external ID such as `imdb`, `kinopoisk`, or `ids.shikimori`. A plain `id` is ambiguous across providers and returns HTTP 400.

All media endpoints canonicalize trimmed IDs and language before provider/cache work; equivalent top-level and `ids.*` forms share one cache key. Malformed known IDs and oversized fields return HTTP 400. `GET /media/search?...&limit=0` is an intentional zero-work probe that returns an empty provider-free response.

`GET /media/torrents` is a discovery and handoff endpoint only. It does not run a torrent client,
join a swarm, download or store media, proxy traffic, or transcode video. Torrent providers remain
disabled by default. Enable a deliberate subset through an exact comma-separated allowlist:

```dotenv
MEDIA_ENGINE_TORRENT_PROVIDERS=yts-torrent,jacred-torrent,bitsearch-torrent,magnetz-torrent
MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS=15000
MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS=20000
```

Supported names are `yts-torrent`, `jacred-torrent`, `bitsearch-torrent`, and `magnetz-torrent`.
Unknown, duplicate, or empty list entries fail startup. Configured order is preserved for result
interleaving. Keep the list empty unless the deployment owner accepts the providers' anonymous
quotas and timeout budget; enabling discovery does not enable torrent playback.

```bash
curl 'http://127.0.0.1:3000/providers/torrent'
curl 'http://127.0.0.1:3000/media/torrents?type=movie&title=Dune&year=2021&imdb=tt1160419&limit=20'
```

Media request disconnects are forwarded to core as an abort signal. If another identical HTTP request is still subscribed, its shared provider work continues; otherwise queued/running provider work is cancelled and the abandoned response is not cached.

Local settings come from `.env`. The useful defaults are documented in the root `.env.example`, including the port and provider timeouts. Metadata, generic streaming, FlixHQ, generic torrent discovery, and JacRed keep independent timeout budgets; KinoBD, DDBB, and AniLiberty share the bounded generic streaming budget, while the larger FlixHQ and JacRed values are not capped by it. The default streaming set is KinoBD, FlixHQ, DDBB, and AniLiberty; none requires caller credentials. Torrent discovery remains explicitly opt-in.

`/health/live` only confirms that the API process can answer HTTP requests. `/health/ready` and the backward-compatible `/health` also inspect provider circuits and return `status: "degraded"` when at least one circuit is open or recovering. Degraded readiness remains HTTP 200 because the API can still return partial results.

Deployment settings are parsed strictly at startup. `HOST` must be an IP address or hostname, `PORT` must be an integer from 1 to 65535, and production requires an explicit comma-separated `CORS_ORIGINS` allowlist containing exact HTTP(S) origins. The four expensive media endpoints share a process-local fixed-window limit configured by `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` and `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; set the maximum to `0` only when an equivalent edge limiter is present.

Helmet applies a no-content CSP and standard security headers to JSON API responses. Swagger has a separate self-only policy that permits its required inline bootstrap. The example/player UI is a separate deployment surface: keep third-party embeds disabled or define an explicit `frame-src` allowlist there rather than weakening the API CSP.

Development Compose currently publishes API and example ports on all interfaces, which can expose them to the local network. For loopback-only access, set `MEDIA_ENGINE_COMPOSE_BIND_ADDRESS=127.0.0.1` in `.env` before `docker compose up`.

## Check it

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Provider code lives in `@media-engine/providers`; merging lives in `@media-engine/core`. This app only connects them to HTTP and keeps secrets out of responses.

## License

MIT
