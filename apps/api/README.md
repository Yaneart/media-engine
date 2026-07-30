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
POST /media/torrent-sessions
GET /media/torrent-sessions/:id
POST /media/torrent-sessions/:id/selection
DELETE /media/torrent-sessions/:id
GET /media/torrent-streams/:capability
HEAD /media/torrent-streams/:capability
GET /docs
GET /docs-json
```

`GET /media/details` requires a namespaced external ID such as `imdb`, `kinopoisk`, or `ids.shikimori`. A plain `id` is ambiguous across providers and returns HTTP 400.

All media endpoints canonicalize trimmed IDs and language before provider/cache work; equivalent top-level and `ids.*` forms share one cache key. Malformed known IDs and oversized fields return HTTP 400. `GET /media/search?...&limit=0` is an intentional zero-work probe that returns an empty provider-free response.

Media request disconnects are forwarded to core as an abort signal. If another identical HTTP request is still subscribed, its shared provider work continues; otherwise queued/running provider work is cancelled and the abandoned response is not cached.

Local settings come from `.env`. The useful defaults are documented in the root `.env.example`, including the port and provider timeouts. Metadata, generic streaming, and FlixHQ keep independent timeout budgets. The default streaming set is KinoBD, FlixHQ, DDBB, and AniLiberty; none requires caller credentials.

Torrent discovery is disabled by default. Set `MEDIA_ENGINE_TORRENT_PROVIDERS` to an explicit comma-separated subset of `yts-torrent`, `jacred-torrent`, `bitsearch-torrent`, and `magnetz-torrent`, and tune its bounded request budget with `MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS`. `GET /media/torrents` returns normalized candidates and opaque handoff data only; it does not join a swarm, select files, or stream media. `GET /providers/torrent` reports the configured discovery providers together with safe optional display/scope/locale catalog metadata. Candidates from a meta-indexer may retain a concrete `catalogSource`; catalog locale is not a release audio-language guarantee.

The app-specific original-file runtime is separate from discovery. `docker compose up -d` starts release `MatriX.141.1` by pinned digest with no host port, together with the API and example. TorrServer shares a private control network with the API and has a dedicated outbound network for trackers, DHT, and peers. The internal adapter requires its exact `/echo` wire-version `MatriX.141`, accepts only hash-bound magnets or already-resolved bounded `.torrent` bytes, and implements health, add, metadata, exact-file target, and ownership-safe release operations. `MEDIA_ENGINE_TORRSERVER_OWNER_ID` must remain stable and unique for each API deployment sharing a TorrServer. Startup removes only stale entries carrying that exact owner marker; pre-existing entries are borrowed and never deleted. A timestamped ownership lease is checked before selection and each stream access so a TorrServer restart or entry replacement retires the stale capability.

The session routes accept a bounded media query plus only an exact `provider`/opaque candidate `id`. The API resolves that observation again, downloads a provider-owned `.torrent` with a strict size/time/redirect policy when needed, and never accepts browser-controlled magnets, hashes, upstream URLs, paths, or TorrServer targets. Session states are `adding`, `waiting_metadata`, `selection_required`, `ready`, `failed`, `stopped`, and `expired`. Every non-padding regular file is offered regardless of extension; ambiguous torrents require one offered numeric file ID. Sessions sharing a hash share TorrServer preparation and the final stop/expiry/shutdown releases the entry.

All create/status/select/stop session routes require `Authorization: Bearer <MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN>`. The example browser never receives this token: its same-origin server-side BFF authenticates lifecycle calls. The high-entropy stream capability remains the only credential used for `GET`/`HEAD` media bytes.

A `ready` snapshot contains an expiring high-entropy `streamUrl`, never an upstream target. Its `GET`/`HEAD` route serves the exact selected original bytes, accepts one closed/open/suffix Range, returns strict `200`/`206`/`416` metadata, forwards only safe validators, and streams with backpressure. The capability route explicitly permits cross-origin media embedding so the separately served example frontend can use it; script access remains governed by the configured CORS allowlist. Client disconnects, session stop/expiry, header deadlines, and body inactivity abort upstream work. A healthy original stream still does not promise browser codec support.

Session lifetime, terminal-record retention, cleanup cadence, and torrent-file request timeout are bounded by `MEDIA_ENGINE_TORRENT_SESSION_TTL_MS`, `MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS`, `MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS`, and `MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS`. The default session lifetime is six hours so a protected original stream can cover a full-length movie. `MEDIA_ENGINE_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS` and `MEDIA_ENGINE_TORRENT_STREAM_MAX_CONCURRENT` bound process-local creation work and active original streams; exhausted capacity returns a typed `503` without invalidating an otherwise healthy stream capability.

`/health/live` only confirms that the API process can answer HTTP requests. `/health/ready` and the backward-compatible `/health` also inspect provider circuits and return `status: "degraded"` when at least one circuit is open or recovering. Degraded readiness remains HTTP 200 because the API can still return partial results.

Deployment settings are parsed strictly at startup. `HOST` must be an IP address or hostname, `PORT` must be an integer from 1 to 65535, and production requires an explicit comma-separated `CORS_ORIGINS` allowlist containing exact HTTP(S) origins. The expensive media endpoints share a process-local fixed-window limit configured by `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` and `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; set the maximum to `0` only when an equivalent edge limiter is present. Session creation has a separate per-client fixed-window budget configured by `MEDIA_ENGINE_TORRENT_SESSION_CREATION_RATE_LIMIT_WINDOW_MS` and `MEDIA_ENGINE_TORRENT_SESSION_CREATION_RATE_LIMIT_MAX_REQUESTS`. It applies only to exact create requests; status, selection, and Stop are not throttled by it.

Helmet applies a no-content CSP and standard security headers to JSON API responses. Swagger has a separate self-only policy that permits its required inline bootstrap. The example/player UI is a separate deployment surface: keep third-party embeds disabled or define an explicit `frame-src` allowlist there rather than weakening the API CSP.

Development Compose currently publishes API and example ports on all interfaces, which can expose them to the local network. For loopback-only access, set `MEDIA_ENGINE_COMPOSE_BIND_ADDRESS=127.0.0.1` in `.env` before `docker compose up`.

## Check it

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
# With the Compose stack running and the API already built:
docker compose exec -T api node scripts/original-torrent-range-smoke.mjs
```

Provider code lives in `@media-engine/providers`; merging lives in `@media-engine/core`. This app only connects them to HTTP and keeps secrets out of responses.

## License

MIT
