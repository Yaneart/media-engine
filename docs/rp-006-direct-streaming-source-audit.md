# RP-006 direct streaming source audit

Date: 2026-10-07  
Repository baseline: `4ae3488` (`feature/resilient-sources`)  
Scope: evidence and decisions only; no runtime provider was added or changed.

## Outcome

No new mainstream, credential-free streaming provider satisfies the accepted direct-source
contract. The four planned direct balancers are therefore not ready for implementation:

- Kodik and Alloha are `requires credentials`;
- Collaps and VideoCDN are `reject`;
- conditional tasks RP-008 through RP-011 must be skipped unless a later user-owned contract
  changes one of those decisions.

Vibix is the only newly revalidated Russian balancer with current first-party Swagger material. It
is also `requires credentials`: an authenticated proof-of-contract and rights review must happen
before any adapter work. Videasy, VidCore, and APIPlayer are rejected because a successful outer
page is not an availability signal and no acceptable first-party playback/provenance contract was
found. Internet Archive has a legitimate direct-file contract, but is deferred because it is a
public-domain/open-license niche rather than coverage for the accepted movie/series/anime matrix.

The existing independent sources remain more valuable than the new candidates. AniLiberty,
VeoVeo, VideoHUB, Rutube, and Aderom are retained with their current opt-in/default status. KinoBD,
DDBB, and FlixHQ remain bounded aggregate fallbacks, not evidence of direct upstream support.

## Decision rules

Each candidate receives exactly one RP-006 classification:

- `implement`: current first-party contract, honest availability, suitable identity and playback
  output, and no unresolved access or policy prerequisite;
- `requires credentials`: potentially suitable, but the current contract requires a user-owned
  token, account, registered domain, or licensed deployment;
- `defer`: legitimate lead, but it does not currently meet product coverage or has a specific
  evidence gap that can be resolved without reverse engineering;
- `reject`: no stable supported contract, dishonest availability semantics, reverse-engineered
  playback, duplicate failure domain, or unacceptable maintenance/provenance risk.

An iframe shell returning HTTP 200 is never counted as `available`. Direct HLS/MP4 discovery is
accepted only when the service documents it or the first-party API returns it through a supported
contract. Scraper repositories and webmaster forums are used only as negative maintenance-risk
evidence, never as authorization or a production contract.

## Candidate matrix

