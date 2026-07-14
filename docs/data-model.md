# Data model

Media Engine maps different upstream formats into a small set of shared TypeScript types.

## Media identity

Every search item has:

- a provider-derived `id`;
- `type`: `movie`, `series`, or `anime`;
- a display `title`;
- optional year, descriptions, images, genres, ratings, and external IDs.

`ExternalIds` can contain IMDb, TMDB, Kinopoisk, Shikimori, MyAnimeList, AniList, and World Art identifiers. Keeping an ID in the model does not imply that Media Engine calls that service directly.

## Search and details

`MediaItem` is the compact search representation. `MediaDetails` is a discriminated union:

- movie details may include runtime, budget, revenue, and collection;
- series details may include seasons and episode counts;
- anime details may include anime format, episodes, airing dates, and age rating.

Shared detail fields include status, countries, languages, images, people, and provider attribution.

Titles and descriptions can be localized. `originalTitle` remains separate from the display title, and `alternativeTitles` preserves useful aliases.

## Images, ratings, and sources

Images carry a URL plus optional type, dimensions, language, and source. Ratings preserve their source, scale, and optional vote count instead of converting every value to one opaque score.

Provider attribution stays attached to merged results so consumers can see where IDs and metadata came from.

## Availability

Streaming data is deliberately separate from metadata.

`MediaAvailability` identifies the requested media and contains:

- top-level player or stream options;
- optional episode-level option groups;
- provider execution metadata.

A `StreamOption` can describe:

- player kind: embed, HLS, MP4, or external;
- access URL and allowed request metadata;
- translation or voice/subtitle variant;
- quality;
- subtitle and audio tracks;
- episode reference;
- expiry time;
- provider source and availability status.

Optional fields are omitted when an upstream source does not provide trustworthy data. The model avoids inventing language, quality, or availability guarantees.

## Source of truth

Refer to the exported declarations in `@media-engine/core` for exact fields and unions:

- `media/types`;
- `search/types`;
- `details/types`;
- `response/types`;
- `streaming/types`.
