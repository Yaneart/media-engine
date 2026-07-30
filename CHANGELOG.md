# Changelog

All notable project changes are recorded here.

This project follows semantic versioning after the first stable release. Before v1.0, breaking changes are allowed when they are documented in the public API audit and release notes.

## Unreleased

### Added

- Added a deterministic native-Firefox original-torrent acceptance smoke. An in-memory browser-made
  VP8/Opus fixture passes through a local tracker, peer, pinned TorrServer, protected Range gateway,
  and native `<video>`; the gate verifies playback, decoded video, audio-track presence, seeking,
  one-file and multi-file torrents, extension-independent bytes, honest non-media rejection,
  cancellation, and complete cleanup
  without probing, conversion, generated HLS, public swarms, or stored media fixtures.
- Added structured, redacted original-torrent runtime/session/stream observability for operation and
  metadata latency, upstream header wait, first body byte, exact Range position, cancellation,
  active sessions/streams, shared references, and cleanup. Deterministic outage coverage now spans
  recovery, health, add, metadata, lease validation, target resolution, cold headers, and stalled
  bodies; a repeated shared-session soak verifies complete record, reference, and torrent cleanup.
- Added deterministic TorrServer ownership and restart recovery for original-file sessions. Each
  deployment marks only entries it creates, borrows pre-existing entries without deleting them,
  removes its stale owned entries at startup, and validates a timestamped ownership lease before
  selection and every stream access. Runtime replacement now retires stale capabilities with a
  typed error, while an incompatible pinned TorrServer version prevents startup.
- Added independent bounded capacities for original-torrent session creation and active original
  streams, with typed overload responses that do not retire healthy capabilities. A separate
  process-local per-client fixed-window budget applies only to exact session creation requests, so
  status, file selection, and Stop remain available under creation pressure.
- Added optional torrent provider catalog metadata with a stable display name, regional or
  international scope, and optional locale, plus candidate-level upstream catalog attribution.
  The example loads this safe metadata through the SDK and groups releases into Russian-language,
  international, and fallback catalogs while preserving exact provider/candidate identity.
- Added the example's original-torrent discovery and single-route browser player. Public candidate
  discovery uses the SDK; exact create/status/select/stop calls pass through a bounded same-origin
  BFF with a server-only bearer token. The UI preserves provider/release/file identity, offers every
  server-reported regular file without extension filtering, separates metadata wait from first-piece
  buffering, maps healthy native decode rejection to `client_format_unsupported`, and cleans up on
  Stop, release switch, component removal, and page close. Playback remains one native `<video>`
  over original bytes with no probing, remux, transcode, HLS, or fallback.
- Added a protected original-file `GET`/`HEAD` gateway backed by expiring high-entropy session
  capabilities. It implements strict closed/open/suffix byte ranges, exact `200`/`206`/`416`
  metadata validation, safe header allowlists, backpressure, disconnect propagation, bounded cold
  headers and body inactivity, pre-header retry, and immediate invalidation on terminal lifecycle
  events. A deterministic local BitTorrent peer smoke verifies exact start/middle/end bytes through
  the pinned TorrServer runtime without relying on public swarms.
- Added app-specific original-torrent session routes that resolve only exact server-known provider
  observations, coalesce shared info hashes, offer all non-padding files without extension
  filtering, validate server-offered numeric file IDs, and clean up on stop, expiry, cancellation,
  or API shutdown. Ready sessions expose only the protected application stream capability.
- Added a new private original-torrent runtime module and a default Compose TorrServer service.
  The pinned non-published service has no host port; its bounded adapter verifies the
  exact runtime version and supports hash-bound magnet or resolved torrent-byte add, metadata/file
  listing, exact internal file targets, and cleanup. The adapter itself remains private; the
  application-owned gateway is the only byte-stream route.
- Rebuilt the repository Nest API torrent-discovery bridge as an isolated, discovery-only module.
  `GET /media/torrents` now provides bounded DTO parsing, cancellation, typed HTTP errors, rate
  limiting, and OpenAPI documentation; `GET /providers/torrent` reports safe provider metadata.
  YTS, JacRed, Bitsearch, and Magnetz remain explicit environment opt-ins, and no torrent runtime,
  file selection, stream proxy, or playback behavior is included.
