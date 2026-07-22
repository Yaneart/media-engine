# Streaming source research — 2026-07-21, updated 2026-07-22

## 2026-07-22 follow-up

This follow-up supersedes the original Kinobox `defer` decision and evaluates the additional
Lampa/Skaz and Kinogo leads supplied after the first checkpoint. It also records a small shortlist
of independent no-key services discovered while separating actual provider contracts from frontend
aggregators and advertising wrappers. No production adapter was created.

### Updated decision summary

| Candidate              | Decision                                      | Main reason                                                                                                                                                            |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kinobox                | **Reject as a built-in public provider**      | The owner closed the public API on 2025-07-01 and moved the maintained product to paid domain-bound or private-source deployments.                                     |
| Skaz/Lampac itself     | **Reject as one aggregate provider**          | Its public routes require an account and its real adapters live server-side, but its balancer list is useful for finding upstreams to integrate independently.         |
| AniLiberty             | **Proceed as an opt-in experiment**           | Its current first-party OpenAPI exposes no-key title search, honest missing results, episode maps, and working first-party HLS; external-ID matching still needs care. |
| Videasy                | **Defer for manual playback validation**      | First-party docs expose direct TMDB and AniList embeds, but valid and missing outer pages are indistinguishable, so constructed options must remain `unknown`.         |
| Kinogo page scraping   | **Reject**                                    | The supplied page is Cloudflare-gated and exposes a changing website/ad integration, not an ID-based provider API with a bounded availability contract.                |
| VidLink                | **Defer**                                     | Movie/episode identity is useful, but sandboxed embeds are explicitly rejected and the sampled anime endpoint produced an undefined stream.                            |
| VidCore                | **Defer for a browser playback checkpoint**   | Its documented availability endpoint is promising, but all five returned HLS targets were HTTP 451 from this network and source latency was highly variable.           |
| VidSrc `.ru` / `.link` | **Reject from this checkpoint**               | Missing and valid IDs are indistinguishable at the outer endpoint; `.link` is a wrapper around another embed service and `.ru` loads a shared ad-supported shell.      |
| APIPlayer              | **Defer as currently unavailable**            | The documented no-key contract is suitable, but every sampled embed/list/subtitle request returned Cloudflare 502.                                                     |
| DDBB                   | **Proceed only as the approved opt-in chunk** | The prior measured contract is still the approved general movie/series integration target; AniLiberty is now a separate stronger anime-specific candidate.             |

### Kinobox closure and current service model

The old public API did not migrate to another free domain. The first-party Kinobox chat explains
the observed shutdown:

