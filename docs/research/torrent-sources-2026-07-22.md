# Torrent source research — 2026-07-22

## Scope

This checkpoint looks for complementary English/international and Russian-language torrent
discovery sources. A built-in source must work without an API key, access token, account, private
cookie, caller-domain binding, or bundled torrent runtime. Media Engine reads bounded catalog
metadata and returns a normalized handoff; it does not download torrent payloads or join swarms.

Every accepted adapter is a separate review and commit checkpoint. Sources are not enabled in the
repository API until a later combined reliability, diversity, and duplicate-info-hash audit.

## Decision summary

| Candidate        | Language/catalog                  | Decision                         | Evidence and boundary                                                                                                                          |
| ---------------- | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| YTS              | English/international movies      | **Accept; first opt-in adapter** | Current no-key JSON API supports IMDb/title lookup and returns hash, quality, size, peers, and upload time. Movie-only scope is explicit.      |
| Bitsearch        | Broad international catalog       | **Accepted; opt-in adapter**     | Public no-key JSON API currently allows 200 requests/day per IP and returns structured hashes, sizes, categories, verification, and peers.     |
| Magnetz          | Broad international magnet index  | **Accepted; opt-in adapter**     | Public no-auth search adds material independent movie, series, and anime hashes; burst requests require conservative local pacing.             |
| JacRed           | Russian/multilingual tracker data | **Accept for later experiment**  | Current public no-token API indexes 16 trackers and returns magnet, source, Russian/original title, year, quality, voice, season, size, peers. |
| Direct Rutor     | Russian releases                  | **Defer**                        | It is public and no-account, but exposes a website/search HTML contract rather than a documented bounded API. Recheck only as a fallback.      |
| TorAPI           | Russian tracker aggregator        | **Defer as unavailable**         | The project documents a no-token API and self-hosting, but its advertised public Vercel deployment returned HTTP 402 `DEPLOYMENT_DISABLED`.    |
| Direct RuTracker | Russian releases                  | **Reject as built-in lookup**    | Search remains account-oriented and would require credentials/cookies or an intermediary. Public magnets on known pages do not fix discovery.  |
| Torrentio        | Multi-index Stremio aggregation   | **Defer**                        | The public addon is useful but has no sufficiently clear first-party standalone usage/rate-limit contract for a generic built-in client.       |

## English/international sources

### YTS — accepted first

