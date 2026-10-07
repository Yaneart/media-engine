# RP-002 Russian metadata source evaluation

Status: accepted 2026-10-06  
Measured: 2026-10-06  
Runtime baseline: Media Engine `1.12.0` consumed by yaneMedia  
Branch: `feature/resilient-sources`

This task is evidence-only. It does not change provider selection, runtime code, credentials,
timeouts, caching, or public contracts.

## Executive result

The anime decision is ready: use Shikimori's current GraphQL API as the primary anime metadata
candidate. It was the only tested direct source that returned a coherent Russian title,
Russian description, poster, landscape screenshot, release kind, episode count, year, and stable
MyAnimeList identity for every anime matrix item. Keep AniList as an explicitly bounded fallback or
enrichment source rather than the Russian primary.

The movie/series decision is also ready: use the official TMDB API as the primary candidate. A
user-owned v3 API key completed the direct three-round matrix. All six works returned coherent
identity, type/year, Russian overview, poster, and backdrop; all 12 Russian/original-title searches
found the expected work. The localized `ru-RU` title is accepted as returned and does not need to use
Cyrillic: Shogun's valid display title is `Shōgun`. The same official record also exposes `Сёгун` as
a Russian search alias, but it does not need to replace the display title.

The current yaneMedia production fan-out returned complete Russian details for the seven matrix
items it found, but search plus details commonly took 7-13 seconds. Russian `Сёгун` did not locate
the expected 2024 series, while original-title `Shogun` did. This confirms that the current path is
a useful fallback baseline, not an acceptable coherent primary.

The user explicitly requires that a TMDB or Shikimori GraphQL outage must still return useful data
from the existing implementation when it can do so safely. Selection of the new primaries therefore
does not authorize deleting the current adapters; RP-003 must move them behind bounded fallback and
degraded-response semantics.

## Candidate decision

| Media class  | Candidate                         | Decision                               | Reason                                                                                                         |
| ------------ | --------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Movie/series | Official TMDB API                 | select                                 | 6/6 coherent details/artwork/identity, 12/12 alias searches, fast direct contract                              |
| Movie/series | current `tmdb.stremio.ru` adapter | retain as bounded fallback             | Indirect and sometimes slow, but preserves existing coverage after official-TMDB failure                       |
| Movie/series | current KinoBD/Cinemeta fan-out   | retain as bounded fallback             | Existing coverage remains available after primary/stale failure, but leaves the healthy critical path          |
| Anime        | Shikimori GraphQL                 | select                                 | 6/6 Russian title and description, 6/6 poster and backdrop, correct release kind/count, direct public contract |
| Anime        | current Shikimori v1 details path | retain as bounded fallback             | Complete output remains useful if GraphQL fails, despite its outdated three-request contract                   |
| Anime        | AniList GraphQL                   | defer to bounded fallback/enrichment   | Excellent identity and artwork, but 0/6 Russian primary titles and 0/6 Russian descriptions                    |
| All classes  | current production fan-out        | preserve behind fallback orchestration | Complete when it finds the work; must not delay a healthy primary response                                     |

Official TMDB is selected only for canonical movie/series routing. Its valid Spirited Away record
must not reclassify that canonical anime film or enter the normal anime metadata path.

## Metadata matrix

### Anime details

The six cases were Death Note, Frieren, Solo Leveling, Jujutsu Kaisen, Re:Zero Season 2 Part 2, and
Spirited Away. The split-season Re:Zero release and the anime film make release-shape errors visible.

| Candidate                 | Russian title | Russian description | Poster | Backdrop | Kind/count/year |   Stable external ID |
| ------------------------- | ------------: | ------------------: | -----: | -------: | --------------: | -------------------: |
| Shikimori GraphQL         |           6/6 |                 6/6 |    6/6 |      6/6 |             6/6 |              6/6 MAL |
| Current Shikimori adapter |           6/6 |                 6/6 |    6/6 |      6/6 |             6/6 |              6/6 MAL |
| AniList                   |           0/6 |                 0/6 |    6/6 |      6/6 |             6/6 | 6/6 MAL plus AniList |

Shikimori GraphQL returned all six records in one request. Its three repeated batch measurements
were 835, 361, and 333 ms (p50 361 ms). The current Shikimori adapter separately calls v1 details,
roles, and screenshots; on the five episodic cases its three-round p50 was 660 ms and observed p95
was 1,610 ms. AniList used one GraphQL call per item; its corresponding p50 was 273 ms and observed
p95 was 726 ms.

