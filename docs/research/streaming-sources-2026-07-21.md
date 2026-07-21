# Streaming source research — 2026-07-21

## Decision summary

| Candidate | Decision                              | Main reason                                                                                                                                                                   |
| --------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kinobox   | **Defer**                             | The documented service model is suitable, but the current API failed every live request and the public routes no longer match the published documentation.                    |
| DDBB      | **Defer**                             | The Kinopoisk/IMDb player API was technically useful and fast, but no first-party documentation, terms, attribution guidance, contact, or rate-limit contract could be found. |
| DDBB Live | **Reject as an independent provider** | It returned the same payloads and upstream players as DDBB, with worse tail latency and an additional timeout; it is a mirror, not an independent source.                     |
| RHServ    | **Reject**                            | Excluded by the approved development plan and not re-evaluated.                                                                                                               |

No production adapter should be created from this checkpoint. DDBB is the only candidate worth
reconsidering after its usage boundary is clarified. Kinobox should be rechecked only after its
official API is restored.

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

## Required next decision

Stage 2 should remain paused. The next useful action is to clarify DDBB's permitted API usage,
attribution, contact, and rate limit with the service owner or another first-party statement.

After that:

1. If clarified positively, implement DDBB alone as one explicit opt-in provider chunk.
2. If the boundary remains unknown, leave DDBB deferred and do not add placeholder code.
3. Recheck Kinobox only after its official API visibly recovers.
4. Do not implement DDBB Live independently.
