# Resilient metadata and streaming sources

## Status

- Program status: the fast metadata milestone (`RP-001` through `RP-005`) is accepted; the
  direct-streaming audit (`RP-006`) is complete.
- `RP-007` streaming provenance and deduplication was accepted on 2026-10-08.
- Current task: `RP-008` direct Kodik, awaiting a separate explicit start command.
- The user has supplied a working provider-issued Kodik token. All other credentialed direct
  providers remain paused; no adapter may use leaked, shared, or third-party tokens.
- Current published Core/Providers/SDK version: `1.12.0`.
- yaneMedia integration starts only after the new Media Engine packages are published.
- Ratings and comments work in yaneMedia remains paused until this program is accepted.

This is the authoritative execution plan for the cross-repository resilience work agreed on
2026-10-06. The work starts in `media-engine`, finishes with a jointly versioned npm release, and
then continues in `yaneMedia` with an exact package upgrade and browser acceptance.

## Product goals

1. Return Russian-first `title`, `description`, `poster`, and `backdrop` through a fast, coherent
   metadata path.
2. Remove KinoBD from the critical path for metadata and from the role of a single point of failure
   for several streaming players.
3. Prefer direct, documented upstream integrations. Aggregators remain bounded fallbacks where they
   still add independent value. Additional direct streaming integrations are a later milestone and
   do not block the metadata release.
4. Preserve canonical identity, anime release shape, exact episode mapping, partial-success
   semantics, safe diagnostics, and yaneMedia user data.
5. Publish a stable Core/Providers/SDK version before yaneMedia consumes any new contract.

## Required metadata behavior

- Russian output is a release requirement, not an optional enrichment.
- A normal successful details request waits for one selected primary metadata provider for its media
  class. Unrelated providers must not extend the critical response time.
- The primary response is one coherent snapshot. Core title, description, artwork, type, year, and
  identity are not assembled from conflicting works returned by several providers.
- A fallback provider runs only when the primary source fails, has no matching work, or misses fields
  declared mandatory by the accepted contract.
- Cache and stale-while-revalidate behavior must let a temporary upstream failure reuse a previously
  verified snapshot without presenting stale data as fresh.
- Search results must retain enough verified identity to open details without repeating an avoidable
  multi-provider identity chain.
- Provider-specific payloads, credentials, internal URLs, and raw errors do not cross the public
  Core/SDK or yaneMedia HTTP boundary.

The likely movie/series candidate is the official TMDB API with `ru-RU` localization and a
server-owned read token. It is not accepted in advance. `RP-002` must compare its actual Russian
coverage, artwork, identity, latency, rate limits, and failure behavior with the current path. Anime
may use a different primary source if one global provider cannot meet the Russian and canonical
season requirements.

## Required streaming behavior

This section remains the contract for the streaming milestone. Only the Kodik lane is currently
resumed; other credentialed adapters remain paused. Streaming changes are not part of the existing
metadata-only `RP-015` scope unless the user explicitly revises that release decision.

- Direct providers are independent calls. Failure of KinoBD or DDBB must not remove an otherwise
  healthy direct option.
- Normalized output distinguishes the adapter that discovered an option from the real upstream
  player so direct and aggregate copies can be deduplicated.
- Direct integration requires a current first-party contract or an explicitly user-owned credential
  and must have bounded requests, response parsing, timeouts, cancellation, rate-limit handling,
  attribution, and live evidence.
- A constructed iframe without an honest availability signal stays `unknown`; a successful outer
  HTML shell is not treated as proven playback.
- Movie, series, anime film, and episodic anime routing remain separate. Exact episode providers must
  prove work and episode identity before returning playback.
- KinoBD may remain as a lower-priority fallback after direct sources are accepted.

## Acceptance matrix

The audit may add cases, but it cannot remove these without an explicit user decision:

- movies: Interstellar, Parasite, Spirited Away;
- series: Game of Thrones, Breaking Bad, Shogun;
- episodic anime: Death Note, Frieren, Solo Leveling, Jujutsu Kaisen, and one split-season title;
- Russian and original-title search aliases;
- a missing work, a wrong identity, a wrong episode, and a provider timeout;
- cold request, warm cache, stale fallback, and partial provider outage;
- metadata field completeness and language;
- embed, HLS, and MP4 options as separate playback classes.

Latency targets are set in `RP-001` from a reproducible baseline and approved in `RP-003`. The plan
does not invent a target before measuring the current cold, warm, median, and tail behavior.

## Task sequence

### RP-001 — baseline and dependency audit

Map the current search, details, identity, availability, cache, timeout, and fallback paths in
Media Engine 1.12.0 and the consuming yaneMedia runtime. Record which external calls are required,
which are optional, and which can hold the final response open. Measure cold and warm latency and
capture current KinoBD-down behavior on the acceptance matrix.

Evidence: [RP-001 baseline and dependency audit](rp-001-baseline-audit.md).

Acceptance:

- a provider/dependency graph covers metadata and streaming separately;
- measurements identify the critical path and provider-level latency/failure contribution;
- current direct, aggregate, credentialed, and indirect sources are classified;
- no production behavior changes;
- the evidence and the next checkpoint are recorded before the user commit.

### RP-002 — Russian metadata source evaluation

Evaluate primary metadata candidates with direct current contracts. At minimum evaluate official
TMDB for movies/series, the current anime sources, and the existing production path. Verify Russian
title and description coverage, poster/backdrop quality, external IDs, type and season correctness,
rate limits, credential model, latency, cacheability, and failure semantics. Do not reuse the
current `tmdb.stremio.ru` adapter as evidence for direct TMDB behavior.

Acceptance:

- every candidate has repeatable results for the metadata portion of the matrix;
- Russian coverage and missing-field behavior are explicit;
- the decision selects one primary source per media class or rejects the available candidates;
- each rejected or deferred source has an evidence-based reason;
- required user-owned credentials and terms are known before implementation.

### RP-003 — primary metadata and fallback contract

Specify the public and internal contract before implementation: provider selection by media class,
mandatory fields, coherent snapshot rules, fallback triggers, provenance, cache lifetime,
stale-while-revalidate, timeout budget, retry behavior, and safe diagnostics. Define approved cold,
warm, and degraded latency budgets from the baseline.

Acceptance:

- one normal details request has one blocking primary provider;
- fallback cannot silently mix identities or media types;
- Russian language and artwork requirements are testable;
- existing canonical identity remains compatible or has an explicit versioned migration;
- Core, Providers, SDK, repository API, and yaneMedia ownership boundaries are documented.

### RP-004 — direct primary metadata implementation

Implement the accepted provider or providers, server-side configuration, normalized mapping, safe
transport, caching, fallback selection, and focused contract tests. Remove superseded indirect
metadata sources from the default critical path only after equivalent required fields are proven.

Acceptance:

- the matrix returns the accepted Russian metadata contract;
- a healthy primary response does not wait for unrelated providers;
- missing, timeout, rate-limit, malformed, and cancellation cases follow `RP-003`;
- credentials remain server-side and logs contain no tokens or upstream payloads;
- focused package and API checks pass.

### RP-005 — metadata performance and resilience gate

Run the reproducible cold/warm/degraded matrix repeatedly, compare it with `RP-001`, and correct any
cache, timeout, identity, localization, or artwork regressions. This task is complete only when the
approved latency budgets and Russian field requirements are met without KinoBD in the critical
metadata path.

Evidence: [RP-005 metadata performance and resilience gate](rp-005-metadata-performance-resilience.md).

### RP-006 — direct streaming source audit

Revalidate existing providers and investigate current direct contracts for Kodik, Alloha, Collaps,
VideoCDN, Vibix, HDVB, Videoseed, Videasy, VidCore, APIPlayer, and any stronger first-party candidate
found during research. Classify each as `implement`, `requires credentials`, `defer`, or `reject`.
Research includes identity inputs, movies/series/anime coverage, episode selection, translations,
availability truthfulness, iframe policy, output type, rate limits, latency, and maintenance risk.

Status: complete. Evidence is recorded in
[RP-006 direct streaming source audit](rp-006-direct-streaming-source-audit.md); official access
steps are recorded separately in
[provider access onboarding](rp-006-provider-access-onboarding.md). Credential-gated integrations
remain paused until provider-issued access is available.

### RP-007 — streaming provenance and deduplication contract

Add the minimum normalized distinction between discovery adapter and actual upstream player. Define
stable deduplication and priority rules so the same Kodik, Alloha, Collaps, or VideoCDN player found
directly and through KinoBD appears once while retaining attribution and degradation evidence.

Status: accepted on 2026-10-08. Evidence is recorded in
[RP-007 streaming provenance and deduplication](rp-007-streaming-provenance-deduplication.md).

### RP-008 — direct Kodik provider (conditional)

Implement as a separate task only if `RP-006` confirms a current supported contract and the user has
the required access. Cover external-ID lookup, translations, series/anime episodes, bounded parsing,
and aggregate/direct deduplication.

Status: credential and `RP-007` prerequisites satisfied; awaiting a separate explicit start command.

### RP-009 — direct Alloha provider (conditional)

Implement and accept independently under the same evidence and safety requirements.

Status: paused pending an official user-owned credential and current provider contract.

### RP-010 — direct Collaps provider (conditional)

Implement and accept independently under the same evidence and safety requirements.

Status: paused; the audit rejected the current public contract. Reopen only with new first-party
evidence and official access.

### RP-011 — direct VideoCDN provider (conditional)

Implement and accept independently under the same evidence and safety requirements.

Status: paused; the audit rejected the old VideoCDN path. Re-evaluate only through a current
first-party Lumex/VideoCDN contract and official access.

### RP-012 — remove VeoVeo discovery dependence on DDBB

Find and implement a direct, identity-safe VeoVeo lookup path if its current contract permits it.
If no supported path exists, retain the dependency as an explicit operational risk rather than
copying a private or unstable discovery mechanism.