| Candidate        | Decision                 | Identity and coverage                                                                                                                                                                                                                        | Playback and availability                                                                                                                                                                                    | Access, limits, and risk                                                                                                                                                                                                                                |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kodik            | **requires credentials** | Unofficial material describes title, Kinopoisk and other IDs; movie, series, anime, translations, seasons, and episodes.                                                                                                                     | Supported public evidence reaches an embed link, not a direct media contract. Availability and iframe policy are undocumented.                                                                               | The current API root is token-gated; no current public first-party API/terms were found. Domain drift from `kodikapi.com` to `kodik-api.com` adds risk. Require a provider-issued token and written contract.                                           |
| Alloha           | **requires credentials** | Historical integrations claim Kinopoisk/IMDb/TMDB/title, movies, series, anime, translations, seasons, and episodes.                                                                                                                         | Historical result is an iframe. No verified direct HLS/MP4 or truthful absence contract.                                                                                                                     | `api.alloha.tv` returned a structured invalid-token response. No current public first-party schema, rate policy, terms, or onboarding contract was found.                                                                                               |
| Collaps          | **reject**               | Historical third-party material claims Kinopoisk/IMDb plus series/episode and voice data.                                                                                                                                                    | Historical iframe contract only.                                                                                                                                                                             | Current public site is a redirect shell and historical API hosts rotate across unrelated domains. No stable owner documentation, credential issuance, limits, or embed policy exists.                                                                   |
| VideoCDN         | **reject**               | Old third-party examples claim Kinopoisk/title movie and exact-series records with translations.                                                                                                                                             | Historical `iframe_src`; direct MP4 claims could not be verified.                                                                                                                                            | The service/API was not reliably reachable and no current first-party documentation or onboarding path was found.                                                                                                                                       |
| Vibix            | **requires credentials** | First-party roadmap documents Kinopoisk/IMDb lookup, movie/series/anime categories, translations, seasons, and episodes.                                                                                                                     | First-party material describes dynamic player playlists and iframe publisher domains. Direct HLS/MP4 must not be assumed until the authenticated schema is captured.                                         | Current Swagger explicitly requires an API token generated in the account. No public numeric limit or latency SLA. Require token, registered-domain proof, full authenticated OpenAPI capture, and rights review.                                       |
| HDVB             | **reject**               | Historical snippets claim token plus Kinopoisk movie/series lookup.                                                                                                                                                                          | Historical iframe output only.                                                                                                                                                                               | Current public domain is unrelated hosting; old API hosts and schemas have no current first-party owner contract.                                                                                                                                       |
| Videoseed        | **defer**                | A provider representative historically claimed internal/Kinopoisk/IMDb/TMDB inputs and movie/series/anime/episode coverage.                                                                                                                  | Claimed player/API output is not currently documented first-party.                                                                                                                                           | No current public API documentation, terms, stable schema, rate limit, or reliable live endpoint was found. Reconsider only if the provider supplies its own contract and credentials.                                                                  |
| Videasy          | **reject**               | Current docs accept TMDB/IMDb movie IDs and exact TV season/episode; the home page also claims anime.                                                                                                                                        | Documented output is iframe only. Valid and impossible IDs both returned the same class of HTTP 200 shell, so availability remains unknown.                                                                  | No credentials, but no rate limit, terms, or rights/provenance contract. Docs explicitly describe a relationship to VidSrc domains, so this is not a clearly independent upstream.                                                                      |
| VidCore          | **reject**               | Current `vidcore.io` docs accept IMDb/TMDB movies and TV episodes.                                                                                                                                                                           | Official output is iframe. Valid and impossible IDs both return HTTP 200. Direct HLS requires replaying an encrypted private catalog according to independent resolver code and is not a supported contract. | Conflicting `.io` and `.org` generations, no rate policy/SLA contract, no trustworthy availability, and high reverse-engineering risk.                                                                                                                  |
| APIPlayer        | **reject**               | Current docs accept TMDB/IMDb movies and exact TV episodes.                                                                                                                                                                                  | Iframe plus an advertised JSON manifest for HLS/direct streams. Valid and impossible embeds both returned HTTP 200; manifest requests returned `403 turnstile_required`.                                     | Marketing claims no rate limit, but there is no enforceable SLA/terms or provenance contract. The headless route is not currently server-to-server usable.                                                                                              |
| Internet Archive | **defer**                | First-party Advanced Search and Metadata APIs support title/date/creator/collection plus free-form external IDs; coverage is public-domain/open media, not a canonical mainstream catalog. No normalized seasons, episodes, or translations. | Metadata returns exact files, formats, checksums, and workable servers. A sampled public-domain item exposed one MP4; a missing ID returned an empty object. HLS is not guaranteed.                          | Credential-free reads with a required descriptive User-Agent, caching, bounded concurrency, and 429 handling. Only explicitly acceptable license metadata may be used. Defer unless the product explicitly wants a public-domain/open-license provider. |

There is no `implement` decision in this checkpoint. This is intentional: provider count is not a
substitute for an honest contract or independent failure behavior.

## First-party evidence

### Vibix

