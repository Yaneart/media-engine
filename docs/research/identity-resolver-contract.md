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