AniList commonly includes a Russian synonym and therefore found most Russian searches, but it maps
English/Romaji title and English description into the returned details. That is insufficient for a
Russian-first primary. It also returned Frieren when deliberately given contradictory AniList and
MAL IDs, because the current adapter prioritizes the AniList ID without validating the supplied MAL
ID. Shikimori rejected the equivalent contradiction.

Shikimori GraphQL returned these release shapes:

| Work              | Shikimori/MAL ID | Kind    | Episodes | Year |
| ----------------- | ---------------: | ------- | -------: | ---: |
| Death Note        |             1535 | `tv`    |       37 | 2006 |
| Frieren           |            52991 | `tv`    |       28 | 2023 |
| Solo Leveling     |            52299 | `tv`    |       12 | 2024 |
| Jujutsu Kaisen    |            40748 | `tv`    |       24 | 2020 |
| Re:Zero S2 Part 2 |            42203 | `tv`    |       12 | 2021 |
| Spirited Away     |              199 | `movie` |        1 | 2001 |

`episodesAired` was zero for old completed Death Note and Spirited Away records, so the contract must
use declared `episodes` as the completed release count and must not treat `episodesAired` alone as
authoritative. This matches the current adapter's `max(episodes, episodesAired)` behavior.

### Anime search aliases

Shikimori GraphQL ranked the expected work first for all 12 Russian/original-title queries. AniList
ranked the expected work first for 11/12; the exact Russian split-season query for Re:Zero returned
no result. Both sources found the other Russian aliases through localized titles or synonyms.

Shikimori search measurements were 207-746 ms; after the first request, all were 207-301 ms.
AniList search measurements were 259-763 ms; after the first request, all were 259-286 ms. AniList
response headers reported the currently reduced limit of 30 requests/minute and decreasing
`X-RateLimit-Remaining` values.

### Official TMDB movie/series details and search

The authenticated direct matrix ran three details rounds for the five movie/series cases plus
Spirited Away as a negative routing guard. Every response matched the expected TMDB and IMDb
identity, year, and media class. TV counts were also exact: Game of Thrones 8 seasons / 73 episodes,
Breaking Bad 5 / 62, and Shogun 1 / 10.

| Work            | Russian title contract | Russian overview | Poster          | Backdrop  | Identity/type/year |
| --------------- | ---------------------- | ---------------- | --------------- | --------- | ------------------ |
| Interstellar    | `Интерстеллар`         | complete         | 2000x3000, `ru` | 3840x2160 | exact              |
| Parasite        | `Паразиты`             | complete         | 2000x3000, `ru` | 2732x1536 | exact              |
| Game of Thrones | `Игра Престолов`       | complete         | 2000x3000, `ru` | 3840x2160 | exact              |
| Breaking Bad    | `Во все тяжкие`        | complete         | 2000x3000, `ru` | 3000x1688 | exact              |
| Shogun          | `Shōgun`               | complete         | 2000x3000, `ru` | 1920x1080 | exact              |
| Spirited Away   | `Унесённые призраками` | complete         | 2000x3000, `ru` | 1920x1080 | exact, keep anime  |

The 18 details calls had p50 151 ms and observed p95 749 ms. The single 749 ms value included the
first connection; rounds two and three stayed between 113 and 226 ms. The 12 searches took 223-264
ms and found the expected work for every Russian and original-title alias. Shogun ranked second for
`Сёгун` without a year and first for `Shogun`; the provider contract must pass an available year
filter and preserve multiple plausible search results rather than silently choosing by title alone.

Successful details responses exposed ETags and public `max-age` values from zero to about 5.5 hours.
These upstream values are useful revalidation inputs but do not replace the product's own bounded
fresh/stale contract.

For this product, "Russian title" means the non-empty title selected by the provider's Russian
localization contract. Cyrillic script is not mandatory. Russian alternative titles remain useful
for search matching and identity-safe aliases, not forced display-title replacements.

### Current production path

These measurements called the running yaneMedia HTTP search and canonical details endpoints. They
are a dated comparison, not a new service-level guarantee.

| Work/query                             |   Search |  Details | Required Russian fields/artwork |
| -------------------------------------- | -------: | -------: | ------------------------------- |
| Death Note / `Тетрадь смерти`          | 7,488 ms | 5,717 ms | complete                        |
| Frieren / `Фрирен`                     | 7,293 ms | 2,045 ms | complete                        |
| Spirited Away / `Унесённые призраками` | 5,388 ms | 7,900 ms | complete                        |
| Interstellar / `Интерстеллар`          | 8,080 ms | 3,620 ms | complete                        |
| Parasite / `Паразиты`                  | 5,559 ms | 5,045 ms | complete                        |
| Game of Thrones / `Игра престолов`     | 5,031 ms | 4,276 ms | complete                        |
| Breaking Bad / `Во все тяжкие`         | 5,014 ms | 8,487 ms | complete                        |
| Shogun / `Shogun`                      | 9,090 ms |   861 ms | complete                        |