The current [YTS API documentation](https://yts.proxyninja.net/api) names
`https://movies-api.accel.li/api/v2/` as the v2 base URL, explicitly permits free application use
without an API key, asks clients to cache and keep rates reasonable, and documents title/IMDb
queries. The list response provides one movie identity and one or more release variants.

Fresh checks for `tt1375666` and `tt0111161` returned exact Inception and The Shawshank Redemption
identities with 720p/1080p/2160p variants, 40-character info hashes, byte sizes, codecs, seeders,
leechers, and upload timestamps. A deliberately missing IMDb ID returned HTTP 200 with
`movie_count: 0`, providing an honest empty-result signal. The former `yts.mx` host did not resolve
from this environment; the adapter therefore follows the currently documented base and keeps it
configurable.

Initial adapter rules:

- movies only; series/anime/episode queries are skipped;
- exact IMDb match, or one exact normalized title plus exact year;
- strict bounded JSON parsing and safe HTTP source URLs;
- one magnet candidate per unique validated info hash;
- no torrent download, file probing, tracker connection, or peer connection;
- remain opt-in until the combined source checkpoint.

Implementation checkpoint: the opt-in adapter was added with focused config, parser, matching,
mapping, fault, timeout, and cancellation tests. Two sequential engine passes returned the same
identities and hashes for Inception, Dune: Part One, and The Shawshank Redemption. Valid calls took
about 1.5–10.0 seconds in this network; the deliberately missing IMDb lookup returned no candidates
in about 2.3 seconds. Dune exposed seven variants, including an available 2160p WEB candidate with
73 reported seeders. Inception and Shawshank also exposed 2160p variants, but their current zero
seeder counts were honestly mapped as `unseeded`. No provider failures or identity drift occurred.

The 10-second tail is too close to a normal shared provider deadline for default wiring. Direct
consumers should give this opt-in source its own 15-second engine budget while it is monitored.

### Bitsearch — accepted for a separate experiment

The current [Bitsearch API documentation](https://bitsearch.eu/api) publishes a no-key tier of 200
requests/day per IP, explicit rate-limit headers, bounded pagination, and structured search/detail
responses. A fresh `Inception 2010` search returned five JSON results in about one second, including
verified YTS hashes and an independent large multilingual release. This broad catalog can add
series and non-YTS releases, but needs stricter title/year/type/episode matching than YTS and must
respect the small anonymous quota.

Implementation checkpoint: the exported opt-in adapter now uses only one bounded search request and
does not call the detail route. It requires title plus year, pins category 2/3/4 for movie/TV/anime,
and rechecks exact normalized title, explicit year, category, season ranges, and exact ordinary or
absolute episode markers. It rejects external-ID-only and incomplete episode queries. Response
bytes, result counts, strings, IDs, dates, peer counts, and 40-character info hashes are bounded;
unique hashes become canonical magnets with source attribution and normalized release metadata.

The live API redirected the former `.to` documentation URL to `bitsearch.eu`. Anonymous responses
confirmed `X-RateLimit-Limit: 200`, a decrementing remaining count, and an ISO UTC midnight reset.
The adapter records those headers and, after observing zero remaining, refuses further network work
until the reset time. Live direct-provider checks returned 34 exact Dune 2021 candidates, 36
Inception 2010 candidates, five Game of Thrones season-one candidates, one exact S01E10 candidate,
one category-correct Attack on Titan anime candidate, and an honest empty missing control. Five
calls completed in about 0.8-0.9 seconds; the first cold Dune call took about 11.1 seconds. The
source therefore remains opt-in with a recommended 15-second budget until the combined checkpoint.
A second post-build pass retained the same first Dune, exact Game of Thrones S01E10, and Attack on
Titan hashes, again returned an empty missing control, and completed each call in about 0.5-0.7
seconds.

### Magnetz — accepted and implemented as an opt-in adapter

The current [Magnetz API documentation](https://magnetz.eu/apis) states that authentication is not
required and documents search, detail, and info-hash routes. A fresh `Inception 2010` query returned
25 candidates with ready magnet links, verification, timestamps, peers, and stable detail IDs. The
sample overlapped all three YTS hashes, so its future value must be measured on series, anime, and
non-YTS movies and duplicate hashes must remain visible to the later deduplication audit.

That comparison now justifies a separate adapter. A paced six-query pass across Inception, Dune,
The Shawshank Redemption, Game of Thrones season one, Breaking Bad season one, and Attack on Titan
season one produced 109 strict Magnetz matches. Only 32 hashes overlapped the existing YTS, JacRed,
and Bitsearch union; 77 were unique, 47 of those reported seeders, and 14 unique releases were
2160p/4K. Attack on Titan contributed 12 strict hashes where the comparison union returned none.
An earlier unpaced burst produced two transient 429s, while the repeated pass with three-second
spacing completed all six queries without an error. Successful Magnetz calls were about 0.75–0.92
seconds in that checkpoint.

The implemented provider therefore performs only one bounded page-one search request, with no
per-result detail fan-out, and spaces starts from one provider instance by one second. It requires
title and year, applies the same strict exact-title/year/season/episode identity checks as the
Bitsearch adapter, validates that the returned magnet agrees with the 40-character info hash, and
normalizes source, codec, resolution, container, HDR, size, timestamp, peers, and source
attribution. It remains opt-in until the combined reliability/diversity/deduplication checkpoint.

The live contract also drifts from the published OpenAPI: the schema advertises a `magnetz.app`
server while the working documented service is `magnetz.eu`, and live `score`/`health` values can
exceed the documented 0–1 range. The adapter pins the configurable live base/path, accepts only a
bounded observed numeric range, and does not expose those ranking values. Responses advertised
`X-RateLimit-Limit: 30`, but no stable public reset/quota policy was found.

## Russian-language sources

### JacRed — accepted for a separate experiment

The [JacRed public site](https://jacred.su/) describes an open API without registration or tokens.
Its current status response reported 16 trackers and more than 3.3 million indexed torrents. A
fresh Russian `Интерстеллар` plus year query returned 185 matches across RuTracker, Rutor, Kinozal,
BitRu, MegaPeer, NNMClub, and other sources. Results included Russian/original names, exact year,
quality/HDR, voice labels, categories, size, seeders/peers, magnet, and source URL; a deliberately
missing query returned an empty result.

There is current route drift: the documentation/OpenAPI advertises `/api/v1/search`, while the live
first-party web client calls `https://api.jacred.su/api/search`; the former returned 404 and the
latter returned healthy data. A future opt-in adapter must therefore use a configurable base/path,
strictly pin the observed schema, treat route drift as a provider failure, and pass two independent
live checkpoints before default wiring.

Implementation checkpoint: the opt-in adapter now uses the twice-confirmed `/api/search` route with
configurable base/path, exact title plus year identity, category and optional season revalidation,
strict nullable/schema/byte/result bounds, hardened transport, canonical 40-character info-hash
magnet handoffs, and source attribution. It deliberately skips exact episode queries because the
public result schema exposes seasons but no stable episode field. A fresh direct-provider matrix
returned 12 unique Dune hashes for the Russian title, 16 for the English title, 16 Breaking Bad
season-pack hashes, 14 Game of Thrones season-pack hashes, and 17 Attack on Titan anime hashes;
the missing-title control was honestly empty. Valid calls completed in about 1.3–2.3 seconds and
covered RuTracker, Rutor, Kinozal, NNMClub, BitRu, Selezen, and Toloka source links without parser
or transport failures. The provider remains opt-in until the combined source checkpoint.

A second pass retained the same top hashes and useful source diversity for Interstellar, Game of
Thrones season 1, and Attack on Titan season 1. One missing-title control transiently exhausted a
15-second budget after the earlier healthy empty result; two immediate bounded repeats with a
20-second budget returned the same honest empty result in about 1.8 and 2.3 seconds. This tail
supports keeping JacRed opt-in and documenting a 20-second provider budget until the combined
reliability checkpoint rather than treating one fast pass as default-readiness evidence.

### TorAPI and direct trackers

[TorAPI](https://github.com/Lifailon/TorAPI) is MIT-licensed, documents no-token aggregation of
RuTracker, Kinozal, Rutor, and NoNameClub, and can be self-hosted. Its advertised public deployment
was disabled during this checkpoint, so it cannot currently be a zero-setup built-in source.

Rutor remains a possible independent fallback because its official status page identifies current
domains and its public pages expose torrent metadata without an account. It has no current formal
JSON/Torznab contract suitable for this project, so direct HTML parsing is deferred rather than
silently lowering the provider acceptance standard. Direct RuTracker discovery is excluded because
it would reintroduce account/cookie handling.

## Planned order

1. YTS opt-in movie adapter.
2. JacRed opt-in Russian/multilingual adapter after confirming the live route twice.
3. Bitsearch broad international adapter with explicit anonymous quota handling.
4. Magnetz opt-in broad international adapter with provider-local request pacing.
5. Combined reliability/diversity/deduplication checkpoint before any default API wiring.

After source discovery is stable, the repository reference applications may add an optional torrent
runtime demonstration. A selected 2160p candidate can be progressively buffered and served to a
browser, but codec/container compatibility may require remuxing or transcoding. That runtime stays
outside the public core/providers/SDK packages.