Status: paused with the streaming milestone; it does not block the metadata release.

### RP-013 — additional accepted direct providers

Create one separately accepted task per additional `implement` decision from `RP-006`. This slot is
not permission to bundle several unrelated adapters into one commit.

Status: paused pending official access and a separately accepted provider contract.

### RP-014 — aggregate fallback and progressive availability

Place accepted direct sources on independent primary paths, keep useful aggregators as bounded
fallbacks, and ensure early healthy options are observable without waiting for the slowest provider.
Verify deterministic ordering, deduplication, degradation, caching, and background refresh.

Status: paused with the streaming milestone; existing streaming behavior remains unchanged in the
metadata-only release.

### RP-015 — Media Engine release candidate and npm publication

Update versions and changelog, run the agreed full release gate and live matrix, inspect dry package
contents, and prepare exact release notes. The user alone stages, commits, pushes, tags, and publishes
Core, Providers, and SDK. yaneMedia work cannot start until the published versions are confirmed.

Current scope: release only the accepted `RP-001` through `RP-005` metadata work. Do not add, remove,
or reconfigure streaming providers in this release. The release candidate must re-run the focused
primary metadata smoke and resilience gate before the full release gate. A later streaming release
will receive its own version and acceptance cycle after the paused tasks resume.

### RP-016 — yaneMedia package and backend integration

Upgrade exact `@media-engine/*` versions and the lockfile, add server-owned configuration, adapt
app-owned DTO mapping where the accepted contract requires it, and preserve canonical registry,
redirects, favorites, history, progress, and safe diagnostics.

Current scope: integrate the published metadata contract and server-owned TMDB/Shikimori
configuration. Existing streaming configuration and playback behavior remain unchanged.

### RP-017 — yaneMedia frontend and playback integration

Use the released metadata and provenance behavior in search/details/player UI. Preserve progressive
source discovery, source labels, embed/direct handling, loading states, and narrow-screen behavior.
Make UI changes only where the released contract creates a real product difference.

Current scope: verify faster Russian search/details rendering and metadata provenance. No new player
or source UI is required for the metadata-only release.

### RP-018 — cross-repository acceptance and closeout

Run the approved automated and live matrix against published packages, then perform user browser
acceptance for desktop and mobile. Confirm Russian metadata, latency, player diversity, partial
outages, canonical user data, and absence of secret/provider payload exposure. Only then mark the
program complete and resume yaneMedia `B-033`.

## Per-task workflow and history

Each task above is implemented and accepted separately:

1. Restore the current repository memory and read this checkpoint.
2. Work only on the active task and run focused checks for its changed contracts.
3. Present evidence and any remaining operational limitation to the user.
4. After user acceptance, update the status at the top of this document and replace the checkpoint
   below with a concise record of the result, commands, decisions, blockers, and exact next task.
5. Update the active repository `reminders.md` once at task completion.
6. Stop. The user performs `git add`, `git commit`, and `git push` and starts the next task explicitly.

Release publication remains a user action. Codex never stages, commits, pushes, tags, or publishes
packages.

## Current checkpoint

`RP-005` was accepted on 2026-10-07. A reproducible five-iteration gate covers
the eleven-work matrix for cold/warm/stale search and details plus forced no-stale movie/anime
fallback. Final p95 values were 568 ms details cold, 1,637 ms search cold, 1 ms for every warm/stale
path, and 1,945 ms degraded; every approved budget passed. All 110 healthy cold samples requested
only the class primary, with no KinoBD on the critical path. The primary metadata smoke also passed
all details and localized/original/alternative-title searches.

The gate corrected two routed-search regressions: Core now owns the explicit five-minute fresh plus
thirty-minute stale window and returns stale search results immediately with one coalesced refresh;
distinct exact-title primary results no longer trigger slow legacy disambiguation. Focused search
and metadata-routing tests pass 28/28. Full evidence and reproduction commands are in
`docs/rp-005-metadata-performance-resilience.md`.

`RP-006` then audited the direct-streaming candidates. The user supplied and locally stored a
provider-issued Kodik token, and live authentication plus representative list/anime lookups passed.
Alloha, Vibix, VideoSeed, HDVB/Lumex, and the other credentialed candidates remain paused. Leaked or
shared keys remain explicitly outside the plan.

`RP-007` was accepted on 2026-10-08. It adds an additive provenance contract:
`StreamOption.provider` remains the discovery
adapter, `player.provider` identifies the normalized upstream player, and `discovery` distinguishes
direct from aggregate observations. Exact playback targets deduplicate independently of descriptive
translation/quality metadata, prefer stronger availability and then direct discovery, and retain
per-observation attribution. KinoBD options are marked as aggregate and expose their real player.
Focused Core and KinoBD checks pass; detailed evidence is in
`docs/rp-007-streaming-provenance-deduplication.md`.

The next separate task is `RP-008`, the direct Kodik adapter. `RP-015` remains deferred and its
metadata-only release scope is unchanged unless the user explicitly revises it.
