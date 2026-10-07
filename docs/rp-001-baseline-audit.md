# RP-001 baseline and dependency audit

Status: ready for user acceptance  
Measured: 2026-10-06  
Runtime: Media Engine `1.12.0` consumed by yaneMedia  
Branch: `feature/resilient-sources`

This is a read-only production-path audit. It changes documentation only; provider selection,
timeouts, caching, API contracts, and runtime behavior are unchanged.

## Executive result

The current runtime remains functionally useful while KinoBD is unavailable, but KinoBD is still
on the blocking path for movie/series search, details, and every selected streaming request. During
this capture, KinoBD returned only `PROVIDER_UNAVAILABLE` or timeout. All positive acceptance cases
still found playback, but every availability result was degraded and the normal endpoint commonly
waited the full 10-second KinoBD streaming timeout.

The current metadata architecture does not have one primary provider per media class. It fans out
to all matching providers and waits for all of them before merging. The provider named `tmdb` is an
indirect adapter to `tmdb.stremio.ru`, not the official TMDB API. These two findings are the main
inputs to `RP-002` and `RP-003`.

Warm response caching did not activate in the live sample: 14 search, 32 details, 13 related, and
18 availability operations all logged `cacheOutcome: miss`. Repeated calls sometimes became faster
because provider-local caches and the circuit breaker changed the work performed, not because the
Engine response cache returned a hit.

## Effective yaneMedia runtime

The consuming backend pins both `@media-engine/core` and `@media-engine/providers` to `1.12.0` and
creates one process-local Engine with:

| Setting                       |   Effective value |
| ----------------------------- | ----------------: |
| Metadata provider timeout     |          5,000 ms |
| Cinemeta timeout              |         15,000 ms |
| Streaming provider timeout    |         10,000 ms |
| VideoHUB timeout              |         20,000 ms |
| Identity total/source timeout | 10,000 / 5,000 ms |
| Fresh/stale cache lifetime    |    5 / 30 minutes |
| Cache capacity                |       500 entries |
| Circuit recovery interval     |         10,000 ms |

The yaneMedia provider set differs from the repository API defaults. This audit treats the yaneMedia
configuration as the product baseline because it is the runtime users consume.

## Dependency graph

### Metadata

```text
yaneMedia search
  -> Engine search cache
  -> all primary discovery providers in parallel
       movie/series: tmdb.stremio.ru + KinoBD + Cinemeta
       anime: Shikimori + AniList
  -> conditional title fallback: TVmaze / Wikidata
  -> blocking identity canonicalization (applicable identity sources, parallel by pass)
  -> blocking top-result field/poster enrichment
  -> merge/rank -> canonical registry -> HTTP response

yaneMedia details
  -> canonical registry/editorial aliases
  -> blocking identity resolution
       Wikidata + AniList + Shikimori + Shikimori cinema + Aderom as applicable
  -> all metadata providers compatible with the resolved IDs/type in parallel
  -> optional second anime pass after AniList reveals a MAL ID
  -> merge -> second identity resolution -> cache -> HTTP response
```

Search fallback providers are conditional, but every selected primary provider holds the response
open. Details likewise waits for every selected provider. Identity calls are required whenever the
known IDs allow a source to add another namespace; their latency is included in operation totals but
not in provider timing diagnostics.

### Streaming

```text
yaneMedia availability request
  -> blocking details request
  -> optional anime related-media/season-chain requests
  -> Engine streaming identity validation/resolution
  -> optional metadata search when a required streaming ID is still missing
  -> all compatible streaming providers in parallel
       Aderom, Initem, KinoBD, DDBB, AniLiberty, VeoVeo, VideoHUB
  -> wait for all -> merge -> HTTP response
```

The progressive Engine API emits usable snapshots as providers finish. yaneMedia exposes it through
SSE, but it still performs the blocking details and anime-season preparation before starting the
streaming fan-out. The non-progressive endpoint waits for every selected provider.

## Current source classification

Classification describes the implemented network topology, not a fresh approval of provider terms
or contracts. That research belongs to `RP-002` and `RP-006`.

### Metadata and identity

| Adapter/source | Current upstream                     | Classification                  | Blocking role                                            |
| -------------- | ------------------------------------ | ------------------------------- | -------------------------------------------------------- |
| `tmdb`         | `tmdb.stremio.ru`                    | indirect metadata addon         | primary movie/series search; selected details            |
| `kinobd`       | `kinobd.net`                         | aggregate/indirect metadata     | primary movie/series search; selected details            |
| `cinemeta`     | `v3-cinemeta.strem.io`               | indirect metadata addon         | primary movie/series search; selected details            |
| `shikimori`    | Shikimori API                        | direct public metadata          | primary anime search/details/relations                   |
| `anilist`      | AniList GraphQL                      | direct public metadata          | primary anime search/details/relations                   |
| `tvmaze`       | TVmaze API                           | direct public metadata          | conditional search fallback; selected series details     |
| `wikidata`     | Wikidata API                         | direct public metadata/identity | conditional search fallback; identity/details enrichment |
| identity chain | Wikidata, AniList, Shikimori, Aderom | mixed direct and indirect       | blocking when applicable                                 |

