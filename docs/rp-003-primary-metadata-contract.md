# RP-003 primary metadata and fallback contract

Status: ready for user acceptance

Specified: 2026-10-07

Target baseline: Media Engine `1.12.0`

Branch: `feature/resilient-sources`

This document fixes the metadata behavior that `RP-004` must implement. It changes documentation
only. It does not add a provider, change runtime selection, or authorize removal of an existing
adapter.

The decisions use the [RP-001 baseline](rp-001-baseline-audit.md) and the
[RP-002 source evaluation](rp-002-russian-metadata-evaluation.md). The contract applies to search
and details metadata. Streaming discovery and playback remain outside `RP-003`.

## Accepted decisions

1. Official TMDB is the only normal blocking primary for canonical `movie` and `series` metadata.
2. Shikimori GraphQL is the only normal blocking primary for canonical `anime` metadata, including
   anime films which also have TMDB or IMDb identities.
3. A healthy details request returns one coherent primary snapshot and does not wait for any legacy
   metadata provider.
4. A verified stale snapshot is served immediately while one coalesced refresh runs in the
   background. Existing providers run as bounded fallback only when neither fresh nor usable stale
   data can satisfy the request and the primary fails its contract.
5. Fallback never changes the canonical work, media type, anime release, or requested language
   silently. A composite fallback is permitted only under the exact identity rules below and must
   expose every contributing provider.
6. The existing canonical identity model remains compatible. No `work_*` key, alias, redirect, or
   persisted yaneMedia user-data migration is required.
7. The fresh/stale cache window remains five minutes fresh followed by thirty minutes of stale
   eligibility. The response provenance contract is additive and is prepared for the next joint
   Core/Providers/SDK minor release.

## Routing and provider roles

### Details

Provider selection uses the canonical media class, never whichever external ID happens to be
available first.

| Canonical class | Blocking primary  | Bounded fallback candidates                         |
| --------------- | ----------------- | --------------------------------------------------- |
| `movie`         | official TMDB     | indirect TMDB, Cinemeta, useful KinoBD metadata     |
| `series`        | official TMDB     | indirect TMDB, Cinemeta, useful KinoBD metadata     |
| `anime`         | Shikimori GraphQL | current Shikimori REST, then AniList as noted below |

The new adapters use distinct diagnostic names, such as `tmdb-official` and
`shikimori-graphql`. Existing provider names are not reassigned to a different upstream in place.

The caller should preserve `type` from a search result or canonical registry lookup. When a legacy
details query omits `type`, Core may classify it from exact identity evidence or let one selected
primary adapter resolve its own movie/series subtype. It must not fan out to both media-class
primaries and merge their details. An ambiguous identity returns no details with a safe diagnostic;
title/year inference alone cannot select a details work.

An `anime` route stays anime even when it contains IMDb, TMDB, or Kinopoisk IDs. In particular,
Spirited Away must not enter the movie primary path. A TMDB movie/TV subtype mismatch, a conflicting
external ID, or an anime release mismatch invalidates the candidate instead of reclassifying the
canonical work.

### Search

Typed search uses the primary for the requested class. Untyped title search is the explicit
discovery exception: official TMDB and Shikimori GraphQL may run concurrently so one query can find
both cinema/television and anime. This is not details fan-out, and results remain separate
candidates until canonical identity deduplication.

Every returned search item must contain enough evidence to open details without a new title-based
identity search:

- non-empty localized display title, canonical `type`, year, and poster;
- the selected primary's native ID;
- TMDB results include appended IMDb identity when available;
- Shikimori results include Shikimori and MyAnimeList identity;
- original and alternative titles remain search aliases, not forced display-title replacements.

If one class primary fails during untyped search, the other class may still return results and the
response is degraded. Fallback is scoped to the failed class and cannot delay already verified
results past the overall search budget.

## Complete details snapshot

### Mandatory common fields

A primary or cacheable fallback details snapshot is complete only when all of these checks pass:

| Field         | Requirement                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- |
| identity      | Exact stable native identity for the selected route and no conflict with any supplied ID |
| `type`        | Exact canonical `movie`, `series`, or `anime`; never inferred by title alone             |
| `title`       | Non-empty title returned by the provider's Russian localization contract                 |
| `description` | Non-empty Russian-localized description                                                  |
| `poster`      | Valid absolute HTTPS image URL classified as a poster                                    |
| `backdrop`    | Valid absolute HTTPS image URL classified as a backdrop/landscape image                  |
| `year`        | Valid four-digit release year consistent with the requested identity                     |

"Russian-localized title" does not mean "contains Cyrillic". For example, TMDB's `ru-RU` title
`Shōgun` is valid. An original or English title can be retained separately, but cannot replace a
missing Russian-localized description or masquerade as successful Russian localization.

