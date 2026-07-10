# Next Implementation Plan

## Goal

Build Media Engine into an install-and-use package where an application can get clean metadata and normalized player options without building its own parser layer.

The highest priority is the quality and completeness of the engine/provider layer. The API and example frontend only need to prove the integration path; they should not drive architecture decisions or hide weak parser/player behavior.

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

Observed issues from live UI testing:

- Pressing `Details` can feel slow; details latency needs the same per-provider visibility as search and availability.
- Broad queries can return a weak canonical item before the enriched canonical item. Example: `one` previously ranked a low-enrichment `One Piece` result below less relevant franchise entries, while `one piece` returned the enriched canonical result first.
- A details-selected item can still show player failure. Example: House of the Dragon details load with strong external IDs, but the Players panel can show `All streaming providers failed`; this should be treated as an availability query/source matching bug, not as a UI-only issue.

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

6. Measure details latency.
   - Add a live smoke command for `MediaEngine.getDetails`.
   - Include movie, series, anime, and House of the Dragon cases.
   - Print total time, per-provider timings, provider failures, and missing enrichment fields.

Done when:

- `pnpm release:check` passes.
- `pnpm smoke:providers -- --strict` passes.
- Game of Thrones, Interstellar, Naruto, One Piece, Avatar, Dune, Dark, Breaking Bad, and similar popular queries rank correctly.
- Details for key series include status and episode/season counters when providers expose them.
- `pnpm smoke:details-latency` makes slow details providers visible before UI work starts.

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

Known KinoBD/ReYohoho player keys to request by default:

```txt
collaps,vibix,alloha,kodik,kinotochka,flixcdn,ashdi,turbo,videocdn,bazon,ustore,pleer,videospider,iframe,moonwalk,hdvb,cdnmovies,lookbase,kholobok,videoapi,voidboost,videoseed,vk
```

The list comes from ReYohoho's KinoBD integration and intentionally excludes external-only/default-noisy or non-playback sources such as `ia`, `ext`, `netflix`, `torrent`, `nf`, `trailer`, `trailer_local`, and `youtube`. It is not a promise that every upstream player is always available; Media Engine should request useful embeddable players, normalize whatever comes back, and expose provider failures clearly.

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
- Details-selected popular series, including House of the Dragon, do not silently collapse to `All streaming providers failed` when stable external IDs are available.

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

## Media Engine Quality Plan Before README Polish

Goal: make availability results accurate and useful before documenting the project as release-ready.

## Runtime Quality Plan Before Release

Goal: make the real application feel fast, predictable, and honest under normal user behavior, not only pass unit tests and package checks.

Observed live issue:

- Searching `one` in the example app can take around 15 seconds before movies and series appear.
- Search quality can drift between broad and specific queries. Example: `one` may show `One Piece` low in the list with only Cinemeta data, no rating, and a weaker poster, while `one piece` returns a better merged `One Piece` result first with KinoBD IDs, ratings, and poster. Treat this as a merge/ranking/enrichment quality bug, not just a frontend display difference.
- Original root cause: `MediaEngine.search()` called selected metadata providers sequentially. Search calls are now concurrent and preserve deterministic merge order.
- Some providers perform multi-step requests: Cinemeta may enrich sparse search results with details; Wikidata searches entity IDs and then loads full entities; title-only broad searches often hit movie and series paths.
- The API now has explicit global and optional-enrichment provider budgets; live smokes remain necessary because a slow primary provider can still approach the global boundary.

Current implementation status:

- Search and details provider calls now run concurrently with deterministic merge order and provider timings.
- The API has a 5-second global provider timeout.
- `MediaEngineOptions.providerTimeouts` now supports smaller per-provider budgets without exceeding the global limit.
- API Cinemeta and Wikidata enrichment uses a 2.5-second default budget, configurable through `MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS`.
- Details latency smoke mirrors these optional enrichment budgets. Continue monitoring primary provider latency separately.

Priority tasks for the next session:

1. Add focused latency instrumentation.
   - Capture per-provider `tookMs` for search/details/availability in debug or meta where appropriate.
   - Add a local timing script or smoke mode for representative queries: `one`, `game`, `naruto`, `interstellar`, `breaking bad`.
   - Separate provider latency, merge latency, API latency, and frontend latency.
2. Parallelize independent provider calls.
   - Change search provider execution from sequential `for await` behavior to concurrent execution with `Promise.allSettled` or an equivalent helper.
   - Preserve current partial failure semantics: one provider failure should not fail the whole search when another provider succeeds.
   - Keep deterministic merge/ranking output independent of provider completion order.
3. Add sane timeout defaults.
   - Configure API `MediaEngine` with a finite provider timeout, likely 4-5 seconds to start.
   - Keep timeout configurable for library users.
   - Ensure timeout failures are reported as provider failures and do not block faster providers.
