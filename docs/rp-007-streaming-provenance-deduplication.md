# RP-007 streaming provenance and deduplication

Status: accepted on 2026-10-08.

## Result

The normalized streaming contract now distinguishes three facts without breaking existing
consumers:

- `StreamOption.provider` remains the adapter that discovered an option;
- `StreamOption.player.provider` optionally names the normalized real upstream player;
- `StreamOption.discovery` optionally identifies a `direct` or `aggregate` observation.

KinoBD player options are marked `aggregate` and expose normalized upstream identities such as
`kodik`. Future direct adapters can use the same upstream identity with `discovery: "direct"`.

## Deduplication and priority

Core treats options as the same playback target when their player kind, access request, and episode
identity match. Descriptive translation, quality, subtitle, and audio metadata do not create a
second option for the same target.

For equivalent targets Core keeps, in order:

1. the strongest availability state (`available`, account-gated, region-locked, temporarily
   unavailable, then unknown);
2. a direct observation over an aggregate observation at the same availability level;
3. configured provider order as the stable tie-breaker.

Every merged observation remains in `StreamOption.attributions`, including discovery adapter,
upstream player, availability state, option ID, and safe source URL when supplied. Provider failures
remain independently visible through existing response metadata.

## Compatibility

All new fields are additive and optional. Existing custom providers and consumers remain valid.
Embed, HLS, and MP4 targets remain distinct even when they share a URL.

## Verification

- Core and Providers focused type checks passed after rebuilding the changed Core contract.
- Core availability contract plus KinoBD player/availability/validation suites passed: 31/31.
- The contract test proves aggregate-first ordering still selects the equivalent direct option and
  retains both observations.
- The KinoBD test proves a discovered Kodik option reports `aggregate` plus upstream `kodik`.