Images must come from documented provider image origins or an explicitly allowed public image CDN.
Credentials, signed internal URLs, data URLs, HTML, and non-HTTP schemes are rejected. Width,
height, language, and source remain optional normalized metadata.

### Class-specific identity and release shape

| Class  | Additional mandatory checks                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movie  | TMDB movie ID matches the request/result; appended IMDb must match a supplied IMDb ID; no series/anime release shape                                 |
| Series | TMDB TV ID matches the request/result; appended IMDb must match a supplied IMDb ID; non-negative season and episode counts when TMDB declares them   |
| Anime  | Shikimori ID and MAL ID match exact supplied identities; `animeKind` is known; declared episode count and year are normalized from the exact release |

For anime, completed release length uses the declared episode count and may use
`max(episodes, episodesAired)` when the source exposes both. `episodesAired: 0` alone cannot erase a
declared completed count. Split seasons remain independently identified anime releases; fallback
must not substitute a related season, recap, special, or parent franchise.

Season and episode arrays, people, genres, ratings, status, runtime, and financial fields remain
optional. Their absence does not trigger fallback. If present, they must still pass normal type and
shape validation.

## Coherent snapshot and fallback validation

### Primary snapshot

All mandatory fields of a normal response come from the one selected primary record. Identity
verification may validate that record, but another metadata provider cannot overwrite its title,
description, artwork, type, year, or release shape. Optional enrichment must be off the blocking
path and cannot mutate the response already returned or its cached primary snapshot.

### Fallback snapshot

Fallback candidates are bounded and cancellable. The first independently complete,
identity-valid fallback snapshot may win, after which remaining fallback work is cancelled. A
fallback does not wait for every legacy provider.

If no single legacy result is complete, Core may build one composite fallback only when all of the
following are true:

1. one anchor result supplies the canonical type, year, localized title and description, and an
   exact external identity;
2. every contributor matches the anchor by an exact verified external ID; title/year similarity is
   insufficient;
3. supplied query IDs do not conflict, and anime contributors match the exact MAL/Shikimori release
   plus `animeKind`;
4. one field value is chosen deterministically; conflicting mandatory values reject the composite
   rather than using provider priority to hide the conflict;
5. English AniList text never replaces missing Russian title or description;
6. every contributor appears in snapshot provenance and `sourceProviders`.

AniList is therefore a bounded anime identity/artwork contributor, or a standalone fallback only
when its actual response independently meets the Russian contract. It is not a silent English
metadata substitute. The current indirect TMDB, Cinemeta, and KinoBD adapters follow the same
rules; their previous fan-out-and-merge behavior is not itself an accepted fallback contract.

## Resolution algorithm

For a normalized search/details cache key containing language, media type, and verified identity:

```text
1. fresh verified cache hit -> return it
2. usable verified stale hit -> return it immediately and start/join one background refresh
3. no usable cache -> call the one class primary (two class primaries only for untyped search)
4. complete and identity-valid primary -> cache and return it
5. primary miss/incomplete/eligible failure -> run bounded fallback candidates
6. first valid complete fallback, or valid strict composite -> cache and return degraded
7. no valid snapshot -> return null/not-found or the normalized provider error described below
```

Background refresh follows steps 3-6, but never launches duplicate work for the same key. A failed
refresh leaves the stale entry eligible only until its original stale deadline; it does not extend
freshness or stale lifetime.

Caller cancellation stops primary, refresh work owned solely by that caller, and fallback work. A
request cancelled by its caller does not start fallback and does not return stale after cancellation.

## Fallback triggers

| Primary outcome                              |                              Retry primary | Use stale if available |               Run fallback without stale |
| -------------------------------------------- | -----------------------------------------: | ---------------------: | ---------------------------------------: |
| complete, valid snapshot                     |                                         no |                     no |                                       no |
| exact work not found                         |                                         no |                    yes |                                      yes |
| mandatory field missing                      |                                         no |                    yes |                                      yes |
| identity/type/release mismatch               |                                         no |                    yes | yes, but record invalid-response failure |
| malformed or unsafe payload                  |                                         no |                    yes |                                      yes |
| timeout/network/5xx/unavailable              |                               at most once |                    yes |                                      yes |
| HTTP 429                                     | only within `Retry-After` and total budget |                    yes |                                      yes |
| unauthorized/forbidden/missing configuration |                                         no |                    yes |          yes; readiness remains degraded |
| caller cancellation                          |                                         no |                     no |                                       no |

"Use stale" in this table describes eligibility. Under stale-while-revalidate, a known stale hit is
already returned before foreground primary/fallback work begins.

## Cache contract

