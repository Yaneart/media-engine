# Next Implementation Plan

## Goal

Build Media Engine into an install-and-use package where an application can get clean metadata and normalized player options without building its own parser layer.

Target developer experience:

```bash
npm install @media-engine/core @media-engine/providers
```

Then the developer configures Media Engine once and can search metadata, load details, and request available player options.

This plan is intentionally split into phases. Metadata parsing and video/player availability are related, but they must stay separate internally so metadata still works when streaming providers fail or are unavailable.

## Release Position

Current parser status is good enough for a metadata-focused pre-release candidate, but not yet for the larger promise of "parser plus players out of the box".

Do not publish with marketing that says video is production-ready until the streaming phases below are complete.

## Phase 1: Finish Metadata Parser Quality

Goal: make metadata search/details feel polished for popular movies, series, and anime.

Tasks:

1. Expand the golden query set.
   - Add more RU/EN ambiguous titles.
   - Add sequels and franchise queries.
   - Add anime with Russian and English names.
   - Add bad/partial user input cases.

2. Improve result ranking.
   - Tune scoring for title relevance, popularity, votes, source authority, and exact type match.
   - Make broad search prefer the most popular release when the query is vague.
   - Keep `Any` search from being dominated by only movies.

3. Improve provider data mapping.
   - Audit ratings, genres, countries, runtime, status, seasons, episodes, persons, posters, and backdrops for each provider.
   - Add missing mappings where provider data exists.
   - Keep payload arrays bounded.

4. Add provider quality snapshots.
   - Store expected top results for important queries.
   - Run them through `pnpm smoke:providers -- --strict`.
   - Track provider failures separately from ranking failures.

5. Improve HTTP behavior.
   - Keep timeout and retry/backoff behavior.
   - Add optional cache policy for live provider calls.
   - Document rate-limit behavior clearly.

Done when:

- `pnpm release:check` passes.
- `pnpm smoke:providers -- --strict` passes.
- Game of Thrones, Interstellar, Naruto, One Piece, Avatar, Dune, Dark, Breaking Bad, and similar popular queries rank correctly.
- Details for key series include status and episode/season counters when providers expose them.

## Phase 2: Add Core Streaming Availability API

Goal: make video/player lookup a first-class engine feature without mixing it into metadata search/details.

Tasks:

1. Add `streamingProviders` to `MediaEngineOptions`.
2. Add `MediaEngine.getAvailability(query)`.
3. Add `getStreamingProviders()` or include streaming providers in a clearly separate provider list.
4. Validate `StreamQuery`.
   - `type` is required.
   - Require title or external IDs.
   - Support movie-level and episode-level lookup.
5. Select streaming providers by capabilities.
6. Merge multiple provider availability responses.
   - Combine options.
   - Combine episode option groups.
   - Preserve provider attribution.
7. Add cache support for availability responses.
8. Add tests for:
   - no providers returns empty availability;
   - one provider returns multiple players;
   - episode filtering;
   - provider filtering;
   - partial provider failure;
   - all provider failure.

Done when:

- Core can return `MediaAvailability` from configured streaming providers.
- Metadata search/details do not depend on streaming.
- Tests prove multiple players/translations/qualities can be returned for one item or episode.

## Phase 3: Add API and SDK Streaming Endpoints

Goal: applications can request player options through REST and the SDK.

Tasks:

1. Add `GET /media/availability`.
2. Support query params:
   - `type`;
   - external IDs;
   - `title`;
   - `year`;
   - `seasonNumber`;
   - `episodeNumber`;
   - `absoluteEpisodeNumber`;
   - `providers`;
   - `language`.
3. Add Swagger docs for the endpoint.
4. Add SDK method:
   - `client.getAvailability(query)`.
5. Add API tests for validation and engine mapping.
6. Add SDK tests for query serialization and response parsing.

Done when:

- REST clients can call `/media/availability`.
- SDK users can call `getAvailability`.
- Invalid stream queries return 400.
- All streaming provider failure returns 503.

## Phase 4: Real Player Providers

Goal: provide useful out-of-box player options from allowed sources.

Important rule:

Do not add a provider by scraping or bypassing rules. Each real streaming provider must have documented allowed usage.

### Phase 4 Direction Update: KinoBD/ReYohoho-Style Streaming First

After reviewing ReYohoho and ani-cli references, the next practical provider should be a no-token KinoBD/ReYohoho-style streaming provider, not a mandatory Kodik-token provider.

Why:

- ReYohoho does not expose a public Kodik token in the frontend.
- ReYohoho frontend points to its own backend through `VITE_APP_API_URL=https://api4.rhserv.vu`.
- ReYohoho gets players through KinoBD/ReYohoho-style endpoints such as `/api/player/search`, `/playerdata`, and `/cache_shiki`.
- In ReYohoho, `kodik` is one of several requested player provider names inside a `player` parameter, not a standalone client-side Kodik token.
- ani-cli does not use Kodik token either. It scrapes AllAnime GraphQL/embed data and extracts playable links. That approach is useful as a technical reference, but it is not the right default for an npm package that should avoid brittle scraping.

Reviewed sources:

- ReYohoho frontend environment config:
  `https://github.com/dav2010ID/reyohoho/blob/main/.env`
