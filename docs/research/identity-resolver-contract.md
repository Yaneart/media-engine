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
