# Parser Release Hardening

## Goal

This document tracks the provider/parser quality work required before the first npm pre-release.

The release target is not "perfect for every title". The target is a reliable `0.x` parser package that works well for popular movies, series, and anime, with honest best-effort behavior for live no-token providers.

## Quality Targets

Before publishing, the parser/provider layer should satisfy these targets:

- popular title searches return the expected release in top 1 or top 3;
- broad `Any` searches do not starve series or anime behind movie-only results;
- search results include useful `type`, `year`, `ids`, `poster`, `ratings`, and `genres` when the providers expose them;
- details responses fill core fields such as `description`, `ratings`, `runtimeMinutes`, `status`, `episodesCount`, `seasonsCount`, `countries`, and `persons` when available;
- details payloads stay practical and do not return unbounded arrays from noisy providers;
- provider failures are visible as `ProviderFailure` metadata instead of crashing partial search when at least one provider succeeds;
- npm packages expose stable root imports and pack only useful compiled files.

## Golden Query Set

The first live smoke suite should cover:

- Movies: `Interstellar`, `The Matrix`, `Avatar`, `Dune`, `Harry Potter`, `Fight Club`
- Series: `Game of Thrones`, `Breaking Bad`, `Dark`, `House of the Dragon`, `The Last of Us`
- Anime: `Naruto`, `One Piece`, `Death Note`, `Attack on Titan`, `Fullmetal Alchemist`
- Ambiguous: `game of`, `avatar`, `one piece`, `dark`, `dune`

The list is intentionally small enough to run locally, but broad enough to catch ranking, type, and mapping regressions.

## Live Smoke Tooling

Use the live provider smoke command:

```bash
pnpm smoke:providers
```

This command is separate from `pnpm release:check` because it depends on live third-party services. It should be run manually before release and whenever provider ranking/mapping changes.

For release blocking behavior:

```bash
pnpm smoke:providers -- --strict
```

Strict mode exits non-zero when a required expectation fails.

## Implementation Plan

1. Add the live smoke tooling and golden query set.
2. Run the golden queries and record concrete parser quality gaps.
3. Fix provider mapping, ranking, and fallback behavior based on observed gaps.
4. Limit heavy details fields such as large `images`, `persons`, and episode arrays.
5. Add focused tests for each fixed parser behavior.
6. Add or document provider HTTP resilience: timeout, retry/backoff, rate-limit mapping, and optional cache strategy.
7. Audit npm package exports, tarball contents, README quickstarts, and versioning.
8. Run final checks: `pnpm release:check`, `pnpm smoke:providers -- --strict`, `pnpm smoke:availability -- --strict`, `pnpm pack:check`, and Docker API/example smoke.

## Current Known Fixes

- Broad `game of` search now ranks `Game of Thrones` first.
- Cinemeta search enriches sparse catalog results with meta details for ratings and genres.
- Cinemeta series details map `status`, `episodesCount`, and `seasonsCount`.
- Details merge fills status and counters from secondary providers when primary details lack them.
- Details merge skips `unknown` lifecycle status when another provider has a meaningful status.
- `MediaEngine.search` widens provider search limits internally before applying the public response limit.
- Provider HTTP calls retry retryable failures with a short backoff and still expose final failures through `ProviderFailure`.
- KinoBD and Cinemeta details now limit heavy `images` and `persons` arrays through provider options.
- KinoBD/ReYohoho streaming availability filters noisy non-playback providers such as Netflix, torrent, trailers, and YouTube by default.
- KinoBD/ReYohoho streaming candidate scoring prefers exact IDs, matching type, matching year/range, title identity, and popularity tie-breakers.
- Availability smoke asserts expected item identity, player kind, episode grouping, and known broken-player regressions.
- Provider package dry-run checks are available through `pnpm pack:check`.

## Release Notes

Do not claim perfect parser coverage. The first release should describe live metadata providers as best-effort integrations and recommend local IMDb datasets when stronger metadata guarantees are needed.

The broader parser-plus-player roadmap is tracked in `docs/15-next-implementation-plan.md`.