`Сёгун` returned results but not the expected 2024 series; `Сегун` returned none. The original title
`Shogun` returned the canonical 2024 work with Russian title, Russian description, poster,
backdrop, one season, and ten episodes. RP-001 explains why these complete results are still slow:
the current details response waits for several identity and metadata sources and merges their fields.

## Official TMDB gate

### Contract evidence

Official documentation confirms:

- application authentication uses either a v3 `api_key` or a server-side Bearer API Read Access
  Token;
- localized endpoints accept language-country values such as `ru-RU`;
- movie and TV details support `append_to_response`, so external IDs can be fetched with the same
  coherent details operation;
- movie external IDs include IMDb and Wikidata; TV external IDs also include TVDB;
- configuration publishes the supported CDN poster/backdrop sizes up to `original`;
- the legacy 40 requests/10 seconds limit is disabled, but TMDB documents a mutable upper boundary
  around 40 requests/second and requires honoring HTTP 429;
- the developer API is free for non-commercial use with attribution; commercial use requires a
  commercial agreement; the product must show the TMDB logo and required non-endorsement notice;
- TMDB provides no SLA.

Primary sources:

- <https://developer.themoviedb.org/docs/authentication-application>
- <https://developer.themoviedb.org/docs/languages>
- <https://developer.themoviedb.org/docs/rate-limiting>
- <https://developer.themoviedb.org/docs/faq>
- <https://developer.themoviedb.org/reference/movie-details>
- <https://developer.themoviedb.org/reference/tv-series-details>
- <https://developer.themoviedb.org/reference/movie-external-ids>
- <https://developer.themoviedb.org/reference/tv-series-external-ids>
- <https://developer.themoviedb.org/reference/configuration-details>

### Credential state and repeatable matrix

A user-owned 32-character v3 API key is configured locally in the ignored repository `.env`. The
value was read only into a child-process environment variable and was never printed, copied into
documentation, or added to Git. It is now correctly named `TMDB_API_KEY`; a future Bearer Read
Access Token, if supported, must use a separate validated configuration name.

The authenticated matrix used `api_key` query authentication. The unauthenticated control still
correctly returned:

```text
GET https://api.themoviedb.org/3/movie/157336?language=ru-RU
HTTP 401 in 723 ms
status_code 7: Invalid API key
```

The completed three-run cold/repeat matrix queried:

| Work            | Type  | TMDB ID | Expected canonical class     |
| --------------- | ----- | ------: | ---------------------------- |
| Interstellar    | movie |  157336 | movie                        |
| Parasite        | movie |  496243 | movie                        |
| Game of Thrones | TV    |    1399 | series                       |
| Breaking Bad    | TV    |    1396 | series                       |
| Shogun          | TV    |  126308 | series                       |
| Spirited Away   | movie |     129 | remain anime in Media Engine |

For each row it tested Russian and original-title search, `ru-RU` details, localized title and
overview, poster/backdrop metadata and source dimensions, year/type, appended external IDs, and TV
season counts. Spirited Away proves that a valid TMDB `movie` result must not reclassify a canonical
anime film. The negative matrix also produced HTTP 404/status 34 for an unknown ID, rejected a
deliberately contradictory IMDb identity, propagated a one-millisecond client timeout, and
confirmed HTTP 401/status 7 without authentication. HTTP 429 mapping is required from the official
contract but was not induced against the real account quota.

The implementation candidate must read the token only from server-owned configuration, redact it
from logs and errors, and never expose it through Core, SDK, repository API, or yaneMedia DTOs.

## Failure and cache semantics

| Candidate/path            | Missing work                    | Wrong type/identity                                                 | Timeout/cancel           | Upstream cache headers             |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| Shikimori GraphQL         | HTTP 200, empty list            | verify returned `id` and `malId`; reject mismatch                   | Fetch abort is supported | private, revalidate; ETag observed |
| Current Shikimori adapter | HTTP 404 becomes provider error | wrong media type returns null; contradictory MAL returns null       | abort propagates         | three independently failing calls  |
| AniList adapter           | HTTP 404 becomes provider error | wrong type returns null; contradictory MAL is currently not checked | abort propagates         | `no-cache, private`                |
| Official TMDB             | HTTP 404, status 34             | verify returned TMDB/type plus appended IMDb; reject mismatch       | Fetch abort is supported | public max-age plus ETag observed  |