No credentialed metadata provider is enabled. In particular, the current `tmdb` adapter does not use
an official user-owned TMDB token.

### Streaming

| Adapter                | Classification            | Dependency/role                                                  |
| ---------------------- | ------------------------- | ---------------------------------------------------------------- |
| `aderom-streaming`     | direct adapter            | Aderom API/embed; may query Wikidata to bridge IMDb to Kinopoisk |
| `initem-streaming`     | direct adapter            | validates an Initem embed page by IMDb/Kinopoisk                 |
| `kinobd-streaming`     | aggregate                 | discovers several upstream iframe players through KinoBD         |
| `ddbb-streaming`       | aggregate                 | returns and validates several upstream players through DDBB      |
| `aniliberty-streaming` | direct adapter            | title-matched anime HLS and exact episodes                       |
| `veoveo-streaming`     | hybrid/indirect discovery | DDBB discovers the VeoVeo ID; VeoVeo supplies HLS                |
| `videohub-streaming`   | direct adapter            | Kinopoisk-keyed playlist and HLS/MP4 resolution                  |

No credentialed streaming provider is enabled in yaneMedia. Filmix supports a token in the
repository API configuration but is disabled in this runtime.

Normalized output records the discovery adapter as `provider`, but does not separately identify the
actual upstream player. Consequently, a player found directly and through KinoBD/DDBB cannot yet be
reliably deduplicated by upstream identity; this is the contract gap reserved for `RP-007`.

## Live measurements

Measurements came from a freshly rebuilt yaneMedia compose stack using the real provider network,
followed by the full platform probe, a focused anime matrix, negative requests, and repeated
Parasite requests. Provider diagnostic JSON was aggregated from the backend logs. These are one
dated external-network samples, not service-level guarantees.

### Operation latency and cache outcome

| Operation     | Samples |  Minimum |       p50 |       p95 |   Maximum | Engine hits/misses/stale |
| ------------- | ------: | -------: | --------: | --------: | --------: | -----------------------: |
| Search        |      14 | 4,309 ms |  6,109 ms | 10,777 ms | 10,777 ms |               0 / 14 / 0 |
| Details       |      32 |   326 ms |  4,564 ms |  7,705 ms |  8,264 ms |               0 / 32 / 0 |
| Related media |      13 |   372 ms |    384 ms |    398 ms |    398 ms |               0 / 13 / 0 |
| Availability  |      18 |     3 ms | 10,005 ms | 14,535 ms | 14,535 ms |               0 / 18 / 0 |

The very short minima are circuit-open/fast-empty calls, not warm response-cache hits.

### Provider contribution

| Operation/provider        | Samples |      p50 |       p95 | Observed result                       |
| ------------------------- | ------: | -------: | --------: | ------------------------------------- |
| Search / KinoBD           |       8 |     4 ms |  5,002 ms | 3 timeout, 5 unavailable, 0 success   |
| Search / indirect TMDB    |      10 |   732 ms |  5,014 ms | 7 success, 1 empty, 2 timeout         |
| Search / Cinemeta         |      10 | 1,423 ms |  3,787 ms | 10 success                            |
| Search / Shikimori        |       6 | 1,683 ms |  2,376 ms | 6 success                             |
| Search / AniList          |       6 |   614 ms |  1,462 ms | 5 success, 1 empty                    |
| Details / KinoBD          |      32 |     9 ms |  5,003 ms | 11 timeout, 21 unavailable, 0 success |
| Availability / KinoBD     |      18 | 9,999 ms | 10,003 ms | 11 timeout, 7 unavailable, 0 sources  |
| Availability / DDBB       |       9 | 2,891 ms |  3,423 ms | 9 success, 34 accepted sources total  |
| Availability / Initem     |       9 |   837 ms |    923 ms | 9 success, 9 sources total            |
| Availability / AniLiberty |       9 |   688 ms |  3,566 ms | 4 success, 5 empty                    |
| Availability / VeoVeo     |      18 | 1,394 ms |  3,110 ms | 9 success, 9 empty                    |
| Availability / VideoHUB   |      16 |   616 ms | 12,512 ms | 3 success, 10 empty, 3 timeout        |

### Cold/repeat pairs

| Path                  |     First | Immediate repeat | Interpretation                                                 |
| --------------------- | --------: | ---------------: | -------------------------------------------------------------- |
| Parasite search       | 10,434 ms |         5,049 ms | both Engine misses; circuit/provider state reduced repeat work |
| Parasite details      |  8,555 ms |           740 ms | both Engine misses; KinoBD failed fast on repeat               |
| Parasite availability | 10,924 ms |         7,933 ms | both Engine misses and degraded                                |