- Fresh lifetime: five minutes from successful snapshot creation.
- Stale eligibility: the following thirty minutes; maximum age is thirty-five minutes.
- Keys include normalized language, canonical media class, exact identity, and operation. A Russian
  snapshot cannot satisfy another language or a conflicting identity.
- Only complete, identity-verified snapshots are cached. Primary and accepted fallback snapshots
  are both cacheable and retain their original route/provider provenance.
- Responses with an unresolved identity diagnostic, contradictory IDs, unsafe URLs, or an
  incomplete mandatory field are never cached.
- A retryable failure does not overwrite a healthy cache entry. Missing/invalid results are not
  negative-cached in `RP-004`.
- In-flight foreground loads and background refreshes are coalesced per cache key.
- Stale responses set `cached: true`, `stale: true`, and preserve the original `fetchedAt` time.
  They are always degraded, even when the background refresh later succeeds.

The cache adapter remains application-owned. Core owns eligibility, keys, coalescing, and the
fresh/stale state machine; a cache implementation only stores the supplied value and deadlines.

## Timeout, retry, and latency contract

The budgets are end-to-end Engine operation budgets measured at the Core boundary. They include
identity work required to select/verify the route, provider transport, normalization, and cache
access. They exclude yaneMedia queueing and browser/network transit.

| Path                                       | Accepted p95 budget | Hard behavior                                |
| ------------------------------------------ | ------------------: | -------------------------------------------- |
| Warm search/details fresh hit              |         `<= 100 ms` | no provider call                             |
| Stale search/details response              |         `<= 250 ms` | return stale; refresh in background          |
| Cold healthy-primary search/details        |       `<= 2,500 ms` | no legacy provider on critical path          |
| Degraded foreground fallback without stale |       `<= 6,000 ms` | cancel unfinished work at operation deadline |

The selected primary receives at most `2,000 ms` total across all its attempts. Core permits one
retry only for the retryable outcomes in the table above, only when enough budget remains, and with
at most `100 ms` jittered delay. Attempts share one deadline; a retry never receives a fresh full
timeout. Provider code must honor the supplied abort signal.

Fallback begins only after the primary outcome is known, uses the remaining operation budget, and
has a `3,500 ms` fallback-work ceiling. Candidates may be hedged/concurrent, but the first accepted
snapshot cancels the rest. Per-provider rate-limit gates and circuit breakers remain independent.
Core does not sleep through `Retry-After` when it would exceed the request deadline.

These budgets approve the RP-001 proposals for warm, cold-primary, and stale paths and add an
explicit degraded no-stale ceiling. They are release gates for repeated `RP-005` measurements, not
claims that an external service always meets an SLA.

## Public provenance and safe diagnostics

`DetailsResponse.meta` gains additive snapshot provenance in the next joint minor release:

```ts
interface MetadataSnapshotMeta {
  route: "primary" | "fallback";
  freshness: "fresh" | "stale";
  providers: string[];
  fetchedAt: string;
}

interface ResponseMeta {
  // Existing fields remain unchanged.
  metadata?: MetadataSnapshotMeta;
}
```

The field is optional at the type level so code compiled against `1.12.0` response fixtures remains
source-compatible. New details responses produced by the new orchestration always set it. A primary
snapshot has exactly one provider. A composite fallback lists every contributor in deterministic
order. A stale response preserves the route/providers/fetch time of the cached snapshot and changes
only `freshness` plus the existing `stale` flag.

Existing `providers`, `cached`, `stale`, `warnings`, and debug timings remain. Fallback and stale
responses add stable warning codes such as `METADATA_FALLBACK_USED` and `STALE_CACHE_FALLBACK`.
Provider failures use the existing normalized codes and phases. Public messages are fixed safe
summaries; they never contain a request URL, credential, raw upstream body, stack, internal host,
cache key, or arbitrary upstream error text. Full diagnostics may be recorded in server-owned
structured logs only after the same redaction rules.

`MediaDetails.sourceProviders` contains public provider attribution and exact safe external IDs.
Its optional URL is omitted for internal endpoints and credentialed/signed URLs. A stable public
provider record page may be exposed only when it contains no secret or user-specific token.

yaneMedia can keep deriving its existing `degraded` boolean from failures, warnings, and `stale`.
During `RP-016`, it may additionally treat `meta.metadata.route === "fallback"` as degraded; no
frontend DTO change is required in Media Engine `RP-004`.

## Error and HTTP behavior

- A verified provider miss followed by no valid fallback produces `details: null`; the repository
  API continues mapping that result to HTTP 404.
- If every attempted source failed operationally and no cache/fallback snapshot exists, Core throws
  `MediaEngineError("PROVIDER_ERROR")`; the repository API maps it through its existing safe error
  boundary.
