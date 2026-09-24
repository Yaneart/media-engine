# Identity Resolver sources (ID-04)

The five source factories in `@media-engine/providers` implement the internal
`IdentityResolverSource` contract. ID-05 will decide where to instantiate them and how to pass
their results through search, details, and availability. Neither changes public `media.id` yet.

| Source                      | Exact lookup anchors                                                           | Confirmed record IDs                     | Status                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------- |
| `wikidataIdentitySource()`  | IMDb P345, movie TMDB P4947, series TMDB P4983, Kinopoisk P2603, or known Q ID | IMDb, typed TMDB, Kinopoisk, Wikidata    | Fixture and live checked; no token                                                |
| `kinobdIdentitySource()`    | IMDb or Kinopoisk                                                              | IMDb, TMDB, Kinopoisk                    | Fixture checked; live endpoint timed out, so do not rely on it as the only source |
| `aniListIdentitySource()`   | AniList or MyAnimeList                                                         | AniList, MyAnimeList                     | Fixture and live checked for anime; no token                                      |
| `shikimoriIdentitySource()` | Shikimori or MyAnimeList                                                       | Shikimori, MyAnimeList                   | Fixture and live checked for anime; no token                                      |
| `aderomIdentitySource()`    | Kinopoisk                                                                      | IMDb, MyAnimeList, WorldArt when present | Fixture and live checked for anime and series; no token                           |

Wikidata searches for one exact property value through the MediaWiki API, loads that entity's
claims, and checks that the original anchor occurs in that same entity. It requires an unambiguous
entity and an explicit movie or series `P31` instance. It ignores deprecated claims and withholds
any namespace with multiple values. TMDB's movie and TV properties are kept separate. The source
does not resolve anime: a TV or film entity cannot by itself establish the project's anime type.
KinoBD likewise requires exactly one record with the requested type and anchor value; title matches
are never accepted as mapping evidence.

AniList queries an `ANIME` record by its AniList or MyAnimeList ID and requires the input ID in
the returned record. Shikimori loads an anime record by its Shikimori or MyAnimeList ID and checks
the returned ID field before linking it. A shared MyAnimeList ID can therefore bridge AniList and
Shikimori across resolver passes. Neither source infers a movie, series, or Kinopoisk ID from anime
titles.

Aderom uses a Kinopoisk-keyed JSON record and checks the returned Kinopoisk ID and category.
It can add anime's MyAnimeList, WorldArt, and IMDb IDs when valid. Its sampled Game of Thrones
record contains malformed IMDb `tt944947`, which is rejected; that series lookup only confirms
the Kinopoisk anchor. Aderom's IMDb-to-Kinopoisk fallback actually queries Wikidata, so it is
not an independent IMDb mapping source. Its movie coverage is absent in the sampled API.

Live adapter checks on 2026-09-24 returned the following exact mappings in **each** available
direction (IMDb, TMDB, and Kinopoisk as the initial anchor):

| Type   | Work            | IMDb        |     TMDB | Kinopoisk | Wikidata    |
| ------ | --------------- | ----------- | -------: | --------: | ----------- |
| Movie  | Interstellar    | `tt0816692` | `157336` |  `258687` | `Q13417189` |
| Series | Game of Thrones | `tt0944947` |   `1399` |  `464963` | `Q23572`    |

For Frieren, live calls to AniList returned AniList `154587` and MyAnimeList `52991` when anchored
by either ID. Shikimori returned Shikimori `52991` and MyAnimeList `52991` when anchored by either
ID. These four adapter calls took 0.3–1.3 seconds locally. Exact ID checks and the anime type
constraint also have fixture coverage.
For Frieren, Aderom's Kinopoisk `5401195` record returned IMDb `tt22248376`, MyAnimeList
`52991`, and WorldArt `11466`. Its Game of Thrones `464963` record returned the same Kinopoisk
anchor but no usable new ID. Both adapter calls succeeded locally.

The six Wikidata adapter calls took 1.1–2.9 seconds in one local run. KinoBD's IMDb endpoint
timed out after 10 seconds in the same environment; its availability and limits remain unverified.
The ID-03 resolver's default two-second per-source timeout can cut off some cold Wikidata calls;
ID-05 must choose a suitable configured source timeout within its overall latency budget.
These live observations are time dependent and do not verify the stage environment.

Official property definitions: [IMDb P345](https://www.wikidata.org/wiki/Property:P345),
[TMDB movie P4947](https://www.wikidata.org/wiki/Property:P4947),
[TMDB TV series P4983](https://www.wikidata.org/wiki/Property:P4983), and
[Kinopoisk P2603](https://www.wikidata.org/wiki/Property:P2603).
The [MediaWiki Wikibase search syntax](https://www.mediawiki.org/wiki/Help:Extension:WikibaseCirrusSearch)
documents `haswbstatement`. [AniList's Media query](https://docs.anilist.co/guide/graphql/queries/media)
and [Media fields](https://docs.anilist.co/reference/object/media) document its typed anime lookup
and MyAnimeList ID. The official TMDB API is not a baseline source because no API token
is configured. Aderom's streaming-local IMDb → Kinopoisk fallback stays inside its adapter until
ID-05 can replace it without making streaming depend on metadata availability. Initem accepts
IMDb or Kinopoisk embed routes, but its sampled HTML exposed Kinopoisk only inside a third-party
advertising URL, not as an explicit media identity field. It is a useful playback source but is
not yet a resolver mapping source.
