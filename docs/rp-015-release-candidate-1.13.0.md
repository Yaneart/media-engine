# Media Engine 1.13.0 release candidate

Status: release gates passed; awaiting user commit and publication on 2026-10-08.

## Scope

This joint Core/Providers/SDK release combines the accepted fast Russian-first metadata milestone
(`RP-001` through `RP-005`) with the accepted Kodik streaming lane (`RP-007`, `RP-008`, and the
narrow `RP-014` rollout gate).

Public package version: `1.13.0`. REST/OpenAPI contract version: `0.20.0`.

There are no intended breaking changes. Metadata provenance, streaming discovery/upstream
provenance, observation attribution, and the direct Kodik provider are additive. Existing
credential-free streaming providers remain configured as before. The repository API adds Kodik
only when a server-owned `KODIK_API_KEY` is present.

## Release highlights

- Official TMDB is the primary movie/series metadata source and Shikimori GraphQL is the primary
  anime source, with coherent Russian snapshots, verified bounded fallback, and 5+30 minute
  fresh/stale caching.
- Search and details no longer wait for KinoBD on the healthy primary metadata path.
- Complete official-primary search cards and details snapshots no longer wait for optional
  cross-catalog identity expansion; verified resolution remains available for fallback, legacy-ID,
  streaming, and torrent paths.
- Streaming options distinguish discovery adapters from real upstream players and deduplicate exact
  targets while retaining every observation.
- Direct Kodik supports exact Kinopoisk/IMDb/Shikimori lookup, translations, movie/series/anime
  routing, exact episodes, and split anime releases with safe server-only credentials.
- Direct Kodik becomes observable before a degraded KinoBD aggregate deadline and remains available
  when that aggregate fails.
- Public TMDB and KinoBD metadata fallbacks have separate 1.5-second and 1-second caps so one stalled
  source cannot consume the complete fallback window before a later provider is tried.

## Verification

- `pnpm release:check` passed, including clean builds, lint, type checks, package coverage, API unit
  and e2e tests, release consistency, and clean dry package contents.
- `pnpm smoke:primary-metadata` passed the complete movie, series, and anime details/search matrix.
- `pnpm smoke:metadata-resilience` passed five iterations after the primary-path correction: cold
  details p95 273 ms, cold search p95 969 ms (1,410 ms maximum), warm/stale p95 1/2 ms, and
  degraded p95 3,343 ms against a 6,000 ms budget.
- `pnpm smoke:kodik` passed 15 positive, coverage, and negative cases.
- `pnpm smoke:streaming-rollout` observed direct Kodik at 631 ms, warm cache at 1 ms, isolated the
  bounded KinoBD timeout, and retained both direct and aggregate attribution during deduplication.

## Operator configuration

- `TMDB_API_KEY`: server-only official TMDB credential.
- `MEDIA_ENGINE_SHIKIMORI_USER_AGENT`: identifying server-side User-Agent.
- `KODIK_API_KEY`: optional provider-issued Kodik token; never expose it through `VITE_` variables.

## User-owned publication sequence

After accepting the release candidate and committing its files, the user runs the repository's
normal push/tag workflow and publishes in dependency order:

```text
@media-engine/core@1.13.0
@media-engine/providers@1.13.0
@media-engine/sdk@1.13.0
```

Codex does not stage, commit, push, tag, or publish. yaneMedia must not upgrade until all three exact
versions are confirmed on npm.
