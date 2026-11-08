# Streaming 1.13.6 verification

Prepared 2026-11-08; publication remains a user action.

## Behavior

- Kodik, AniLiberty, VeoVeo and VideoHUB accept episodic anime independently of
  distribution kind. Explicit anime movies keep the movie contract.
- Core verifies cinema-ID provenance for all episodic anime kinds, including an
  omitted kind. This validation is not limited to TV releases.
- Matching seasonal coordinates need only a gap-free prefix through the requested
  episode. Extra episodes and incomplete later seasons no longer invalidate it.
- Release-count mapping remains available for split releases and arc-only catalogs.
  Conflicting coordinates, invalid release evidence and unverified identities remain rejected.
- No dependency patch or production changes in `node_modules` are used by yaneMedia.

## Checks

- Core, Providers and SDK package builds passed at 1.13.6.
- Focused Core tests: `engine.availability` and `query.anime-release`, 41 passed.
- Focused Providers tests: `shared/anime-episode`; Kodik, VeoVeo and VideoHUB
  availability/config; AniLiberty availability, 59 passed.
- VeoVeo and VideoHUB client/mapping contracts: 22 passed.
- Total: 122 focused tests. The full `pnpm release:check` was not run.
- Release consistency passed: packages/runtime/User-Agent 1.13.6, API 0.20.0.
- Dry package contents passed: Core 211 files, Providers 325, SDK 10.
- Changed-file Prettier and `git diff --check` passed.

## Live observations

- VeoVeo returned one HLS option for Made in Abyss S1E1/A1 and S2E1/A14,
  despite a provider catalog containing 13 episodes in each season versus the
  anime releases' 13 and 12. These were direct adapter checks using confirmed IDs.
- Production-like Core routing returned VeoVeo for Made in Abyss S2,
  VeoVeo/Kodik for Hellsing OVA, and VeoVeo/VideoHUB/Kodik for Cyberpunk ONA,
  preserving their actual kinds. A cold Made in Abyss S1 identity lookup did not
  confirm cinema IDs and returned Kodik only; identity/network degradation is
  still distinguished from provider absence, and verification is not bypassed.
- Dandadan's VideoHUB KP lookup returned an empty playlist. AniLiberty search
  returned season 1 only. Source counts can therefore legitimately differ by season.
- Browser decoding with published 1.13.6 remains part of the subsequent yaneMedia
  upgrade; these checks do not claim playback of every third-party URL.

## Handoff

Publish Core, Providers and SDK in that order. Then upgrade yaneMedia's exact
Core/Providers versions and override/lockfile. Its prepared season-navigation
change follows story prequel/sequel links through any intermediate release format
(Made in Abyss uses a story film), without numbering that film as a TV season.
Remove the app's TV-kind compatibility conversion once native 1.13.6 routing is installed.