- Added an explicit opt-in `magnetzTorrentProvider()` for strict international movie, TV, and anime magnet meta-search through the documented no-auth API. It uses one bounded search request without detail fan-out, revalidates title/year/season/episode identity and magnet hashes, normalizes release and peer metadata, and spaces request starts after observed burst rate limits. It remains outside API defaults pending the multi-source reliability checkpoint.
- Added an explicit opt-in `bitsearchTorrentProvider()` for broad international movie, TV, and anime magnet discovery through the documented no-key public API. It bounds the search contract, handles the small anonymous daily quota, revalidates exact title/year/type/season/episode identity, deduplicates strict info hashes, and normalizes release and peer metadata. It remains outside API defaults pending the multi-source reliability checkpoint.
- Added an explicit opt-in `jacRedTorrentProvider()` for exact title/year Russian and multilingual movie, series-season, and anime magnet discovery. It pins the observed no-key public route behind configurable base/path options, strictly bounds nullable JSON, revalidates title/year/type/season identity, deduplicates validated info hashes, and normalizes release and peer metadata without guessing exact episodes. It remains outside API defaults pending the multi-source reliability checkpoint.
- Added an explicit opt-in `ytsTorrentProvider()` with no-key exact IMDb or exact title/year movie lookup, strict bounded JSON parsing, hash-bound YTS torrent-file handoffs with magnet fallback, normalized quality/release metadata, and honest peer availability. It remains outside API defaults pending the multi-source reliability checkpoint.
- Added a separate normalized torrent-discovery contract across core and SDK. It defines provider capabilities, typed candidates and handoff data, attribution, bounded orchestration, cancellation, caching, health telemetry, and partial failures without bundling a torrent source, client, player, proxy, storage, or transcoder.
- Added an explicit opt-in `ddbbStreamingProvider()` with no-token Kinopoisk/IMDb lookup, diversity-first embed mapping, strict nullable response parsing, bounded live validation, and no unsupported exact-episode claim. It is exported from `@media-engine/providers` but remains outside API defaults pending reliability review.
- Added an explicit opt-in `aniLibertyStreamingProvider()` with no-token exact title/year identity, bounded episode mapping, direct 480p/720p/1080p HLS options, normalized release block states, and no ambiguous season/episode guesses. It remains outside API defaults pending the source reliability checkpoint.

### Changed

- Increased the bounded default original-torrent session lifetime from 30 minutes to six hours so
  full-length movies do not expire during ordinary browser playback. Explicit Stop, release switch,
  page close, expiry, and API shutdown retain the existing cleanup behavior.
- JacRed now retains its bounded upstream tracker identifier and maps known labels such as BitRu,
  RuTracker, RuTor, Kinozal, NNM-Club, and Knaben instead of presenting every result only as a
  generic JacRed observation. This attribution does not claim an actual release audio language.
- DDBB now exposes one main Alloha option because translation switching is available inside that
  player. It no longer creates a separate application option for every Alloha voiceover; when the
  main iframe is absent, at most one safe translation URL is used as the player entry point.
- The default `docker compose up -d` stack now starts the pinned, non-published TorrServer runtime
  together with the API and example; a separate Compose profile is no longer required. TorrServer
  retains a private API control network and receives a dedicated outbound network so public
  trackers, DHT, and peers remain reachable.
- Removed the repository app/runtime torrent implementation from `apps/api`, `apps/example`,
  Compose, `.env.example`, smoke scripts, OpenAPI, and app tests. Public package torrent discovery
  contracts and provider implementations remain for a later minimal original-stream rebuild.

