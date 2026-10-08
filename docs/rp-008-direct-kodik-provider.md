# RP-008 direct Kodik provider

Status: ready for acceptance on 2026-10-08.

## Result

Media Engine now has an opt-in direct Kodik streaming adapter backed by a provider-issued token.
The repository API enables it only when the server owns `KODIK_API_KEY`; the token is never present
in provider metadata, normalized output, source attribution, or public errors.

The adapter:

- performs bounded exact lookup by Kinopoisk, IMDb, or Shikimori ID and never falls back to title
  matching;
- accepts movies, ordinary series, anime films, and TV anime without changing the requested media
  class;
- maps Kodik translations, quality labels, iframe targets, region/copyright restrictions, and
  direct/upstream provenance;
- requires exact season and episode coordinates for episodic lookup;
- validates TV-anime canonical season, episode, absolute episode, and optional split-release
  evidence against a complete provider episode catalog;
- rejects conflicting IDs, media types, partial coordinates, absent episodes, ambiguous release
  maps, unsafe URLs, malformed payloads, cancellation, timeout, and oversized responses safely;
- makes at most two sequential ID lookups, does not retry an individual request, caps results at
  100, caps JSON at 4 MiB, and uses the shared hardened transport and rate-limit gate.

`StreamOption.provider` is `kodik-streaming`, `player.provider` is `kodik`, and `discovery` is
`direct`. The focused Core integration test proves an equivalent aggregate observation is merged
into the direct option while both attributions remain visible.

## Live evidence

`pnpm smoke:kodik` passed the direct contract for:

- Parasite: 5 translations;
- Spirited Away: 8 translations;
- a currently indexed ordinary foreign series episode: 4 translations;
- Death Note E01: 2 translations;
- Frieren E01: 33 translations;
- Solo Leveling E01: 59 translations;
- Jujutsu Kaisen E01: 28 translations;
- Re:Zero split release S02E14 / absolute 39: 17 translations;
- missing work, wrong episode, and conflicting identity: no options.

The required Western coverage observations for Interstellar, Game of Thrones, Breaking Bad, and
Shogun were also executed. Kodik's current authenticated catalog returned no record for those exact
Kinopoisk or IMDb IDs. This is recorded as upstream coverage, not converted into a false adapter
failure or a title-based match.

The first Parasite and Re:Zero iframe targets both returned HTTP 200 HTML without response
`X-Frame-Options` or CSP. This proves the current embed shell is reachable and frameable; it does not
claim browser playback or bypass a future domain/referrer policy. Browser playback acceptance stays
in the later published-package integration task.

## Verification

- Kodik Providers contract/config/client/mapping/deduplication tests: 14/14.
- API streaming configuration tests: 20/20.
- Providers build and typecheck pass.
- API typecheck and focused ESLint pass.
- Focused Prettier and `git diff --check` pass.
- Providers dry package includes public `kodik-streaming` output and excludes tests and secrets.

Reproduction:

```text
pnpm --filter @media-engine/providers build
node --test packages/providers/dist/kodik-streaming/*.test.js
pnpm --filter @media-engine/api test -- --runInBand apps/api/src/media-engine/media-engine.config.spec.ts
pnpm smoke:kodik
```

The live smoke requires a provider-issued `KODIK_API_KEY` in the process environment. It prints no
token or player URL.