- Identity/type/release contradictions fail closed. They are never returned as a different work and
  never cached.
- Partial untyped search may return verified results from a healthy media class with degraded
  diagnostics for the failed class.
- Invalid caller queries remain `INVALID_QUERY`. Caller cancellation remains cancellation and is
  not rewritten as provider failure.

## Configuration and credential boundary

- Official TMDB credentials are required server-owned configuration for the movie/series primary.
  They are passed only to the Providers adapter and never enter Core queries, SDK types, HTTP
  responses, cache keys, or logs.
- Shikimori GraphQL requires a server-owned application `User-Agent` that identifies the OAuth
  application as required by its API policy. Browser impersonation is not allowed.
- Missing primary configuration is visible in provider readiness. It does not prevent process
  startup when configured fallback can operate, but every affected request is degraded.
- Provider adapters own endpoint construction, HTTP safety, response-size limits, schema parsing,
  rate-limit interpretation, and raw-error redaction.
- TMDB attribution/non-endorsement and the unresolved commercial-use confirmation for Shikimori are
  release obligations. They must be recorded before `RP-015`; they do not belong in Core payloads.

## Ownership boundaries

| Layer              | Owns                                                                                                                                                  | Must not own                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core               | route policy, mandatory-field validation, coherent snapshot rules, cache/SWR, deadlines, retry/fallback orchestration, normalized provenance/errors   | credentials, provider endpoints, yaneMedia `work_*` persistence or UI policy |
| Providers          | official TMDB and Shikimori GraphQL transport/mapping, server configuration inputs, schema and identity checks, rate-limit handling, safe attribution | cross-provider orchestration, public HTTP DTOs, app registry                 |
| SDK                | typed transport for the released Core/API response including optional provenance                                                                      | provider secrets, fallback decisions, response reinterpretation              |
| Repository API     | environment parsing, provider construction, OpenAPI/HTTP error mapping, readiness and server logs                                                     | app-specific canonical routes or user data                                   |
| yaneMedia backend  | durable canonical registry/redirects, `work_*` routes, app DTO mapping, persistence safety, app cache/queueing                                        | duplicate provider selection or raw upstream handling                        |
| yaneMedia frontend | display/loading/degraded UX and existing canonical client contracts                                                                                   | credentials, provider calls, identity or fallback orchestration              |

## Compatibility and release impact

Canonical external IDs, Core identity resolution, and yaneMedia `work_*` identities do not change.
Search results still carry provider-neutral `MediaItem` data; details still return
`MediaDetails | null`. Existing cache and app DTO adapters remain structurally compatible.

The optional `ResponseMeta.metadata` field and new provider adapters are additive, so the intended
joint package change is a minor release rather than a major identity migration. If the repository
HTTP response begins serializing the new field, `MEDIA_ENGINE_API_CONTRACT_VERSION` must advance
according to [versioning.md](versioning.md). Exact versions are chosen only during release
preparation in `RP-015`.

## RP-004 implementation gate

`RP-004` must cover at least these focused contracts before live acceptance:

- class routing for movie, series, anime series, anime film, and split-season anime;
- one blocking primary and zero fallback calls on a healthy details response;
- Russian title/description, poster/backdrop, year, stable identity, and release validation;
- fresh hit, immediate stale response, one coalesced background refresh, and expired-stale behavior;
- primary missing field, miss, timeout, rate limit, malformed payload, auth/config failure, and
  cancellation;
- exact fallback identity, type, and release rejection, including contradictory IDs;
- no English AniList text replacing required Russian fields;
- composite fallback conflict rejection and complete provenance;
- shared retry timeout, fallback ceiling, abort propagation, and loser cancellation;
- safe public diagnostics with credential, URL, body, and raw-error redaction;
- unchanged canonical IDs through Core, repository API, SDK, and yaneMedia fixture boundaries.

The live portion reuses the RP-002 matrix plus missing work, wrong identity/type/release, cold,
fresh, stale, and partial-outage cases. `RP-005` owns repeated performance/resilience acceptance
against the budgets above.

## Acceptance mapping

- **One normal details request has one blocking primary:** fixed by class routing and the primary
  snapshot rule.
- **Fallback cannot silently mix identities or media types:** fixed by exact-anchor validation,
  conflict rejection, and explicit contributor provenance.
- **Russian language and artwork are testable:** mandatory field tables define pass/fail behavior.
- **Canonical identity remains compatible:** no identity/key migration; only additive provenance.
- **Ownership boundaries are documented:** Core, Providers, SDK, repository API, and yaneMedia are
  separated above.

No production code changed in `RP-003`. After user acceptance, the program checkpoint advances to
`RP-004` — direct primary metadata implementation. `RP-004` must not start without a separate
explicit command.