- Added a repeatable combined torrent-source smoke gate and completed the YTS/JacRed/Bitsearch/Magnetz reliability and info-hash-overlap checkpoint. All four adapters remain explicit opt-ins, repository API defaults stay empty because anonymous quotas and timeout tails require application-owned budgets, and matching hashes from different providers retain separate peer/source observations instead of losing provenance through cross-provider collapse.
- The repository API now enables the bounded DDBB and AniLiberty streaming providers by default after repeated reliability, missing-result, diversity, timeout, and direct-HLS checks. Direct package consumers still configure their own provider list.
- Details lookup now requires a namespaced external ID. The ambiguous `DetailsQuery.id` field is deprecated, and id-only core/API/SDK requests return `INVALID_QUERY` or HTTP 400 instead of a cacheable successful null response.
- Search provider metadata now distinguishes primary, retry, fallback, ID-enrichment, and poster-enrichment phases. Mandatory retryable fallback degradation remains cache-safe, while optional enrichment failures return bounded warnings and debug counters without discarding base results.
- Shared provider HTTP errors retain their response status through `getProviderHttpStatus`, allowing adapters to distinguish confirmed absence from other non-retryable responses.
- Provider JSON and FlixHQ HTML responses are read through a streaming byte limit instead of being fully buffered first. Oversized bodies now fail with `PROVIDER_RESPONSE_TOO_LARGE`, distinct from invalid JSON, and `fetchJson` accepts a bounded `maxResponseBytes` override.
- FlixHQ navigation is confined to its configured origin with manual bounded redirects. Server-side player and subtitle checks now reject private/reserved literal or DNS targets, mixed public/private answers, and unsafe redirect hops while pinning each connection to its validated address.
- Built-in provider artwork, player, subtitle, and related output URLs now share an HTTP(S)-only policy that rejects credentials, raw control characters, and literal local/private/reserved targets without removing valid CDN query parameters or signatures. The example keeps external links as the default and loads sandboxed embeds only after explicit user action with an origin-only referrer.
- Search, details, and availability queries now use one canonical validated shape for provider selection, cache, and in-flight keys. External-ID shortcuts collapse into trimmed `ids`, language and provider filters are normalized, known ID formats and field lengths are bounded, and `limit: 0` returns without provider or cache work. `MemoryCache` now rejects non-finite, fractional, negative, or unsafe-integer TTL values; omitted TTL remains the documented no-expiry mode.
- Public engine operations now accept an optional abort signal with subscriber-aware request coalescing. Cancelling one caller leaves shared work available to others; cancelling the last subscriber aborts provider work, removes queued calls, prevents cache writes, and is not recorded as an upstream circuit failure. Nest media endpoints connect HTTP disconnects to this lifecycle.
- Search ID and poster enrichment now use one top-N planner with a six-call global budget, a two-call per-provider budget, and a 1.5-second wall-time boundary. Matching ID-search results and cached or in-flight details are reused instead of starting duplicate poster lookups.
- Metadata providers can declare primary or fallback title discovery and can opt out of best-effort search-card enrichment. The engine broadens supported typos through primary sources first, then invokes fallback sources only for empty or conflicting exact-title candidates; direct external-ID lookup remains immediate across all compatible providers. Built-in Wikidata now uses the fallback role without allowing short optional enrichment calls to consume its circuit and timeout capacity.
- The first healthy search discovery with a strong top identity now retains a separate bounded 30-minute snapshot across equivalent limits. It keeps later cache misses stable across successful upstream drift and retryable partial degradation without refreshing the window, promoting weak ID-less results, hiding current provider failures, caching degraded responses, or merging conflicting strong IDs.
- Mandatory search discovery and eligible snapshot recovery now freeze result identities, scores, and order before optional ID/details/poster enrichment. Enrichment only augments matching cards with presentation data, non-conflicting IDs, and source attribution; it cannot introduce or rerank identities, and conflicting added IDs retain the discovery value with a warning.
- Mandatory title discovery now broadens supported multi-word typos despite weak fuzzy noise and invokes fallback identity sources for multi-word queries without an exact match. Ranking prefers closer token-length matches, broadly reusable external IDs, and audience-backed ratings before the identity order is frozen.
- Built-in debug search results now expose the exact ranking formula, match strength, title match, normalized factor weights/contributions, and score/diversity/final positions. A bounded top-10 diversity pass keeps the first result and every score unchanged while interleaving only similarly ranked candidates after two results from the same normalized title and media type.
- Added TVmaze as a no-token, fallback-only series identity provider. It returns only IMDb-backed candidates, performs at most one AKA lookup when the top result needs cross-script confirmation, stays out of optional card enrichment, and preserves TVmaze source links for CC BY-SA attribution.
- KinoBD streaming now shares one bounded child-request/deadline budget across an availability operation and validates players through a configurable worker pool. Numeric search, player, concurrency, request, and timeout options have explicit upper bounds, while additive player-audit metrics report validation and budget outcomes.
- Wikidata fallback discovery now filters clearly unrelated search summaries before loading at most three candidates, retrieves only the normalized identity fields through a 256 KiB selected-property query, and keeps entity/IMDb mappings in a bounded six-hour LRU cache. Cache TTL, size, and candidate count remain explicitly bounded provider options.
- The local IMDb dataset provider now separates its backward-compatible in-memory TSV adapter from an exported synchronous/asynchronous storage contract, allowing applications to supply a persistent indexed backend without adding a database dependency for every package user. A reproducible 100k/1m benchmark records the linear adapter baseline and persisted-backend acceptance thresholds.
- Added an optional persisted IMDb SQLite/FTS backend with streaming plain/gzip TSV import, a versioned validated schema, compacted same-directory atomic publication, read-only indexed ID/title lookup, and cancellation that preserves the previous index. SQLite is loaded lazily only for these functions, so the package and in-memory adapter retain their Node.js 20 baseline while the persisted path requires built-in `node:sqlite` from Node.js 22.13 or newer.
- Public package builds now clean their own output before emit and verify source/output plus dry-pack inventories, preventing deleted modules and test artifacts from surviving into a release. Release checks keep the three package manifests, runtime versions, changelog, internal dependencies, and User-Agent release metadata consistent while treating the REST/OpenAPI contract version independently.
- Local release checks now include check-only lint, deterministic thresholded coverage, API e2e tests, version consistency, and dry-pack verification while reusing one clean build. Node package tests are selected from the current source inventory, and API bootstrap, environment, health, and OpenAPI behavior have focused unit coverage.
- Push and pull-request CI now runs frozen-lockfile deterministic gates on current LTS/project Node versions and public-package compatibility on Node.js 20. Live network smoke is isolated to scheduled/manual runs with machine-readable HEALTHY, UPSTREAM_DEGRADED, BUDGET_EXCEEDED, and CONTRACT_REGRESSION results; `--strict` now truly rejects warnings and `--max-warnings` provides an explicit outage budget.