- ReYohoho KinoBD/player integration:
  `https://github.com/dav2010ID/reyohoho/blob/main/src/api/movies.kinobd.js`
- ReYohoho Shikimori/anime player backend calls:
  `https://github.com/dav2010ID/reyohoho/blob/main/src/api/movies.rhserv.js`
- ReYohoho player source UI flow:
  `https://github.com/dav2010ID/reyohoho/blob/main/src/composables/usePlayerSources.js`
- ReYohoho Desktop config and shell behavior:
  `https://github.com/reyohoho/reyohoho-desktop/blob/master/prebuilts/config.json`
  `https://github.com/reyohoho/reyohoho-desktop/blob/master/src/main.ts`
- ani-cli source:
  `https://github.com/pystardust/ani-cli/blob/master/ani-cli`

Implementation target:

1. Add `kinobdStreamingProvider` in `@media-engine/providers`.
2. Make it no-token by default.
3. Use KinoBD/ReYohoho-style endpoints:
   - `/api/player/search` to find player candidates;
   - `/playerdata` to request provider player iframe data;
   - optionally `/cache_shiki` or a compatible configured endpoint for Shikimori anime players if source rules are acceptable.
4. Request a provider list that includes `kodik`, but keep it configurable.
5. Normalize returned provider player maps into `MediaAvailability`:
   - provider name;
   - translation label;
   - quality;
   - iframe/embed URL;
   - source attribution;
   - episode references when available.
6. Keep direct Kodik API provider optional:
   - `kodikProvider({ token })` can remain for users with an official Kodik token;
   - it should not be required for the default out-of-box flow.

Provider requirements:

- no hardcoded private credentials;
- no account cookies;
- no direct video extraction by default;
- embed/external URLs only unless a source explicitly allows HLS/MP4 exposure;
- mocked tests for all HTTP response shapes;
- live smoke only after network access and source availability are confirmed.

Done when:

- A new project can configure Media Engine with metadata providers and no-token `kinobdStreamingProvider`.
- `engine.getAvailability({ type: "anime", shikimori: "20", absoluteEpisodeNumber: 1 })` can return player options when the upstream source has them.
- API `/media/availability` works without requiring the user to obtain a Kodik token.
- Example app can show returned player options and open an embed/external player.

Candidate providers:

1. Kodik.
   - Use only official/allowed API or embed flow.
   - Map translations, quality labels, episode numbers, and embed/external player URLs.
   - Support provider filtering.

2. ReYohoho-related player sources.
   - First document what API/source is being used.
   - Confirm whether usage is allowed.
   - Normalize player options rather than hardcoding frontend behavior.

3. Other providers.
   - Add only after source rules are reviewed.
   - Each provider must have tests with mocked HTTP.

Provider requirements:

- no secrets exposed to browser clients;
- no account-bound cookies returned;
- clear source attribution;
- timeout, retry, and provider failure mapping;
- bounded response size;
- tests for movies, series, and anime where supported.

Done when:

- At least one real allowed provider returns playable embed or external player options.
- Multiple player options can be returned for one movie or episode.
- Provider failures do not break metadata.

## Phase 5: Example App Player UI

Goal: prove the full flow from search to details to player selection.

Tasks:

1. Add availability loading in the example app details view.
2. Show player options grouped by provider, translation, and quality.
3. Add a player modal or panel.
4. Support `embed` and `external` first.
5. Add HLS/MP4 only when allowed and safe.
6. Add loading, empty, error, and provider failure states.
7. Keep UI clear that no player is available when providers return no options.

Done when:

- User can search a title.
- User can open details.
- User can see available player options.
- User can open an allowed embed/external player.

## Phase 6: Package and Release Polish

Goal: make npm install usage predictable.

Tasks:

1. Decide package naming.
   - Keep scoped packages such as `@media-engine/core` and `@media-engine/providers`, or create a convenience meta-package later.
2. Add quickstarts:
   - metadata only;
   - metadata plus streaming providers;
   - API server;
   - SDK client.
3. Audit package exports.
4. Run npm pack checks.
5. Verify tarballs contain only useful compiled files.
6. Add changelog and version.
7. Run final gates:
   - `pnpm release:check`;
   - `pnpm smoke:providers -- --strict`;
   - npm pack checks;
   - Docker API/example smoke.

Done when:

- A developer can install packages and follow README without reading the repo internals.
- The release notes honestly distinguish metadata parser support from streaming/player provider support.

## Phase 7: Release Decision

Metadata-only pre-release can publish when:

- metadata quality gates pass;
- package tarballs are clean;
- README explains best-effort live providers;
- no claim is made that production video providers are ready.

Parser plus player release can publish when:

- Phases 2 through 5 are complete;
- at least one real allowed player provider exists;
- SDK and API expose availability;
- example app demonstrates player selection;
- provider source rules are documented.

## Next Session Starting Point

Start with Phase 2 unless the user explicitly chooses to publish a metadata-only pre-release first.

Recommended first implementation task:

1. Add `streamingProviders` to `MediaEngineOptions`.
2. Add `MediaEngine.getAvailability`.
3. Add core tests with `experimentalStreamingProvider`.
4. Then add API and SDK availability endpoints.
