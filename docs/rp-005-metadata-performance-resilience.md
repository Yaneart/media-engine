# RP-005 metadata performance and resilience gate

Status: accepted

Accepted: 2026-10-07

Measured: 2026-10-07

Branch: `feature/resilient-sources`

This gate measures the direct metadata routing implemented in `RP-004` against the budgets fixed by
the [RP-003 contract](rp-003-primary-metadata-contract.md). It covers the complete eleven-work
acceptance matrix five times for typed search and details, then exercises warm cache, verified stale
responses during an injected primary outage, and foreground fallback without stale data.

## Result

All accepted budgets passed. Every final healthy cold sample requested only `tmdb-official` for
movies/series or only `shikimori-graphql` for anime. KinoBD did not participate in the healthy
critical path.

| Path                       | Samples | Minimum |    p50 |      p95 |  Maximum |   Budget |
| -------------------------- | ------: | ------: | -----: | -------: | -------: | -------: |
| Details, cold primary      |      55 |  106 ms | 222 ms |   568 ms |   647 ms | 2,500 ms |
| Details, warm cache        |      55 |    0 ms |   1 ms |     1 ms |     2 ms |   100 ms |
| Details, stale under fault |      55 |    1 ms |   1 ms |     1 ms |     1 ms |   250 ms |
| Search, cold primary       |      55 |  232 ms | 802 ms | 1,637 ms | 1,753 ms | 2,500 ms |
| Search, warm cache         |      55 |    0 ms |   1 ms |     1 ms |     2 ms |   100 ms |
| Search, stale under fault  |      55 |    1 ms |   1 ms |     1 ms |     1 ms |   250 ms |
| Details, no-stale fallback |      10 |  316 ms | 761 ms | 1,945 ms | 1,945 ms | 6,000 ms |

The no-stale fault matrix injected a retryable failure into the selected primary. Interstellar
recovered through indirect `tmdb`; Death Note recovered through `shikimori`. Every result remained
complete, Russian-localized, identity-compatible, and explicitly reported fallback provenance.

The separate primary metadata smoke also passed all five TMDB and six anime details plus localized,
original-title, and alternative-title searches. Its final observed provider calls were 110–703 ms.

## Comparison with RP-001

The dated `RP-001` production sample had search p95 10,777 ms and details p95 7,705 ms, with zero
Engine cache hits. The accepted route now measures search cold-primary p95 at 1,637 ms (about 6.6x
faster) and details cold-primary p95 at 568 ms (about 13.6x faster). Both warm paths now measure 1 ms
p95. `RP-001` could not seed a live stale response during the KinoBD outage; this gate proves both
routed search and details return verified stale data in 1 ms p95 while a coalesced refresh runs.

These are dated external-network measurements, not an upstream availability guarantee. Exploratory
runs did observe transient direct-primary timeouts. The production provider set recovered useful
details through fallback in 2,808–4,210 ms, still inside the accepted degraded budget and without
placing KinoBD on the normal path.

## Regressions found and corrected

The gate found two routed-search regressions left by `RP-004`:

1. Search used the cache adapter's default TTL and waited for primary failure before returning stale
   data. Core now explicitly owns the five-minute fresh plus thirty-minute stale window, returns a
   verified stale response immediately, and coalesces one background refresh.
2. Several distinct exact-title TMDB results caused legacy-provider disambiguation even though the
   direct primary had already returned valid search candidates. Routed search now preserves those
   separate identities without waiting for legacy discovery. Legacy non-routed search behavior is
   unchanged.

Focused regression tests cover both behaviors. Public diagnostics remain normalized and contain no
credential, internal URL, raw response, or upstream error text.

## Reproduction

Load the two ignored local server-side settings into the process without printing them, then run:

```powershell
pnpm smoke:metadata-resilience
pnpm smoke:primary-metadata
```

The resilience command defaults to five iterations. A shorter diagnostic run can use
`pnpm smoke:metadata-resilience -- --iterations 2`.

Focused verification for the changed Core path:

```powershell
pnpm --filter @media-engine/core build
node --test packages/core/dist/engine/engine.metadata-routing.test.js `
  packages/core/dist/engine/engine.search.fallback.test.js
```

## Decision

`RP-005` is ready for acceptance. No metadata latency, cache, identity, localization, artwork, or
KinoBD critical-path blocker remains in the measured matrix. `RP-006` must not start until the user
accepts this checkpoint and starts the next task explicitly.