All accepted sources therefore need Media Engine's bounded application cache. Upstream headers do
not provide the product's five-minute fresh and thirty-minute stale contract. The exact mandatory
fields, fallback triggers, stale eligibility, and safe public error mapping remain RP-003 work.

## Credentials, limits, and usage terms

### Official TMDB

- Required: user-owned API key or API Read Access Token, held server-side. A v3 key is available
  locally for implementation and later live verification.
- Current documented upper boundary: approximately 40 requests/second; honor 429 dynamically.
- Non-commercial developer use requires attribution. Commercial use requires contacting TMDB.
- Required UI/legal work: approved TMDB logo plus the documented non-endorsement notice in an
  About/Credits surface.

### Shikimori

- Public metadata reads succeeded without an OAuth bearer token.
- Official API documentation requires the OAuth2 application name in `User-Agent`, forbids browser
  impersonation, and documents 5 requests/second plus 90 requests/minute.
- The same documentation marks REST v1/v2 outdated, asks clients to prefer GraphQL, and states that
  new posters are available only through GraphQL.
- yaneMedia currently constructs `shikimoriProvider()` without the required application
  `User-Agent`; RP-004 must make this server-owned configuration mandatory for the selected path.
- The general site terms do not provide a clear standalone commercial data license. Commercial
  deployment should obtain explicit confirmation from Shikimori rather than infer permission.

Primary sources:

- <https://shikimori.io/api/doc/1.0>
- <https://shikimori.io/api/doc/graphql>
- <https://shikimori.io/terms>

### AniList

- Public media GraphQL reads require no user token.
- The official page currently reports a degraded limit of 30 requests/minute rather than the normal
  90, plus a burst limiter and one-minute 429 cooldown.
- The API has no availability guarantee and may return 403 or be suspended during severe outages.
- Terms prohibit using AniList as backup/storage, mass collection, and competing tracker services.
  Commercial use above the documented USD 150/month revenue threshold requires a license.

Primary sources:

- <https://docs.anilist.co/guide/rate-limiting>
- <https://docs.anilist.co/guide/considerations>
- <https://docs.anilist.co/guide/terms-of-use>

## Proposed RP-003 inputs

RP-003 should specify:

1. official TMDB as the sole blocking movie/series primary;
2. Shikimori GraphQL as the sole blocking anime primary;
3. coherent snapshots keyed and validated by TMDB ID plus appended external IDs, or Shikimori ID
   plus MAL ID and exact release kind;
4. non-empty Russian-localized title (without a Cyrillic requirement), Russian description, poster,
   backdrop, type/release kind, year, and stable identity as mandatory primary fields;
5. a verified stale snapshot first when the primary has a retryable outage, followed by bounded
   existing-source fallback when stale data is unavailable or the primary misses a mandatory field;
6. the current Shikimori REST path and AniList as anime fallbacks, never allowing unnoticed English
   enrichment to replace a complete Russian primary snapshot;
7. the current indirect TMDB, Cinemeta, and useful KinoBD metadata behind movie/series fallback
   orchestration, outside the healthy primary critical path and without requiring every fallback to
   finish after one coherent result succeeds;
8. fallback identity/type validation equal to the primary path, so resilience cannot mix works,
   reclassify anime, or return a mismatched season/release;
9. explicit degraded/provenance diagnostics for stale and fallback responses without exposing raw
   provider errors or credentials;
10. server-owned TMDB secret and Shikimori application User-Agent configuration, with documented
    attribution and commercial-usage decisions before release.

## Reproduction

The live comparison used the built 1.12.0 provider exports and the running yaneMedia HTTP API. The
queries are deliberately shown without credentials:

```powershell
# Confirm the official TMDB authentication boundary.
Invoke-WebRequest `
  -Uri 'https://api.themoviedb.org/3/movie/157336?language=ru-RU' `
  -UseBasicParsing

# Current production comparison.
Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/v1/media/search?query=Интерстеллар&type=movie&limit=20'
```

Anime candidate measurements called:

```text
POST https://shikimori.io/api/graphql
POST https://graphql.anilist.co
```

with exact IDs and search aliases listed above. No provider payload, credential, or internal URL was
added to a public DTO. No full repository gate was run because this task changes documentation only.

## Next checkpoint

RP-002 is ready for user acceptance. After acceptance, update the resilient-sources plan and project
memory once, then stop for the user's Git operation. The next separate task is RP-003: specify the
primary metadata and fallback contract. Do not implement a provider or start RP-003 in this task.
