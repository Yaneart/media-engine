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
GET /reference/torrent-playback/health
POST /reference/torrent-playback/sessions
GET /reference/torrent-playback/sessions/:id
DELETE /reference/torrent-playback/sessions/:id
GET|HEAD /reference/torrent-playback/sessions/:id/stream
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

The repository contains an app-specific, protected TorServer reference API on top of a short-lived
server-owned candidate catalog. It is disabled unless an operator configures both an exact
TorServer URL and a separate high-entropy playback token:

```dotenv
MEDIA_ENGINE_TORRSERVER_URL=http://127.0.0.1:8090
MEDIA_ENGINE_TORRSERVER_USERNAME=
MEDIA_ENGINE_TORRSERVER_PASSWORD=
MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN=<generate-with-openssl-rand-base64-32>
MEDIA_ENGINE_TORRENT_PLAYBACK_RATE_LIMIT_WINDOW_MS=60000
MEDIA_ENGINE_TORRENT_PLAYBACK_RATE_LIMIT_MAX_REQUESTS=10
MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS=8
MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS=30000
MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS=30000
```

Generate the token with `openssl rand -base64 32`; do not place it in a frontend bundle or browser
storage. Create, status, and stop calls require `Authorization: Bearer <token>`. They accept only a
provider/candidate ID previously returned by this API and an optional server-offered file ID;
arbitrary magnets, hashes, paths, and TorServer targets are rejected. There is no global session
list. The public playback health route is rate-limited, remains separate from mandatory API
readiness, and reports only `disabled`, `ok`, or `unavailable` plus the healthy version.

Session snapshots include an expiring high-entropy `streamUrl`, usable only after file selection.
It is the browser media capability and therefore needs no Bearer header; treat it as a secret and
never persist or log it. Its GET/HEAD gateway supports one normalized Range, preserves
backpressure, cancels on disconnect, and has independent active-stream, 30-second media-header,
and body-idle limits. A transient transport or TorServer 5xx failure receives at most one retry
before any response bytes, inside the same media-header budget. Hashes, file IDs, and TorServer
URLs still come only from server-owned session state.

For the repository-managed option, set `MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090` in
`.env` and start `docker compose --profile torrent-playback up`. Default Compose never starts
TorServer. The official `MatriX.141.1` multi-arch image is pinned by immutable digest, has no host
port, and shares a dedicated network only with the API. Its root filesystem is read-only; config
and torrent-autoload scratch are bounded ephemeral tmpfs mounts, upstream settings stay read-only
with the 64 MiB memory cache, container logs rotate, and CPU/RAM/PID limits apply. The bundled
service deliberately uses no TorServer Basic Auth because it is network-isolated and the public
API already requires its independent playback Bearer token. This avoids the upstream behavior
where enabling auth without a valid `accs.db` leaves requests unprotected.

An already installed local or remote TorServer remains supported through an explicit URL. From
Compose, use `http://host.docker.internal:8090` for a host-local instance; configure the paired
username/password only if that instance has TorServer Basic Auth enabled. The repository profile
does not start in that case. Keep external TorServer ports firewall-restricted to trusted backend
traffic; Basic Auth in the reviewed release does not wrap its media `/play` routes.

Range delivery is implemented, but the player UI and conversion pipeline remain separate later
blocks. It is not part of the public SDK. See
[Reference torrent playback](../../docs/reference-torrent-playback.md) for the lifecycle, license,
reviewed image, and upgrade policy.

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