4. Audit retries and broad-query work.
   - Confirm `fetchJson` retry/backoff does not make common UI searches feel stuck.
   - Reduce unnecessary enrichment on broad search when it hurts first result time.
   - Consider provider-specific search limits for vague queries.
5. Verify frontend request behavior.
   - Confirm typing triggers debounce and aborts stale requests.
   - Ensure stale slower responses cannot overwrite newer faster query results.
   - Add browser/e2e coverage for fast repeated search input.
6. Add regression coverage.
   - Unit tests for concurrent provider execution and deterministic results.
   - Tests for timeout behavior with one slow provider and one fast provider.
   - Smoke/performance expectation for `one` and similar broad queries, using a practical threshold for local/dev environments.
7. Audit broad-query identity and enrichment quality.
   - Compare broad and specific variants such as `one` vs `one piece`, `game` vs `game of thrones`, `dark` vs `dark series`, and `avatar` vs `avatar the last airbender`.
   - Ensure the same canonical item keeps stable IDs, useful poster, ratings, and source attribution when another provider has the data.
   - Add regression coverage for canonical popular titles appearing too low or too sparse in broad search results.
   - Prefer merging/enrichment fixes over frontend masking; the API result should be high quality before UI rendering.
8. Audit live source filtering breadth.
   - Use a fixed live sample of 10 movies, 10 series, and 10 anime.
   - For each title, record discovered player sources, shown sources, filtered sources, and the reason each source was filtered.
   - Verify filtering does not remove working playback sources.
   - Prefer showing as many working playback sources as possible while still removing obvious broken, trailer, torrent, external-only, or non-playback sources.
   - Keep filtering reasons visible enough for debugging.
   - `pnpm smoke:source-filter-audit` now covers 10 movies, 10 series, and 1 anime with provider-level filter reasons plus expected Kinopoisk ID and title assertions; `--category` runs one media category independently. Expand anime to 10 cases next.
   - The 10-movie strict audit passed with correct identities. Collaps, FlixCDN, and Vibix remained available across the sample, while VideoSeed was preserved where returned. No working source was found among the filtered Turbo/ASHDI live-validation failures or known-broken HDVB URLs in this sample.
   - The 10-series strict audit also passed after correcting two bad fixture IDs exposed by title assertions. Collaps, FlixCDN, and Vibix remained available across all cases, while VideoSeed was preserved where returned. No mistakenly filtered working source was found in the series sample.
9. Search for non-Russian playback sources.
   - Look for English or otherwise international sources comparable to the current Russian voiceover-heavy sources.
   - If a source is usable and allowed, add it as a separate provider or source option instead of mixing language assumptions into Russian providers.
   - Preserve language/translation metadata so API and example UI can offer a real choice between Russian, English, subtitles, dub, voiceover, and original tracks when available.
   - Do not hardcode an English label unless provider data or source behavior supports it.

Done when:

- A slow provider no longer delays all other search results.
- Broad search returns useful first results within an acceptable local/dev threshold.
- Provider timeout and partial failure metadata make slow/failing upstreams visible.
- Example app search does not feel frozen during normal typing.
- A 30-title live sample proves filtering keeps working playback sources and removes only justified bad/non-playback sources.
- If suitable English/international sources are found, they are either added or documented with the reason they were not added yet.

Observed live issues:

- Some player options are displayed because a provider returned a URL, but the embedded player later shows unavailable video or does not play.
- Title-only KinoBD/ReYohoho lookup can select the wrong item. Example: `Game of Thrones` `2011` `series` selected `Game of Thrones: A Day in the Life` instead of the main series.
- External-only sources such as Netflix/Torrent are not useful as default player options for the example playback flow.
- Unknown translation language/type and unknown metadata status should be treated as provider normalization gaps, not only hidden by the frontend.

Engine-first tasks:

1. Add regression coverage for the live bugs.
   - `Game of Thrones`, `2011`, `series` must resolve to the main series, not documentaries or specials.
   - Availability smoke should assert expected item identity, not only option count.
2. Improve KinoBD/ReYohoho candidate selection.
   - Prefer exact external IDs when present.
   - Match media type: `series` should prefer KinoBD `serial`, movies should prefer `film`.
   - Match year or year range (`year`, `year_start`, `year_end`).
   - Score exact original/Russian title matches above partial matches.
   - Use popularity/rating only as a tiebreaker after identity checks.
3. Rank and filter player options.
   - Default to useful embeddable providers first.
   - Return all filtered playback player options by default; UI can group or collapse the list without hiding engine data.
   - Exclude external-only sources such as Netflix/Torrent from the provider default list instead of carrying them as normal output.
