# Identity Resolver contract (ID-02)

The internal identity model lives in `packages/core/src/identity`. This step does not change
the public `media.id` or the current merge and query flow. ID-03 will orchestrate sources using
this contract; ID-04 will supply actual mappings.

## Identity and validation

- Identity is scoped by `type` (`movie`, `series`, or `anime`). A claim with another type is
  rejected. A source must explicitly verify any anime/series cross-category mapping before it
  can be represented as a claim of the requested type.
- The internal namespace list is closed: IMDb, TMDB, Kinopoisk, TVDB, Wikidata, Shikimori,
  MyAnimeList, AniList, and WorldArt. TVDB and Wikidata remain internal until the public
  `ExternalIds`, API parsing, and provider contracts are migrated in later tasks.
- IMDb IDs use `tt` plus 7–12 digits; Wikidata uses `Q` plus a positive decimal integer;
  the other namespaces use positive decimal integers. Normalization trims whitespace,
  canonicalizes letter case and decimal leading zeroes, and rejects unknown or malformed IDs.
  Normalization never guesses a missing ID.

## Evidence and conflicts

- Initial IDs are authoritative within one resolution. A source claim must identify an existing
  anchor ID and return that same ID in the source record with its proposed IDs. A matching title,
  year, provider-native `media.id`, or a free-standing lookup hit is insufficient evidence.
  Source adapters are responsible for verifying that one record really contains the anchor and
  all proposed IDs; the contract cannot independently establish an upstream record's truth.
- The claim must match the requested type. A claim that conflicts with any initial ID is rejected
  in full, so its other IDs cannot contaminate the identity. Invalid and unsupported fields are
  diagnosed and ignored.
- Multiple claims for an absent namespace are accepted only when all valid values agree. When
  they disagree, that namespace stays absent and receives `AMBIGUOUS_ID`; source order does not
  decide the winner. Agreements preserve provenance for each source.
- Claims in one pass may only anchor to IDs present at the start of that pass. A newly discovered
  ID can serve as an anchor in a later bounded pass (ID-03). No claim can link two records through
  title similarity alone.

`resolveIdentityClaims` returns normalized IDs, source and anchor provenance, and diagnostics.
It performs no network requests or persistence. These diagnostics are internal until the
orchestrator maps them to the public response warning format.

## Bounded orchestration (ID-03)

`IdentityResolver` accepts independent sources that declare when they can resolve a typed set of
known IDs and return source-record claims. It runs applicable sources in parallel, then applies
`resolveIdentityClaims` to their combined claims. Newly confirmed IDs can anchor the next pass.
All accumulated claims are reconsidered against the original IDs on each pass, so a later
conflicting claim cannot make an earlier derived value authoritative. Ambiguous derived namespaces
stay withheld for the rest of the resolution.

Defaults are three passes, twelve source calls, a five-second overall deadline, and two seconds
per source call. A source failure or timeout produces a diagnostic and does not stop other sources.
Caller cancellation returns the IDs confirmed so far; shared in-flight source work may finish for
other callers. The optional existing `Cache` stores successful source claims for one hour and empty
results for five minutes, keyed by source, media type, and the normalized input ID set. Concurrent
calls for the same source and input share one request. Cache entries are temporary acceleration,
not durable canonical identity storage. No concrete mapping source or public API integration is
part of ID-03; those follow in ID-04 and later tasks.

## Mapping sources (ID-04)

The concrete no-token sources and their verified coverage are recorded in
[`identity-resolver-sources.md`](identity-resolver-sources.md). They are not yet wired into the
public search, details, or availability paths; that is ID-05.

## Engine integration (ID-05)

`MediaEngine` accepts an optional `identityResolver`. The API configures Wikidata, AniList,
Shikimori, and Aderom sources against the shared memory cache; KinoBD remains optional until
its live endpoint is verified. API resolution has a 4.5-second overall deadline and 3.5-second
per-source deadline, allowing the observed cold Wikidata calls while bounding added latency.

Search resolves at most five results after filtering and pagination, independently of missing
poster or description fields. Newly linked cards are merged only for the same media type and a
shared strong ID with no conflicting strong IDs. Existing public `media.id` remains the first
card's provider-native ID. Details add confirmed IDs after metadata merge. Streaming and torrent
queries resolve known IDs only when a selected provider needs a missing supported ID; streaming
retains its existing title-based fallback when the mapping is unavailable. Source errors and
timeouts are non-fatal. Search and details report these diagnostics as warnings and avoid caching
the incomplete response after a source failure. There is no standalone subtitle lookup contract
to update; subtitle tracks are supplied by streaming providers.

Local Compose API checks on 2026-09-24 returned Interstellar's IMDb, TMDB, Kinopoisk, and
Wikidata IDs in both search and details. An ID-only availability query using TMDB `157336`
resolved Kinopoisk `258687` and returned one Initem option. The sampled cold search and details
requests each took about 8.6 seconds including metadata work and resolution, versus roughly
5 seconds in the earlier baseline; the availability query took 2.5 seconds. These are single
local samples, not stage latency guarantees. No stage URL was available to verify the original
missing-Kinopoisk report there.