### Fixed

- A stopped or unreachable TorrServer during session preparation or lease validation now remains
  `torrserver_unavailable` instead of being misclassified as missing torrent pieces. Capability
  access reports the transient runtime outage as HTTP 503, and no fallback route is attempted.
- Protected original-file responses now override the API-wide same-origin resource policy with a
  capability-route-specific cross-origin media policy. This lets the separately served example
  `<video>` consume valid MP4 ranges without weakening security headers on other API routes. The
  example also removes the ambiguous hard-coded `1×` torrent-player badge.
- DDBB options beyond the bounded live-validation limit are now reported as `unknown` instead of inheriting an unverified `available` status. The example groups episodes, player families, translations, and qualities, exposes direct stream links, and sends an origin-only referrer required by otherwise valid Alloha embeds.
- Cinemeta untyped IMDb details lookups no longer turn movie/series branch outages into cacheable successful null responses.
- AniList HTTP-200 GraphQL rate-limit and server errors now remain retryable provider failures, while validation errors and malformed payloads receive non-retryable typed categories.
- Streaming providers that resolve `null` now count as successful no-result responses, so a separate provider failure no longer causes a false all-failed error.
- Player validation removes options only after 404/410 or a stable deletion marker. Transient HTTP, network, and timeout failures keep the discovered option as `unknown`, add a bounded warning, and prevent normal availability caching until validation recovers.
- Example embed sandboxing now preserves the third-party player origin after explicit iframe opt-in, avoiding `Origin: null` CORS failures in players that load their own resources.
- Provider retry-budget coverage no longer depends on real-time 25–50 ms scheduling; an injected deterministic scheduler verifies the same total timeout contract without load-sensitive flakes.

