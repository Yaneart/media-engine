# Providers

Providers are adapters between an external data source and the normalized core contracts. Core selects them by declared capabilities and does not know their HTTP implementation.

## Metadata providers

| Provider     | Main role                                                  | Credentials         |
| ------------ | ---------------------------------------------------------- | ------------------- |
| KinoBD       | Russian/localized movie and series metadata                | None                |
| Cinemeta     | IMDb-linked movie and series metadata                      | None                |
| Shikimori    | Anime search and details                                   | None                |
| AniList      | International anime aliases, IDs, popularity, and artwork  | None                |
| TVmaze       | Fallback IMDb-backed series identity and localized aliases | None                |
| Wikidata     | Fallback structured identity and metadata enrichment       | None                |
| IMDb dataset | Optional local TSV-backed search and details               | Local dataset files |

Default applications can combine several providers. The merge strategy uses strong IDs and compatible titles to avoid treating unrelated results as the same item.

TVmaze title discovery is fallback-only and returns only records with an IMDb identity. If the best result uses a different script from the query, the provider performs one bounded AKA lookup before exposing the alias. TVmaze data is available under CC BY-SA; normalized source records retain a link to the TVmaze show page, and consuming applications should render that attribution link. See the [TVmaze API license](https://www.tvmaze.com/api#licensing).

Wikidata is also fallback-only. Its title search filters clearly unrelated summaries before a selected-property lookup of at most three candidates, requests labels and descriptions only for the selected language plus English fallback, and caps JSON responses at 256 KiB. Entity and exact IMDb mappings use a process-local six-hour LRU cache with 256 combined entries by default. `entityLimit`, `cacheTtlMs`, and `cacheMaxEntries` can tune these values only within their documented safe bounds.

### Local IMDb dataset storage

`imdbDatasetProvider` keeps its original TSV setup for small datasets and tests:

```ts
const provider = imdbDatasetProvider({
  titleBasicsTsv,
  titleRatingsTsv,
});
```

That adapter parses the complete strings into process memory and linearly scans supported titles, so it is not the full-dataset path. Applications can instead inject an `ImdbDatasetStorage` without installing a database dependency through `@media-engine/providers`:

```ts
const provider = imdbDatasetProvider({ storage });
```

The storage contract accepts synchronous or asynchronous implementations. It receives a normalized title, optional type/year filters, a bounded result limit, and the provider abort signal. It returns ranked normalized records and provides a direct indexed IMDb ID lookup. The provider owns output mapping, confidence bounds, capabilities, and source attribution, so storage implementations do not depend on core merge internals.

For full datasets, the package includes an optional persisted SQLite/FTS implementation:

```ts
import {
  buildImdbDatasetSqliteIndex,
  imdbDatasetProvider,
  openImdbDatasetSqliteStorage,
} from "@media-engine/providers";

await buildImdbDatasetSqliteIndex({
  titleBasicsPath: "./title.basics.tsv.gz",
  titleRatingsPath: "./title.ratings.tsv.gz",
  outputPath: "./data/imdb.sqlite",
});

const storage = await openImdbDatasetSqliteStorage({
  path: "./data/imdb.sqlite",
});
const provider = imdbDatasetProvider({ storage });

// Close during application shutdown.
storage.close();
```

The builder streams plain or gzip official TSV files, imports only supported movie/series records, validates a versioned schema and integrity, and publishes a compacted temporary index through same-directory atomic replacement. A failed or cancelled rebuild leaves the previous index untouched. Existing storage instances should be closed and reopened after a successful replacement.

The SQLite path is loaded only when its build/open functions are called and requires Node.js 22.13 or newer with built-in `node:sqlite` and FTS5 trigram support. The package and in-memory TSV adapter retain the declared Node.js 20 baseline and do not load SQLite. No npm database dependency is added.

The reproducible in-memory baseline and persisted 100k/1m results are recorded in [the IMDb dataset benchmark](./benchmarks/imdb-dataset.md).

TMDB IDs remain supported in the normalized model because upstream providers may return them. There is no built-in TMDB API provider and users do not need a TMDB token.

## Streaming providers

| Provider               | Main role                                                                          | Credentials               |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| KinoBD streaming       | Discovers normalized player options for movies, series, and anime                  | None                      |
| FlixHQ streaming       | International embed options, subtitles, and explicit direct streams when available | None                      |
| DDBB streaming         | Independent Kinopoisk/IMDb route to generic movie, series, and anime embeds        | None                      |
| AniLiberty streaming   | Exact title/year anime episodes with direct first-party HLS qualities              | None                      |
| Experimental streaming | Deterministic configured options for development and tests                         | Application configuration |

Streaming providers return targets and metadata; the consuming UI decides how to render an iframe or media element. A returned third-party option may still fail because of geography, browser policy, upstream changes, or temporary availability.

KinoBD streaming shares one fixed wall deadline and a default 24-attempt child-request budget across candidate search, optional anime lookup, player loading, retries, and iframe validation. Live validation uses three workers by default, checks at most eight players, and does not start an optional nested iframe check without enough remaining time for its full validation window. The public limits are capped at 50 search candidates, 16 validated players, four validation workers, 64 child attempts, and 10 seconds for individual validation or Shikimori helper timeouts. Its optional player audit callback exposes bounded counters without changing availability results.

DDBB streaming is enabled in repository API defaults after the repeated reliability/diversity
checkpoint. It uses only caller-supplied normalized Kinopoisk/IMDb IDs and makes one generic lookup;
exact episode queries do not select it. The adapter strictly parses nullable player responses,
preserves one main option per player before unique translation URLs, and bounds response bytes,
output count, validation count/concurrency/body bytes, and validation time. It removes only
confirmed unavailable options and keeps transient checks as `unknown`. The upstream still has no
published first-party usage or rate-limit contract; direct package consumers can omit it from their
configured provider list.

AniLiberty streaming is also enabled in repository API defaults. The upstream release catalog has no
normalized external IDs, so the adapter requires title and year, accepts only a unique exact
normalized identity, and checks the same identity again on release details. Ambiguous, missing,
yearless, season-number, or ordinary episode-number queries return no result. Generic anime queries
return a bounded episode map; exact anime lookup uses `absoluteEpisodeNumber`. Safe 480p, 720p, and
1080p URLs are classified as direct HLS, while upstream geo/copyright flags become normalized
`region_locked` or `temporarily_unavailable` states. Search results, episode arrays, and response
bytes are bounded, and API calls use the hardened default transport.

## Torrent discovery providers

| Provider          | Main role                                                 | Credentials | Default API |
| ----------------- | --------------------------------------------------------- | ----------- | ----------- |
| YTS torrent       | Exact IMDb or exact title/year movie magnet data          | None        | No          |
| JacRed torrent    | Exact title/year Russian and multilingual tracker results | None        | No          |
| Bitsearch torrent | Strict movie, TV, and anime international magnet search   | None        | No          |
| Magnetz torrent   | Strict international magnet meta-search                   | None        | No          |

`ytsTorrentProvider()` uses the current documented no-key YTS JSON endpoint and is intentionally
opt-in. It supports movies only. IMDb lookup must return the same IMDb identity; title lookup
requires an exact normalized title and year and accepts only one matching movie. Each unique valid
info hash becomes a magnet handoff with normalized quality/source/codec, byte size, upload time, and
best-effort peer counts. Zero seeders are reported as `unseeded`, not silently promoted to
available.

`jacRedTorrentProvider()` is also opt-in. It requires an exact title and year, supports movies,
generic series/anime packs, and a requested season, and rechecks the returned localized/original
title, year, category, and season before mapping candidates. Exact ordinary/absolute episode
queries are deliberately skipped because the public endpoint exposes a season filter but no stable
episode field. Unique validated 40-character info hashes become canonical magnet handoffs; source
URLs, release quality/source/codec/HDR, byte size, dates, and reported seed/peer counts are bounded
and normalized. The live first-party frontend route is currently `/api/search`, while the public
site/OpenAPI still advertises a non-working `/api/v1/search`, so both `baseUrl` and `searchPath` are
configurable and route/schema drift is surfaced as a provider failure.

`bitsearchTorrentProvider()` is opt-in and uses the documented anonymous JSON search API without an
account or key. It requires title and year, selects the upstream movie/TV/anime category, and then
requires an exact normalized title, explicit year, matching category, and requested season/episode
markers in every returned release. It deliberately skips external-ID-only and underidentified
episode queries. Search JSON, result count, strings, dates, numeric fields, IDs, and info hashes are
bounded; duplicate hashes collapse into canonical magnet handoffs with normalized release and peer
metadata. The adapter observes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`; after a provider instance sees zero remaining requests it rejects further work
locally until reset instead of spending more network calls. The anonymous upstream tier currently
allows 200 requests/day per IP, so cache-backed use and a conservative 15-second provider budget
are recommended until the combined source checkpoint.

`magnetzTorrentProvider()` is opt-in and uses the documented no-auth JSON search API. It requires
title and year and locally revalidates exact normalized title, explicit year, and any requested
season, ordinary episode, or absolute episode marker. One operation makes only one first-page
search request and never amplifies it through the detail endpoints. Response bytes, pagination,
result count, strings, dates, numeric fields, same-origin source URLs, magnet/info-hash agreement,
and peer counts are strictly bounded. Duplicate hashes collapse into canonical magnet handoffs.
The published OpenAPI currently disagrees with live responses on its server domain and the ranges
of `score` and `health`; the adapter pins the observed `magnetz.eu` route and accepts the observed
bounded 0–100 numeric range without exposing those ranking fields. Live responses advertise a
30-request limit but short bursts have still produced transient 429s, so request starts are
serialized one second apart and a conservative 15-second provider budget is recommended.

The provider does not download `.torrent` files, inspect their payload, contact trackers, join a
swarm, or stream media. Its API base is configurable because the upstream has migrated domains.
The repository API keeps zero torrent providers configured until the separate English/Russian
source reliability and diversity checkpoint is complete.

```ts
const media = new MediaEngine({
  torrentProviders: [
    ytsTorrentProvider(),
    jacRedTorrentProvider(),
    bitsearchTorrentProvider(),
    magnetzTorrentProvider(),
  ],
  providerTimeouts: {
    "yts-torrent": 15_000,
    "jacred-torrent": 20_000,
    "bitsearch-torrent": 15_000,
    "magnetz-torrent": 15_000,
  },
});

const result = await media.discoverTorrents({
  type: "movie",
  title: "Inception",
  year: 2010,
  ids: { imdb: "tt1375666" },
});
```

## Provider contract

A metadata provider declares:

- stable name and optional version;
- supported media types;
- title and external-ID search capabilities;
- optional title-discovery role: `primary` by default or `fallback` for slower identity sources;
- optional `searchEnrichment: false` for providers that must stay out of best-effort search-card enrichment;
- detail lookup capabilities;
- optional features such as posters, ratings, people, seasons, or episodes;
- optional `searchPosterMatchesDetails` when the provider guarantees that its normalized search and details poster fields are identical;
- `search` and optional `getDetails` methods.

A streaming provider declares supported media types, external IDs, player kinds, and whether it supports movies, series, episodes, subtitles, translations, and direct streams. It implements `getAvailability`.

Provider methods receive request context with an abort signal, timeout, language, and debug flag. They should return normalized data and throw `ProviderError` for expected upstream failures.

## Reliability and safety

- Independent providers run concurrently behind engine timeouts.
- Retryable failures use bounded exponential backoff with jitter, respect `Retry-After`, and stay inside the provider timeout budget.
- Repeated transient failures open a per-provider circuit, suppressing wasteful calls until one recovery probe is allowed after cooldown.
- Search retries, fallback queries, and enrichment consume one shared timeout budget per provider instead of restarting the full timeout for every call.
- Primary providers handle normal title discovery. Fallback title providers run only after primary typo broadening and only for an empty result or conflicting exact-title identities; direct external-ID searches still call every compatible provider.
- Optional search-card enrichment skips providers that opt out through `searchEnrichment: false`, preventing a short enrichment deadline from consuming a provider reserved for mandatory identity fallback.
- Providers that explicitly guarantee identical normalized search/details posters reuse the search poster during canonical poster enrichment, avoiding duplicate upstream details calls. Providers without the guarantee keep the full lookup behavior.
- Optional provider failures do not erase successful results from other providers.
- HTTP response sizes, KinoBD child-request amplification, and player validation concurrency are bounded where needed.
- FlixHQ navigation stays on its explicitly configured origin, so local self-hosted origins remain possible without allowing upstream HTML or redirects to select another destination.
- Server-side player/subtitle checks resolve and validate every DNS address and redirect hop, reject local/private/reserved or mixed DNS sets, and pin fresh connections to validated addresses. A custom provider `fetch` is a trusted transport boundary and must enforce an equivalent policy.
- Built-in artwork, player, and subtitle outputs share a conservative HTTP(S)-only URL policy. It rejects credentials, raw control characters, and literal local/private/reserved targets while preserving valid CDN query parameters and signatures. Hostnames are not resolved at this output boundary; deployments that need browser-side network isolation should use an application-owned image/player proxy.
- Secrets, cookies, and private account tokens are not exposed through provider metadata.

Live integrations are best-effort. Their parsers and mappings are covered by fixtures and live smoke checks, but upstream HTML and APIs can change without notice.

## Adding a provider

1. Implement the core provider contract in `packages/providers/src/<name>`.
2. Keep configuration in the provider factory, not global state.
3. Normalize all output before returning it.
4. Add fixture-based tests for success, malformed responses, failures, timeout, and cancellation.
5. Export the factory from `packages/providers/src/index.ts`.
6. Document credentials, source limitations, and default application wiring honestly.