- the [2025-06-16 owner announcement](https://t.me/KinoboxChat/10041) says the service would enter a
  closed mode on 2025-07-01, public API access would be closed, and personal application/source
  deployments would be sold with or without domain binding;
- the [2025-11-03 update](https://t.me/KinoboxChat/10045) describes continued commercial
  development, new Veoveo support, per-IP request limits, and a paid domain-bound/private-source
  model;
- a [2026-03-09 archived homepage](https://web.archive.org/web/20260309014026id_/https://kinobox.tv/)
  contains only embedded copies of those two announcements;
- `kinobox.tv`, `/api`, and `/docs` now returned 404 or intermittent transport failures from the
  same address; `kinobox.in` redirected to `on.kinohub.vip`, which also failed direct TLS reads in
  this checkpoint;
- no current first-party public repository, public replacement API, or no-key usage contract was
  found. Third-party repositories still calling `api.kinobox.tv` preserve the obsolete client
  contract and are not evidence that the public service remains supported.

The old docs were genuine and useful historically, but they no longer authorize or describe a
public built-in provider. Kinobox may only be reconsidered as a separately configured commercial
integration after a user supplies their own licensed deployment and its explicit contract; it must
not be shipped as a default no-token provider.

### Lampa by Skaz and `skaz.tv/o.js`

`lampa.byskaz.ru` is a Lampa application shell. The supplied `skaz.tv/o.js` is a Lampac client that:

- races `online3/4/5/7.skaz.tv` or their `onlinecf` variants and chooses a mirror;
- sends TMDB, Kinopoisk, IMDb, title, year, type, and locale context to server-side `lite/events`,
  `externalids`, and per-balancer routes;
- can receive player qualities, subtitles, episode lists, and direct playback calls;
- lists many downstream labels, including Collaps, Kodik, Alloha, Vibix, VideoCDN, Veoveo,
  Videasy, VidSrc, VidLink, TwoEmbed, AutoEmbed, and others.

That list is useful as a discovery index. It can be used to identify independently operated sources,
read their own current documentation, and implement original Media Engine adapters against their
public contracts. The upstream adapters and availability logic live on the Skaz/Lampac server, so
copying the frontend plugin would not give Media Engine those providers.
Fresh unauthenticated calls to `/lite/withsearch` and `/lite/events` returned
`{"accsdb":true,...}` and required a Lampa synchronization account. The client additionally uses
plain HTTP mirrors, WebSocket/RCH callbacks, `eval`/`evalrun`, and server-directed browser requests.
Those mechanisms are outside the project's credential-free and bounded-trust model. Do not create a
Skaz/Lampac provider and do not execute or port this client code.

#### What the Skaz source map adds

The static synchronization list contained 52 distinct labels. They do not prove that every source is
currently healthy, but they are useful leads. Comparing the list with the repository and current
public contracts produced these groups:

- Alloha, Ashdi, CDNMovies, HDVB, Kinotochka, Kodik, Vibix, VideoCDN, and Videoseed are already in
  KinoBD streaming's default player allowlist. Separate adapters would add value only if their own
  public contract creates a genuinely independent lookup path, not merely another route to the same
  iframe;
- Filmix/FXAPI, KinoPub, Rezka/RHS-related labels, and several `rc/*` variants are credentialed,
  account-oriented, private, or server-side routes rather than suitable built-in no-key contracts;
- AnimeGo, AnimeVost, AnimeBest, AniMedia, AnimeLib, MoonAnime, and similar site labels did not expose
  a current first-party ID-based streaming API in this checkpoint. Website scraping would inherit
  the same brittle HTML/anti-bot problems as Kinogo;
- generic constructed-embed labels such as AutoEmbed, TwoEmbed, VidSrc, Hydraflix, and SmashyStream
  need an honest availability signal or must be returned only as `unknown`; several lack current
  first-party documentation or a durable active domain;
- AniLibria/AniLiberty and Videasy did expose useful current first-party contracts and were tested
  separately below.

### Supplied Kinogo page

The exact `lv.kinogo.ec/9545-sosny.html` request redirected to HTTPS and then returned a Cloudflare
challenge. The apex and a related mirror behaved the same. Public urlscan records for other recent
Kinogo detail pages showed a DataLife Engine website, changing hashed frontend assets, and an
`agl010.pro` script/iframe chain. Inspection of that chain identified it as an advertising loader,
not a movie lookup API. No stable Kinopoisk/IMDb/TMDB availability endpoint, provider attribution,
rate limit, or response schema was exposed.

The exact page's actual player upstream cannot be claimed from this evidence. Even if a browser can
render it, a Cloudflare-protected site scraper would be brittle, hard to test deterministically, and
unable to distinguish a valid metadata page from playable availability without browser execution.
Do not add Kinogo page scraping as either metadata or streaming infrastructure.

### Independent shortlist checks

#### AniLiberty — proceed as an opt-in experiment

The old AniLibria V3 repository now marks itself deprecated and points to the current
[first-party AniLiberty API V1](https://anilibria.top/api/docs/v1). Its OpenAPI publishes no-key
release search, release details, and episode detail routes. Live checks against both documented
hosts showed:

- `GET /api/v1/app/search/releases?query=One%20Piece` returned 11 candidates; an intentionally
  missing query returned an empty array;
- exact release reads returned complete episode arrays with ordinals, opening/ending markers,
  duration, 480p/720p/1080p HLS, geo/copyright flags, and update timestamps;
- a nonexistent release ID returned HTTP 404 rather than a generic player shell;
- sampled One Piece and One Punch Man 720p playlists returned HTTP 200 with
  `application/x-mpegURL` and valid media-segment entries;
- the API required no account, cookie, API key, or copied Lampac logic.

This is a technically viable independent Media Engine provider, especially for Russian anime
voiceover. It should search by normalized title plus year, select only a strong unique match, map
episode `ordinal` to `absoluteEpisodeNumber`, expose the first-party HLS qualities, preserve block
flags, and return `null` on ambiguous or missing matches. The main limitation is identity: the API
does not expose MAL, AniList, or Shikimori IDs, so the adapter must not guess solely from a loose title
match. Keep it explicit opt-in until matching and usage boundaries are reviewed.

#### Videasy — useful direct embed, pending manual playback

The current [first-party Videasy documentation](https://www.videasy.to/) publishes predictable
no-key embed URLs for TMDB movies, exact TMDB TV episodes, AniList anime episodes, and AniList anime
movies. This would give Media Engine a direct AniList/TMDB path without first discovering a title on
FlixHQ, even though FlixHQ sometimes already returns a Videasy player downstream.

Live outer-page checks returned 200 for Interstellar, Game of Thrones S01E01, One Piece episode 1,
and deliberately missing movie/series/anime IDs. The valid and missing pages used the same Next.js
shell and provided no server-side availability result. The responses did not set `X-Frame-Options`
or a restrictive `frame-ancestors` policy, and the sampled anime player code did not contain
VidLink-style sandbox rejection, but this does not prove successful playback in the reference
stand's restricted iframe.

A future Videasy adapter can therefore construct exact TMDB/AniList embed URLs, but it must label
them `availability: "unknown"`. Before enabling it, manually verify first frame, seek, missing-ID
error UI, advertisements/redirects, and movie/series/anime playback with the existing sandbox. Do
not call its private player internals or turn their current implementation details into our API.

#### AutoEmbed variants — not a standalone provider yet

`autoembed.app` documents IMDb/TMDB movie and exact-episode embeds, but all three sampled player
requests timed out without response. `autoembed.co` stayed reachable, but its outer page simply
constructed three iframes (its own player, TwoEmbed, and VidSrc) for both valid and impossible IDs;
the direct player also returned nearly identical 200 shells for both. This is another aggregator
without honest availability, not a stronger independent source than AniLiberty or a direct Videasy
embed.

#### VidLink — defer

The [first-party VidLink documentation](https://vidlink.pro/) provides TMDB movie URLs, exact TMDB
season/episode URLs, and MAL anime episode URLs. Valid Interstellar and Game of Thrones pages returned
200 with matching metadata in roughly 4.2–5.5 seconds; an invalid TMDB ID returned 500. This is
better identity/error signaling than an always-200 constructed embed.

Blocking findings:

- its current player code explicitly replaces the page with `Please Disable Sandbox` when the
  iframe has a sandbox attribute, conflicting with the repository's restricted embed policy;
- the One Piece MAL episode sample returned 200 but constructed a worker URL containing
  `url=undefined`;
- a successful metadata page does not prove that the client-side protected source lookup found a
  playable stream;
- no explicit rate-limit or durable service-status contract was found.

Recheck only with a permitted real-browser playback matrix and a security decision about unsandboxed
third-party embeds. Do not weaken the reference stand's sandbox policy to accommodate it.

#### VidCore — defer for browser validation

The [VidCore documentation](https://www.vidcore.org/),
[REST reference](https://www.vidcore.org/docs/rest-api-reference), and
[terms](https://www.vidcore.org/terms) explicitly describe no-key TMDB embeds, exact TV episodes,
metadata, and a public source endpoint. The endpoint returned `available: 1` for two movies and three
exact TV/anime episodes, and `available: 0` for a deliberately missing ID. Observed source responses
also included provider labels, HLS typing, and latency metadata.

However, a second checkpoint immediately fetched each selected HLS target and received HTTP 451 for
all five. API source selection ranged from about 0.8 seconds to 8.8 seconds and sometimes selected a
different fastest upstream for the same title. The public status page asserts page/API availability
but does not report downstream stream health, and no concrete rate limit was published. Therefore:

- do not expose the returned URLs as normalized direct HLS yet;
- do not treat `available: 1` as proven playback;
- a future experiment may validate only the documented VidCore embed in a sandboxed real browser,
  including first frame, seek, missing-title behavior, advertising, redirects, cancellation, and
  repeated movie/episode coverage.

#### VidSrc variants and APIPlayer

- `vidsrc.link` returned a simple iframe wrapper around `vsembed.ru` for both valid and missing IDs;
  it did not independently validate availability.
- `vidsrc.ru` returned the same small SPA shell for valid and invalid IDs and loaded a third-party ad
  script. Its outer response cannot support honest availability semantics.
- [APIPlayer documentation](https://apiplayer.ru/docs) is comparatively clear: no API key, IMDb/TMDB
  movie and exact episode embeds, public lists/subtitles, and a stated 60 requests/minute limit. In
  this live checkpoint, however, all sampled movie, series, anime, missing-ID, list, and subtitle
  requests returned Cloudflare 502 with `Retry-After: 60`. Keep it deferred until two healthy
  checkpoints demonstrate the documented contract.

### Follow-up conclusion

The Skaz client itself should not be transplanted, but its source map did produce integrations that
can be designed independently. AniLiberty is the strongest newly identified source and is technically
ready for a small explicit opt-in provider experiment. Videasy is the next useful direct adapter once
manual sandboxed playback is confirmed; until then it can only promise an `unknown` constructed
embed. Kinobox is a closed commercial product, Kinogo remains unsuitable for scraping, and VidLink
and VidCore stay in the playback-validation backlog.

The previously approved general-purpose production chunk remains opt-in DDBB, with DDBB Live
excluded and no default API enablement. If anime coverage is prioritized first, AniLiberty can be
implemented as a separate smaller chunk before DDBB without depending on Skaz or copying its code.

## Original 2026-07-21 decision summary

| Candidate | Decision                              | Main reason                                                                                                                                                                   |
| --------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kinobox   | **Defer**                             | The documented service model is suitable, but the current API failed every live request and the public routes no longer match the published documentation.                    |
| DDBB      | **Defer**                             | The Kinopoisk/IMDb player API was technically useful and fast, but no first-party documentation, terms, attribution guidance, contact, or rate-limit contract could be found. |
| DDBB Live | **Reject as an independent provider** | It returned the same payloads and upstream players as DDBB, with worse tail latency and an additional timeout; it is a mirror, not an independent source.                     |
| RHServ    | **Reject**                            | Excluded by the approved development plan and not re-evaluated.                                                                                                               |

At that original checkpoint, no production adapter was ready. Its DDBB findings remain relevant,
while the 2026-07-22 follow-up above supersedes the old Kinobox and next-candidate conclusions.

## Scope and method

The checkpoint followed Development Stage 1 and made no production-code changes.

- Source map: the current [ReYohoho deployment](https://dav2010id.github.io/reyohoho/) and its
  MIT-licensed [source repository](https://github.com/dav2010ID/reyohoho).
- ReYohoho adapters inspected:
  [Kinobox](https://github.com/dav2010ID/reyohoho/blob/main/src/api/movies.kinobox.js),
  [DDBB](https://github.com/dav2010ID/reyohoho/blob/main/src/api/movies.ddbb.js), and
  [DDBB Live](https://github.com/dav2010ID/reyohoho/blob/main/src/api/movies.ddbb-live.js).
- First-party material inspected: cached
  [Kinobox API documentation](https://kinobox.tv/api) and
  [embed documentation](https://kinobox.tv/docs/).
- Representative API matrix: Interstellar, Dune (2021), Game of Thrones, House of the Dragon,
  One Piece anime, and a missing Kinopoisk ID.
- Two independent sequential checkpoints used fresh requests, a 12-second request deadline, and
  no stored cookies or credentials.
- A separate bounded iframe check read at most 128 KiB from the four returned DDBB player types for
  a movie, series, and anime.
- The existing Media Engine baseline was captured from a clean build and a fully recreated Docker
  stack before any candidate integration.

Live measurements describe the observed upstream state on 2026-07-21, not a permanent service
guarantee.

## Existing Media Engine baseline

Baseline commit: `1da8f9d complete final release audit hardening`. Public providers package:
`@media-engine/providers@0.1.1`.

Current public streaming factories:

- `experimentalStreamingProvider`
- `flixHqStreamingProvider`
- `kinobdStreamingProvider`

The default API enables `kinobd-streaming` and `flixhq-streaming`. After a clean build and fresh
`docker compose up -d --build --force-recreate`, API and example healthchecks were healthy on ports
3000 and 5173.

### Fresh metadata/API sample

| Request                | Canonical result                                      | Engine time | Provider state                                             |
| ---------------------- | ----------------------------------------------------- | ----------: | ---------------------------------------------------------- |
| Interstellar search    | Interstellar (2014), IMDb `tt0816692`, KP `258687`    |      890 ms | KinoBD + Cinemeta successful                               |
| Game of Thrones search | Game of Thrones (2011), IMDb `tt0944947`, KP `464963` |    1,047 ms | KinoBD + Cinemeta successful                               |
| One Piece anime search | One Piece (1999), MAL/AniList `21`                    |    1,529 ms | Shikimori + AniList successful                             |
| Dune movie search      | Dune (2021), IMDb `tt1160419`, KP `409424`            |    3,655 ms | KinoBD + Cinemeta + Wikidata successful                    |
| Interstellar details   | Interstellar (2014), canonical IDs preserved          |    5,009 ms | Wikidata timed out; KinoBD + Cinemeta preserved the result |

### Fresh default availability sample

| Request                | Result                                    | Engine time | Isolation behavior                                         |
| ---------------------- | ----------------------------------------- | ----------: | ---------------------------------------------------------- |
| Interstellar           | 3 FlixHQ/Videasy/Vidmoly embeds           |   10,005 ms | KinoBD streaming timed out; FlixHQ preserved useful output |
| Game of Thrones S01E01 | 6 KinoBD/FlixHQ embeds, 6 episode options |    7,497 ms | Both providers successful                                  |
| One Piece anime        | 5 KinoBD embeds                           |    6,703 ms | KinoBD successful; FlixHQ correctly ineligible             |

After the sample, readiness stayed `ok`; all eight circuits were closed. Request counters recorded
one isolated Wikidata failure and one isolated KinoBD streaming failure without opening a circuit.
Container logs contained no application errors.

This is the behavior new providers must preserve: canonical search/details identity, partial
availability during one-provider failure, provider attribution, closed healthy circuits, and clean
Docker health.

## Candidate contracts

### Kinobox

ReYohoho currently targets:

```text
GET https://api.kinobox.tv/api/players?kinopoisk={id}
```

Its adapter expects an object containing `data[]`, where each entry has `type`, `iframeUrl`, and
optional `translations`. It also contains undocumented movie/search calls under the same host, but
those are outside the proposed streaming-only scope.

The older first-party Kinobox documentation instead describes:

```text
GET https://kinobox.tv/api/players
```

with Kinopoisk, IMDb, TMDB, title, and source filters, a top-level response array, `source`,
`success`, `updatedAt`, and a limit of two requests per second per IP. The embed documentation also
describes source-specific season/episode query parameters.

Observed state:

- `api.kinobox.tv` and `kinobox.tv` resolved to the same address.
- All 12 live API attempts failed before an HTTP response with an HTTP/2 protocol/TLS stream error.
- Plain HTTP returned 404.
- `https://kinobox.tv/api/players?...` returned a 301 redirect to a Selectel 1 GB speed-test file.
- `https://kinobox.tv/docs/`, `/api/`, and the published script route returned 404 in direct checks.
- No account cookie or private token was documented for the public lookup API, but availability and
  current response shape could not be verified.

The cached documentation and current ReYohoho adapter also disagree on host and response schema.
That is material contract drift even if the TLS failure is temporary.

### DDBB

ReYohoho targets:

```text
GET https://p2.ddbb.lol/api/players?kinopoisk={id}&n=0
```

Live checks additionally confirmed IMDb lookup:

```text
GET https://p2.ddbb.lol/api/players?imdb={tt-id}
```

TMDB lookup returned HTTP 400. No title lookup was established.

Observed response shape:

```json
{
  "data": [
    {
      "type": "Alloha | Collaps | Turbo | Veoveo",
      "iframeUrl": "https://... | null",
      "translations": [
        {
          "id": "number | null",
          "name": "string | null",
          "quality": "string | null",
          "iframeUrl": "https://..."
        }
      ]
    }
  ]
}
```

Contract observations:

- Responses used JSON and `Access-Control-Allow-Origin: *` and did not require a stored cookie,
  account, API key, or caller token.
- The service set an HTTP-only session cookie, but requests remained successful without retaining
  it.
- All returned playback targets were HTTPS iframe URLs. The API exposed no direct HLS or MP4.
- A missing numeric ID returned HTTP 200 with four named entries whose `iframeUrl` values were
  `null`; an adapter must not treat those entries as availability.
- A malformed Kinopoisk ID returned HTTP 400 with a JSON string. POST returned HTTP 405.
- No `Retry-After` or rate-limit headers were observed.
- `n=0`, `n=1`, and added `season=1&episode=1` produced identical series payloads. The endpoint
  returns a generic series embed with an internal selector, not exact episode mapping.
- The same movie/anime records resolved by Kinopoisk and IMDb. Only those two ID sources are
  technically confirmed.

No API/OpenAPI/Swagger documentation, terms, privacy policy, security contact, attribution rules,
rate-limit policy, or stable service homepage could be found on `ddbb.lol`, `p2.ddbb.lol`, or the
DDBB Live domains. Public reachability and the MIT license of ReYohoho's adapter do not license the
upstream service or establish its usage boundary.

### DDBB Live

ReYohoho added DDBB Live on 2026-06-18 and targets:

```text
GET https://a.ddbb.live/api/players?kinopoisk={id}&n=0
```

The adapter reuses DDBB mapping and changes only the source label and base URL. The apex
`ddbb.live` did not resolve during this checkpoint; the `a.ddbb.live` subdomain did.

Across all comparable successful probes, DDBB Live returned the same schema, player types,
translation counts, iframe URLs, and normalized payload hashes as DDBB. The two hosts resolve to
different addresses, but expose the same logical source and same downstream player failures.

## Live checkpoint results

Representative ratios exclude the intentionally missing ID.

| Candidate | Checkpoint | API usable |    p50 |      p95 | Transport/schema notes                                            |
| --------- | ---------- | ---------: | -----: | -------: | ----------------------------------------------------------------- |
| Kinobox   | 1          |        0/5 |      — |        — | 6/6 requests failed at transport level including missing-ID probe |
| Kinobox   | 2          |        0/5 |      — |        — | Same 6/6 transport failures                                       |
| DDBB      | 1          |        5/5 | 167 ms |   753 ms | Missing ID used nullable-player shape                             |
| DDBB      | 2          |        5/5 | 182 ms |   944 ms | Correct canonical Dune 2021 KP ID included                        |
| DDBB Live | 1          |        5/5 | 167 ms |   789 ms | Payloads matched DDBB                                             |
| DDBB Live | 2          |        5/5 | 184 ms | 1,913 ms | Payloads matched DDBB                                             |

Combined formal Kinopoisk-matrix latency was approximately p50 170 ms / p95 944 ms for DDBB and
p50 167 ms / p95 1,913 ms for DDBB Live. Extra diagnostic repeats outside the formal matrix saw
one 15-second DDBB IMDb timeout and one 15-second DDBB Live Kinopoisk timeout, so neither host should
be treated as failure-free.

### Bounded iframe validation

DDBB returned Alloha, Collaps, Turbo, and Veoveo for each sampled movie, series, and anime.

| Player  | Movie | Series | Anime | Result                                 |
| ------- | ----: | -----: | ----: | -------------------------------------- |
| Alloha  |   404 |    404 |   404 | Confirmed broken in 3/3 samples        |
| Collaps |   200 |    200 |   200 | Usable embed HTML                      |
| Turbo   |   200 |    200 |   200 | Usable embed HTML; slow anime response |
| Veoveo  |   200 |    200 |   200 | Usable embed HTML; slow anime response |

Overall main-iframe usability was 9/12 (75%), while every media case still had three usable embed
choices. Among usable iframes, latency was approximately p50 1.3 seconds and p95 6.7 seconds. The
API's sub-second response time therefore does not represent end-to-end player readiness.

## Final decisions

### Kinobox — defer

Positive evidence:

- first-party docs describe public embedding, Kinopoisk/IMDb lookup, translations, qualities, and
  episode-related parameters;
- the documented two-request-per-second ceiling would be straightforward to enforce;
- an embed-only provider fits the Media Engine contract without copying frontend code.

Blocking evidence:

- 0/10 representative live lookups across two checkpoints;
- direct docs/API/script routes no longer serve the documented application;
- live host/schema used by ReYohoho differs from the published first-party contract.

Reconsider only after the official endpoint is restored and two fresh checkpoints confirm one
stable host/schema and current terms.

### DDBB — defer, technically preferred

Positive evidence:

- 10/10 Kinopoisk matrix results across two formal checkpoints;
- confirmed Kinopoisk and IMDb support for movie, series, and anime;
- no caller credentials or retained cookie required;
- simple bounded JSON shape and at least three usable embeds per sampled media item;
- partial/broken player entries can be filtered deterministically.

Blocking evidence:

- no first-party documentation or usage/attribution boundary;
- no published rate-limit or retry contract;
- generic series embeds do not resolve a requested season/episode;
- 25% of sampled main player links were already broken and tail iframe latency reached 6.7 seconds;
- extra valid-ID diagnostics included a timeout.

If usage is clarified, the safe initial integration scope is an explicit opt-in
`ddbbStreamingProvider` with Kinopoisk/IMDb lookup, `embed` only, no `episode_mapping`, strict nullable
schema filtering, bounded player validation, conservative concurrency, and independent timeout and
circuit state. It should not be enabled in the default API until a later reliability gate.

### DDBB Live — reject as an independent provider

It adds no observed catalog or player diversity over DDBB. Shipping both would duplicate requests,
options, attribution, and failure load while pretending to provide independent coverage. It also had
worse observed tail latency and an additional timeout. Do not create a separate provider or export.
If DDBB is accepted later, a user-supplied base URL can cover controlled mirror experiments without
hard-coding DDBB Live as another source.

## Required next action

The user confirmed that any provider requiring a token, key, account, private credential, or domain
binding is out of scope and delegated source ordering on 2026-07-22. Proceed in three separate
commit-sized chunks:

1. implement DDBB as an explicit opt-in independent general provider, using Kinopoisk/IMDb lookup,
   `embed` only, no exact episode-mapping claim, strict nullable parsing, bounded
   validation/concurrency/timeouts, cancellation, typed errors, attribution, fixtures and fault
   tests, and no initial default API enablement;
2. after DDBB is committed, implement AniLiberty as a separate opt-in anime provider using strict
   title/year matching, honest ambiguity/missing behavior, absolute episode ordinals, direct HLS
   qualities, block flags, bounded calls, and no dependency on Skaz;
3. after both providers are committed, run a dedicated reliability/diversity checkpoint and decide
   whether either belongs in API defaults. Count independent lookup paths and usable options, not
   merely repeated downstream player labels.

Keep Videasy deferred until manual sandboxed playback validation. Do not implement DDBB Live,
Kinobox, Skaz/Lampac, Kinogo scraping, VidLink, VidCore, VidSrc, APIPlayer, or direct token-bound
Alloha/Kodik/Vibix/VideoCDN/HDVB-style integrations in these chunks.
