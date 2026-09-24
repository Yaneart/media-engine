# Identity Resolver ID-01: local baseline

Captured on 2026-09-24 from the local Docker Compose API after an API restart. The repository and
Compose configuration contain no stage URL, so this does **not** establish the cause of a missing
Kinopoisk ID on stage. The exact local observations are in
[`identity-resolver-baseline.local.json`](identity-resolver-baseline.local.json). Upstream availability
and timing are time-dependent.

## Reproduce

With the Compose API healthy and current Core/Providers builds present:

```powershell
docker compose exec -T api sh -c 'node scripts/identity-baseline.mjs > docs/research/identity-resolver-baseline.local.json'
```

The script calls the local HTTP API for search, details, and Initem availability. Details and
availability use the search result's `ids`, as the demo does. It also calls isolated metadata
providers through a debug-enabled Core engine, where per-provider timings are exposed. Pass an
HTTP base URL as the script's first argument to inspect a reachable stage API, while the isolated
provider checks continue to run locally. The probe with a manually supplied Kinopoisk ID is a
control, **not** evidence that metadata resolved that ID.

| Work                     | Search `id`             | Search and details `ids`                | Search / details, uncached | Initem options with returned IDs / known KP |
| ------------------------ | ----------------------- | --------------------------------------- | -------------------------: | ------------------------------------------: |
| Interstellar (movie)     | `tmdb-movie-157336`     | IMDb `tt0816692`, TMDB `157336`         |             5095 / 5005 ms |                                       1 / 1 |
| Game of Thrones (series) | `tmdb-series-1399`      | IMDb `tt0944947`, TMDB `1399`           |             6436 / 5004 ms |                                       1 / 1 |
| Frieren (anime)          | `shikimori:anime:52991` | Shikimori/MAL `52991`, AniList `154587` |             2002 / 1291 ms |                                       0 / 1 |

No selected response contained `ids.kinopoisk` or an `EXTERNAL_ID_CONFLICT` warning. The
availability probes with manually supplied Kinopoisk IDs used `258687`, `464963`, and `5401195`
respectively. Returned-ID Initem availability took 777, 919, and 1077 ms; the last response was
successful but empty. The known-KP probes each returned one option. These are option-discovery
results, not playback checks.

The local API reported `kinobd:PROVIDER_TIMEOUT` for both movie and series search; details also
timed out or saw an open KinoBD circuit. Isolated IMDb search showed:

| Provider   | Interstellar `id` and `ids`            | Game of Thrones `id` and `ids`          | Provider-call timings      |
| ---------- | -------------------------------------- | --------------------------------------- | -------------------------- |
| Cinemeta   | `cinemeta-movie-tt0816692`; IMDb, TMDB | `cinemeta-series-tt0944947`; IMDb, TMDB | 616 / 123 ms               |
| TMDB addon | `tmdb-movie-157336`; IMDb, TMDB        | `tmdb-series-1399`; IMDb, TMDB          | 683 / 394 ms               |
| KinoBD     | Failed                                 | Failed                                  | 5 s deadline in both cases |
| Wikidata   | `wikidata-movie-Q13417189`; IMDb only  | Failed                                  | 2002 ms / 5 s deadline     |

For these **local** movie and series examples, the missing Kinopoisk ID originates before merge:
the successful Cinemeta/TMDB responses contain no Kinopoisk value, KinoBD was unavailable, and
the current Wikidata adapter only maps IMDb into `ids`. Search merge retained the IMDb/TMDB IDs
it received; details retained the same IDs. The API query parser and demo both carry those IDs
onward. Frieren's successful anime metadata sources returned anime IDs only; no confirmed
Kinopoisk mapping reached availability. Initem then had no supported external ID for Frieren,
while its explicit Kinopoisk control succeeded. Stage still needs its own response/log trace.

## Current identity flow and compatibility

| Boundary                       | Current behavior                                                                                                                                                                        | Migration concern                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Provider → Core search/details | Providers return native `id` plus optional `ids`; merge groups compatible candidates by strong external IDs and keeps the primary provider's native `id`.                               | Provider order or availability can change public `id` for one work. The isolated Cinemeta/TMDB checks demonstrate two such values.    |
| Core search enrichment         | At most six visible candidates; ID enrichment is gated by missing rating, description, or poster and by an eligible provider with a useful missing field.                               | A complete card can keep incomplete `ids`. Search's identity snapshot is process-local and cannot provide a durable canonical ID.     |
| Core details and availability  | Details requires a namespaced external ID. Availability accepts `ids` and can run a title-based metadata search for missing provider-required IDs, accepting only an unambiguous match. | Resolver output must preserve conflict checks and reach both operations. It must not infer an ID from the title alone.                |
| HTTP API                       | Search returns `item.id` and `item.ids`; details accepts `imdb`, `kinopoisk`, etc. or `ids.*`. Plain `id`-only details requests return `INVALID_QUERY`/HTTP 400.                        | Keep the current response `id` meaning until a versioned migration. Document old stored links that only contain a provider-native ID. |
| SDK                            | Types expose both fields and serialize named IDs; the deprecated details `id` parameter is still serialized.                                                                            | Existing callers can store `id`, but it is not a valid standalone details lookup. New canonical ID needs a distinct field first.      |
| Demo                           | Search and details render `ids`; selected item passes `ids` to details and availability. `item.id` is used as a React key. Torrent discovery is fed external IDs.                       | Check key stability and any saved client state when the public `id` contract changes.                                                 |

The configured metadata timeout is 5 seconds. The existing quality gate budgets are 5 seconds
for search/details and 8 seconds for availability. This cold local sample exceeded the search
budget for Game of Thrones and reached the details deadline for both movie and series. The
Initem-only availability probe does not measure full multi-provider availability.

ID-02 can use this baseline as the pre-change contract. Before attributing a stage-specific
missing ID, repeat the same script against its API and inspect the corresponding provider
outcomes there.