4. Represent availability confidence more honestly.
   - Do not treat every returned iframe URL as fully verified playback.
   - Distinguish discovered player URLs from checked or high-confidence playable options where the model supports it.
   - Filter obvious broken player pages with lightweight server-side checks, including HTTP 404/410/5xx and known unavailable markers such as `Video Not Found` or region-blocked player HTML.
   - Preserve provider failure/debug metadata so consumers can understand partial failures.
5. Add live smoke and browser e2e checks.
   - CLI smoke should verify expected item identity, option shape, player kind, and top player URL sanity.
   - Browser e2e should verify the example app can search, open details, select an embed player, render an iframe, and avoid embedding external-only options.
   - Cross-origin iframe video playback cannot always be inspected directly, so checks should focus on stable signals and avoid false guarantees.
6. Add language/translation grouping when provider data supports it.
   - Normalize player translation language separately from provider label.
   - Prefer grouping player options by language and translation/voiceover before quality.
   - If English or other non-Russian tracks are found, expose them clearly in availability responses and the example UI.
   - KinoBD/ReYohoho now infers known Russian voiceover labels such as `AlexFilm`, `HDrezka Studio`, `LE-Production`, and `Shachiburi`; keep expanding this list from live samples when language/type is known.
   - Avoid emitting misleading `unknown` values where `undefined` or a clearer confidence model would be more honest for API/UI consumers.
7. Audit source filtering across a broad live sample.
   - Check 10 popular movies, 10 popular series, and 10 popular anime.
   - For every filtered source, verify whether it was actually broken/non-playback or whether the filter is too aggressive.
   - Keep the default output broad: show all working playback sources, then let UI grouping make the list readable.
   - Add regressions for any working source that was filtered by mistake.
8. Explore English/international player sources.
   - Search for sources that can provide English audio, original audio, or English subtitles.
   - Add only sources with acceptable usage rules and stable enough behavior for a package.
   - Model them as first-class sources/providers with language metadata instead of hiding them behind generic labels.
9. Normalize metadata status more carefully.
   - TMDB/Shikimori now omit unsupported lifecycle status labels instead of emitting `unknown`.
   - Details merge now prefers a real normalized status over `unknown` when another provider has useful status data.
   - The example app renders absent status clearly instead of presenting `Status: Unknown` as useful data.

Done when:

- Title-only fallback does not silently pick the wrong item for known regression cases.
- Default availability output returns all filtered playback player options without obvious broken/non-playback sources.
- External-only player sources are hidden by default or clearly separated.
- Smoke/e2e checks catch wrong-content and unusable-option regressions.
- Language/translation data is preserved well enough for UI grouping when sources provide it.
- Live source filtering has been checked against 10 movies, 10 series, and 10 anime.
- Working playback sources are not removed just because they are unfamiliar or lower priority.
- English/international source options are added or explicitly documented as researched but not usable yet.
- Unknown translation/status values are reduced through provider normalization and represented honestly when still unavailable.

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
5. Verify tarballs contain only useful compiled files through `pnpm pack:check`.
6. Add changelog and version.
7. Run final gates:
   - `pnpm release:check`;
   - `pnpm smoke:providers -- --strict`;
   - `pnpm pack:check`;
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

## Final Repository Presentation

Keep this repository as a full open-source monorepo, not as a packages-only repository.

GitHub should contain:

- `packages/core` as the main Media Engine library;
- `packages/providers` as metadata and streaming provider implementations;
- `packages/sdk` as the HTTP SDK;
- `apps/api` as the backend/API example;
- `apps/example` as the frontend/player UI example.

Only publish npm packages from `packages/*`:

- `@media-engine/core`;
- `@media-engine/providers`;
- `@media-engine/sdk`.

Do not publish `apps/api`, `apps/example`, or the workspace root. Keep them private example applications that prove real integration.

Before release, polish the repository presentation:

- root README explains the engine, packages, examples, metadata usage, and player availability usage;
- package READMEs explain install and usage for each npm package;
- app READMEs explain local API/frontend examples;
- release docs clearly separate npm package contents from GitHub example apps;
- npm pack checks confirm that apps, tests, env files, and workspace-only files are not included in published package tarballs.

## Next Session Starting Point

Start with the Runtime Quality Plan before continuing release polish or Docker smoke.

Recommended first implementation task:

1. Reproduce and measure slow broad search for `one`.
2. Add provider-level timing visibility.
3. Parallelize `MediaEngine.search()` provider calls while preserving partial-failure semantics and deterministic output.
4. Add API timeout defaults and regression tests.
5. Run the 10 movies / 10 series / 10 anime live source filtering audit.
6. Search for English/international playback sources and add or document the usable candidates.
7. Then continue the already planned Docker API/example smoke and final version/changelog decision.
