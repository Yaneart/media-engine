# Media Engine Data Model

## Approach

The data model uses shared base entities and discriminated unions for type-specific details.

```ts
type MediaDetails = MovieDetails | SeriesDetails | AnimeDetails;
```

This keeps common fields reusable while preserving TypeScript narrowing for movies, series, and anime.

## MediaType

```ts
export type MediaType = "movie" | "series" | "anime";
```

More specific types like `ova`, `ona`, `special`, or `cartoon` may be added later, but early versions stay simple.

## ExternalIds

```ts
export interface ExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  worldArt?: string;
}
```

All external IDs are strings. External IDs are the strongest matching signal.

## MediaItem

Compact model for search results:

```ts
export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  originalTitle?: string;
  alternativeTitles?: string[];
  year?: number;
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
  poster?: Image;
  backdrop?: Image;
  genres?: Genre[];
  ratings?: Rating[];
  ids?: ExternalIds;
}
```

`id` is the engine-level stable ID for a normalized result. In early versions it may be derived from the strongest known external ID, for example `imdb:tt0816692` or `tmdb:157336`. It must not expose provider raw object references.

## BaseMediaDetails

```ts
export interface BaseMediaDetails extends MediaItem {
  status?: MediaStatus;
  runtimeMinutes?: number;
  countries?: string[];
  languages?: string[];
  images?: Image[];
  persons?: MediaPerson[];
  sourceProviders?: ProviderSource[];
}
```

## MovieDetails

```ts
export interface MovieDetails extends BaseMediaDetails {
  type: "movie";
  budget?: Money;
  revenue?: Money;
  collection?: CollectionInfo;
}
```

## SeriesDetails

```ts
export interface SeriesDetails extends BaseMediaDetails {
  type: "series";
  seasons?: Season[];
  episodesCount?: number;
  seasonsCount?: number;
}
```

## AnimeDetails

```ts
export interface AnimeDetails extends BaseMediaDetails {
  type: "anime";
  animeKind?: AnimeKind;
  episodes?: Episode[];
  episodesCount?: number;
  airedOn?: string;
  releasedOn?: string;
  ageRating?: string;
}
```

```ts
export type AnimeKind =
  | "tv"
  | "movie"
  | "ova"
  | "ona"
  | "special"
  | "music"
  | "unknown";
```

## MediaStatus

```ts
export type MediaStatus =
  | "announced"
  | "in_production"
  | "ongoing"
  | "released"
  | "ended"
  | "canceled"
  | "unknown";
```

## Image

```ts
export interface Image {
  url: string;
  type?: ImageType;
  width?: number;
  height?: number;
  language?: string;
  source?: string;
}
```

```ts
export type ImageType =
  | "poster"
  | "backdrop"
  | "logo"
  | "still"
  | "profile";
```

## Rating

```ts
export interface Rating {
  source: RatingSource;
  value: number;
  max: number;
  votes?: number;
}
```

```ts
export type RatingSource =
  | "imdb"
  | "tmdb"
  | "kinopoisk"
  | "shikimori"
  | "myAnimeList"
  | "aniList"
  | "internal";
```

Ratings are stored per source. Early versions do not calculate one global rating.

## Genre

```ts
export interface Genre {
  id?: string;
  name: string;
  source?: string;
}
```

## Person

```ts
export interface Person {
  id?: string;
  name: string;
  originalName?: string;
  photo?: Image;
  ids?: PersonExternalIds;
}
```

```ts
export interface PersonExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
}
```

## MediaPerson

```ts
export interface MediaPerson {
  person: Person;
  roles: PersonRole[];
  characterName?: string;
  order?: number;
}
```

```ts
export type PersonRole =
  | "actor"
  | "director"
  | "writer"
  | "producer"
  | "composer"
  | "voice_actor"
  | "unknown";
```

## Season

```ts
export interface Season {
  id?: string;
  number: number;
  title?: string;
  description?: string;
  poster?: Image;
  episodes?: Episode[];
  episodesCount?: number;
  releaseDate?: string;
}
```

## Episode

```ts
export interface Episode {
  id?: string;
  seasonNumber?: number;
  episodeNumber: number;
  absoluteNumber?: number;
  title?: string;
  description?: string;
  releaseDate?: string;
  runtimeMinutes?: number;
  still?: Image;
}
```

`seasonNumber + episodeNumber` is common for series. `absoluteNumber` is useful for anime.

## Money

```ts
export interface Money {
  amount: number;
  currency: string;
}
```

## CollectionInfo

```ts
export interface CollectionInfo {
  id?: string;
  title: string;
  poster?: Image;
  backdrop?: Image;
}
```

## ProviderSource

```ts
export interface ProviderSource {
  provider: string;
  ids?: ExternalIds;
  url?: string;
}
```

## Rules

- All dates are ISO strings when possible.
- All external IDs are strings.
- Provider raw responses are not part of the public model.
- Metadata and streaming availability are not mixed in early versions.
- Missing provider data is represented with optional fields.

## Streaming Data

Streaming availability uses a separate model described in `docs/11-streaming-data-model.md`.

The metadata model answers what a media item is. The streaming model answers which player or stream options are available for an already selected media item or episode.