- [Swagger UI](https://vibix.org/api/external/documentation) identifies OAS 3.0 v1.1.0 and says to
  generate an API token in the Vibix account settings.
- [First-party roadmap](https://dev.vibix.org/roadmap.html) records Kinopoisk/IMDb lookup,
  translation filters, movies/series/anime categories, seasons/episodes, publisher iframe domains,
  dynamic playlists, and client-side storage-server availability checks.
- The unauthenticated OpenAPI JSON timed out from this network. That is not permission to infer its
  protected schema from third-party code.

### Videasy

- [Current documentation](https://videasy.ws/docs.html) defines iframe routes for TMDB/IMDb movies
  and exact TMDB TV episodes, player-managed subtitles, episode navigation, and progress messages.
- It documents no server availability endpoint and no direct media API.
- Its text distinguishes the custom player domain from "official VidSrc domains", which prevents
  treating it as a clearly independent content upstream.

### VidCore

- [Current `.io` documentation](https://vidcore.io/) defines IMDb/TMDB movie embeds and TV embeds
  with server, subtitle, theme, and start-position parameters.
- No supported direct-stream API, concrete rate limit, or availability endpoint was found.
- The independent [VidCore resolver repository](https://github.com/advmtaxi/vidcore) explicitly
  describes scraping the embed, replaying encrypted private endpoints, decrypting media targets,
  and proxying HLS. This is maintenance-risk evidence, not an integration contract.

### APIPlayer

- [Current first-party page](https://apiplayer.ru/) documents TMDB/IMDb movie embeds, exact TV
  episode embeds, iframe parameters, and `manifest.php` for JSON HLS/direct output.
- The same page says media is parsed dynamically from public APIs. No source ownership, usage terms,
  or stable server-to-server access contract accompanies that claim.

### Internet Archive

- [Metadata read API](https://archive.org/developers/md-read.html) returns exact item metadata,
  files, checksums, storage locations, and `workable_servers`. Missing identifiers return an empty
  result; extended errors distinguish unavailable and deleted items.
- [Metadata schema](https://archive.org/developers/metadata-schema/index.html) documents item/file
  metadata and permits custom external identifiers. Its flexibility also means canonical cinema IDs
  cannot be assumed.
- [Advanced Search](https://archive.org/advancedsearch.php) supplies the discovery API. Every item
  still needs an explicit acceptable `licenseurl`; upload presence alone is not sufficient.

### Credential-gated and unsupported balancers

For Kodik, Alloha, Collaps, VideoCDN, HDVB, and Videoseed, current public first-party material was
insufficient to define a safe adapter. Historical endpoints and shapes were compared only to
identify likely identity and episode capabilities. They are not included here as normative API
references because copied tokens, scraper code, and webmaster examples do not establish current
permission, limits, or stability.

## Live evidence

All requests used a descriptive audit User-Agent, no cookies, no provider credentials, and bounded
11-16 second request deadlines. Timings below are single checkpoint observations, not SLAs.

### Constructed iframe and manifest probes

| Probe                    |         Valid sample |    Impossible sample | Result                                                              |
| ------------------------ | -------------------: | -------------------: | ------------------------------------------------------------------- |
| Videasy movie/TV embed   | HTTP 200, 165-847 ms | HTTP 200, 163-174 ms | Outer response cannot prove availability.                           |
| VidCore movie/TV embed   | HTTP 200, 284-862 ms | HTTP 200, 292-341 ms | Outer response cannot prove availability.                           |
| APIPlayer movie/TV embed | HTTP 200, 187-835 ms | HTTP 200, 180-253 ms | Outer response cannot prove availability.                           |
| APIPlayer manifest       |             HTTP 403 |             HTTP 403 | Both returned `turnstile_required`; not a usable headless contract. |

None of the sampled embeds returned `X-Frame-Options` or a response CSP header, so the outer shell is
currently frameable. That says nothing about inner-player sandbox compatibility, redirects,
advertising, or playable media.

Unauthenticated contract checks also produced a structured invalid-token response from Alloha and
HTTP 400 `Invalid api token` from Collaps. Kodik's legacy host was not reliably reachable. These
checks establish credential boundaries only; they do not establish catalog or playback health.

### Existing Media Engine paths

The focused default-provider probe used Interstellar, Game of Thrones S01E01, and Death Note E01:

- Initem returned one Interstellar embed in 868 ms and no exact-episode result, as designed.
- DDBB returned four generic Interstellar embeds (Alloha, Collaps, Turbo, VeoVeo) in 3,462 ms and no
  exact-episode result, as designed.
- KinoBD reached the 11-second probe deadline for all three cases.
- FlixHQ returned an invalid-response error for the two compatible movie/series cases.
- AniLiberty correctly returned no Death Note result because that release is absent from its current
  exact-match catalog. Separate current catalog probes returned 48 One Piece options in 1,324 ms
  and 24 One-Punch Man options in 1,068 ms.

The repository `smoke:availability` check, which intentionally isolates KinoBD, produced five
upstream-degraded warnings and no contract regressions: all five requests had no usable result, with
movie/series requests ending at about 20 seconds. This confirms that KinoBD cannot remain the only
discovery path.

The focused exact-anime smoke revalidated VideoHUB and VeoVeo:

| Work                                    | VideoHUB                  | VeoVeo                 |
| --------------------------------------- | ------------------------- | ---------------------- |
| Frieren E01                             | 36 MP4 options, 11,325 ms | 1 HLS option, 3,205 ms |
| Solo Leveling E01                       | timeout, 7,018 ms         | 1 HLS option, 2,886 ms |
| Jujutsu Kaisen E01                      | 24 MP4 options, 13,580 ms | 1 HLS option, 4,655 ms |
| Death Note E01                          | timeout, 7,018 ms         | 1 HLS option, 2,862 ms |
| Re:Zero S2 Part 2 E01                   | timeout, 7,009 ms         | no option, 1,460 ms    |
| Demon Slayer Entertainment District E01 | no option, 4,055 ms       | 1 HLS option, 2,908 ms |
| Vinland Saga S2 E01                     | 24 MP4 options, 11,790 ms | 1 HLS option, 2,651 ms |

The same smoke rejected ambiguous absolute-only, nonexistent, mismatched-episode, and mismatched-work
queries. The split-release resolution returned 32 exactly mapped options with zero coordinate
mismatches. Regression probes returned VeoVeo HLS for Spirited Away, Interstellar, and Breaking Bad
S01E01; VideoHUB returned 12 Spirited Away MP4 options and timed out or returned empty for the other
two. This preserves the previous conclusion: VideoHUB adds diversity but has a heavy and unstable
tail, while VeoVeo playback is useful but its content-ID discovery still depends on DDBB.

Aderom returned one Game of Thrones generic embed in 2,579 ms. Rutube returned no exact
Interstellar title/year result after 9,155 ms. Both remain opt-in. Filmix was not probed because its
guest/private API does not improve the contract decisions for the named RP-006 candidates.

The Internet Archive proof used an explicit public-domain item returned by Advanced Search.
Metadata completed in 1,829 ms, exposed one MP4 and one workable server, and carried a public-domain
`licenseurl`. An impossible identifier returned an empty object in 2,643 ms. This is an honest
availability contract, but not useful coverage for the accepted mainstream matrix.

## Existing provider and dependency classification

| Provider   | Role after RP-006                        | Main limitation                                                                                                                   |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AniLiberty | retain default direct anime HLS          | Strong title/year matching but no canonical external IDs and real catalog gaps.                                                   |
| Initem     | retain default direct constructed embed  | Generic player-managed audio/episodes; HTML signature is weaker than proved playback.                                             |
| VideoHUB   | retain opt-in direct MP4                 | Exact episode proof and progressive output are good; signed URLs are playback-UA sensitive and tail latency/timeouts remain high. |
| VeoVeo     | retain opt-in direct HLS                 | Direct playback is useful, but DDBB is still required to discover the VeoVeo content ID. RP-012 owns this risk.                   |
| Rutube     | retain opt-in official embed             | Strong first-party provenance but movie-only and sparse exact-match coverage.                                                     |
| Aderom     | retain opt-in embed                      | Generic series/anime player; no exact episode output and an optional Wikidata bridge.                                             |
| Filmix     | retain opt-in direct MP4                 | Guest 480p/private API and optional credential; title/year matching and endpoint policy remain risks.                             |
| KinoBD     | retain lower-priority aggregate fallback | Current live outage, large downstream fan-out, and no independent upstream identity.                                              |
| DDBB       | retain bounded aggregate fallback        | Useful independent discovery path but no first-party terms/rate contract and no exact episodes.                                   |
| FlixHQ     | retain bounded international fallback    | HTML/player scraping and upstream schema drift; current probes failed parsing.                                                    |

Dependency boundaries that RP-007/RP-012 must preserve:

1. KinoBD discovers many downstream player brands, including Kodik, Alloha, Collaps, VideoCDN,
   Vibix, HDVB, and Videoseed. Those copies are not direct integrations.
2. DDBB independently discovers Alloha, Collaps, Turbo, and VeoVeo embeds.
3. The VeoVeo adapter discards the DDBB iframe token, but still calls DDBB to obtain `movie_id`
   before using VeoVeo's direct catalog and signed HLS.
4. The current normalized option records the Media Engine adapter in `provider` and the player label
   in `player`, but it does not model discovery adapter and actual upstream as separate stable
   identities. RP-007 must add that minimum distinction before deduplication.

## Consequences for the remaining program

- RP-007 should proceed: provenance/deduplication is needed even without a new direct balancer,
  because KinoBD and DDBB already duplicate downstream brands.
- RP-008 (Kodik) and RP-009 (Alloha) are blocked by user-owned credentials plus first-party contract
  evidence. They are skipped under the current credential-free product constraint.
- RP-010 (Collaps) and RP-011 (VideoCDN) are skipped as rejected candidates.
- RP-012 remains necessary and should try to remove the DDBB discovery dependency from VeoVeo
  without copying a private lookup mechanism.
- RP-013 has no accepted additional mainstream provider. Internet Archive should become a separate
  product task only if public-domain/open-license discovery is explicitly desired.
- RP-014 should prioritize progressive independent results from existing sources, bounded aggregate
  fallback, and deterministic upstream-aware deduplication rather than increasing raw provider
  count.

## Reproduction

Focused repository checks and live commands used for this checkpoint:

```text
pnpm smoke:availability
pnpm smoke:episodic-anime

# Additional bounded Node/PowerShell probes:
# - default providers against Interstellar, Game of Thrones S01E01, Death Note E01
# - AniLiberty One Piece and One-Punch Man catalog checks
# - Aderom and Rutube exact checks
# - Videasy/VidCore/APIPlayer valid-vs-impossible iframe checks
# - APIPlayer manifest valid-vs-impossible checks
# - Internet Archive Advanced Search and Metadata valid-vs-impossible checks
```

The two repository smoke commands completed without contract-regression failures. Upstream
degradation is recorded above rather than hidden or converted into a false pass.