## 0.1.1 - 2026-07-18

### Added

- Process-local provider health telemetry, per-provider circuit breaking with recovery probes, bounded provider concurrency, and provider-specific timeout budgets.
- Optional stale metadata cache retention for retryable upstream outages. Availability links remain fresh-only.
- Adaptive HTTP retry delays with jitter, `Retry-After` support, and shared per-provider rate-limit cooldowns.
- English and Russian package documentation covering the current engine, provider, SDK, API, and Docker workflows.

### Changed

- Identical in-flight search, details, and availability requests are coalesced while preserving isolated response objects for each caller.
- Search performs fewer poster-enrichment requests, keeps canonical search/details posters consistent, and applies bounded provider work throughout fallback and enrichment paths.
- Engine, merge, KinoBD streaming, and example-app internals were split into responsibility-focused modules without changing package entrypoints.
- Cache ownership and provider cancellation boundaries were hardened; numeric provider options are validated and direct streaming cache lifetimes respect advertised expiration.

### Fixed

- Partial search, details, and availability responses containing retryable provider failures are no longer stored as complete cache entries; a repeated request can recover missing metadata or players.
- Provider-specific streaming timeouts are no longer silently capped by a shorter global default.
- English details titles prefer independently corroborated localized values, fixing mixed-ID results such as Death Note.
- Provider failures now retain bounded timeout, rate-limit, unavailable, and other diagnostic counters.

### Performance

- Cold representative searches reduced upstream request amplification by up to roughly half while keeping per-provider concurrency at or below the configured limit.
- The final `0.1.1` strict title matrix passed all 17 canonical English, Russian, typo, and anime cases with no warnings or deterministic failures, compared with 3 passes and 14 upstream warnings before the performance work.

### Public API

- No existing package exports or method signatures were removed.
- `MediaEngineOptions` gained optional circuit-breaker and provider-concurrency tuning, and `MediaEngine` gained `getProviderHealth()`.
- The cache contract gained optional stale-read support, response metadata gained an optional stale marker, and metadata providers gained an optional poster-consistency capability flag.
- Provider HTTP utilities gained bounded retry tuning and the exported `ProviderRateLimitGate`; SDK health responses now expose provider health data.

## 0.1.0 - 2026-07-13

### Added

- `@media-engine/core` with media data types, provider contracts, registry, engine search/details orchestration, merge strategy, error model, memory cache, streaming contract types, and testing utilities.
- `@media-engine/providers` with shared HTTP utilities; KinoBD, Cinemeta, Shikimori, AniList, Wikidata, and local IMDb dataset metadata providers; plus KinoBD/ReYohoho-style, FlixHQ, and experimental streaming providers.
- `@media-engine/api` NestJS REST API with health, providers, streaming providers, search, details, availability, and Swagger/OpenAPI endpoints.
- `@media-engine/example` React app that calls the API through `@media-engine/sdk` and demonstrates search, details, availability, provider failures, grouped player options, and embed preview/open flows.
- `@media-engine/sdk` with typed search, details, availability, providers, streaming providers, health, and API error handling.
- Development Docker Compose stand for the API and React example app.
- Live provider, search-quality, latency, availability, and source-filter smoke scripts plus npm package dry-run checks.
- FlixHQ international movie and requested-episode discovery with bounded embed validation and normalized public subtitle tracks.

### Release Notes

- This is the first `0.1.0` pre-release candidate for the three public npm packages.
- Live no-token metadata and player providers are best-effort integrations over third-party sources. They should be described honestly in release notes and guarded by smoke checks.
- Streaming providers expose normalized player access metadata; Media Engine does not host video or guarantee third-party availability.
- Removed token-based TMDB and direct Kodik API providers. TMDB IDs may still appear when returned by no-token upstream metadata sources, and Kodik may still be one player discovered through KinoBD.