Core unit contracts confirm that healthy metadata/search responses can be cached, metadata may use
stale data only after a previously healthy entry and an all-retryable failure, and streaming links
never use stale cache. A live stale response could not be seeded during the KinoBD-down sample.

## Acceptance matrix result

The platform probe passed canonical Russian/original-title aliases, canonical pre-save resolution,
details, and expected playback for its seven scenarios. Durations include search aliases, details,
and one or two availability requests.

| Scenario                    | Result | Playback                              | End-to-end duration |
| --------------------------- | ------ | ------------------------------------- | ------------------: |
| Death Note                  | pass   | embed + HLS, 7 sources                |           44,945 ms |
| Frieren                     | pass   | embed + HLS + MP4, 123 sources        |           43,146 ms |
| Spirited Away               | pass   | embed + HLS + MP4, 18 sources         |           17,409 ms |
| Game of Thrones             | pass   | embed + HLS, 79 sources               |           40,831 ms |
| Shogun                      | pass   | embed, 4 sources                      |           33,824 ms |
| Interstellar                | pass   | embed + HLS, 6 sources                |           18,377 ms |
| Breaking Bad                | pass   | embed + HLS, 67 sources               |           29,261 ms |
| Parasite                    | pass   | Russian details and embed/HLS sources | measured separately |
| Solo Leveling S1E1          | pass   | 4 direct sources                      |           19,872 ms |
| Jujutsu Kaisen S1E1         | pass   | 3 direct sources                      |           24,101 ms |
| Re:Zero S2E14 / absolute 39 | pass   | 30 VideoHUB direct sources            |           17,227 ms |

Negative cases also failed closed:

- unknown `imdb:tt0000000`: HTTP 404 after 2,323 ms;
- Frieren season 99, episode/absolute 999: HTTP 200 with zero sources and `degraded: true`
  after 3,137 ms; no mismatched episode was returned.

Every positive availability response was degraded because at least KinoBD failed. The exact source
counts are volatile external evidence and are not contractual minima.

## Baseline findings for later tasks

1. Movie/series search and details still treat KinoBD as blocking, and normal availability waits for
   it even when independent sources are already ready.
2. Metadata uses fan-out-and-merge rather than one coherent primary snapshot. A slow unrelated
   provider can extend the response and fields may come from several upstream records.
3. `tmdb` is an indirect Stremio addon whose own p95 reached its 5-second timeout. `RP-002` must test
   the official TMDB API independently before selection.
4. Retryable partial failure prevents Engine response caching; sustained degradation therefore
   repeats external work and keeps the supposed warm path cold.
5. yaneMedia availability adds blocking details and, for anime, related-media preparation before
   streaming discovery begins.
6. Progressive streaming improves time-to-first-source only after that preparation. The ordinary
   endpoint has no early-success boundary.
7. Provider diagnostics omit identity-source timing, so total latency can materially exceed the
   slowest visible provider timing.
8. Streaming provenance identifies the adapter, not the real upstream player, preventing reliable
   direct-versus-aggregate deduplication.
9. VeoVeo playback is independent, but its discovery still depends on DDBB.
10. VideoHUB can contribute a separate tail up to 12.5 seconds in this sample and needs its own
    bounded progressive behavior even after KinoBD is removed from the critical path.

## Candidate budgets for RP-003 approval

These are baseline-driven proposals, not active contracts:

| Path                                               |                                          Proposed budget |
| -------------------------------------------------- | -------------------------------------------------------: |
| Warm search/details from Engine cache              |                                            p95 <= 100 ms |
| Cold primary metadata request                      |                                          p95 <= 2,500 ms |
| Degraded metadata with a verified stale snapshot   |                                            p95 <= 250 ms |
| Progressive time to first verified playback source |                                          p95 <= 3,000 ms |
| Final streaming aggregation                        | p95 <= 10,000 ms, without delaying first-source delivery |

`RP-002` must first measure official metadata candidates; `RP-003` may then accept or revise these
budgets.

## Reproduction and verification

Commands used:

```powershell
docker compose up --build -d
npm.cmd run probe:media-platform
$env:MEDIA_PROBE_IDS='151807,113415,119661'
$env:MEDIA_PROBE_CONCURRENCY='2'
npm.cmd run probe:anime-matrix
```

The first command and probes ran from `C:\Users\artem\yaneMedia`; the focused contract tests ran
from `C:\Users\artem\media-engine\packages\core`:

```powershell
node --test dist/engine/engine.details.test.js `
  dist/engine/engine.search.fallback.test.js `
  dist/engine/engine.availability.test.js
```

Focused result: 67 tests passed. The live platform probe and three-case anime matrix passed. No full
repository gate was run because this task changes documentation only.

## Next checkpoint

After user acceptance and the user's commit, start `RP-002` as a separate task. Do not implement a
metadata provider during `RP-002`; it is an evidence-only comparison of official TMDB, current anime
sources, and the existing production path.
