// Main media category used for filtering and type narrowing.
export type MediaType = "movie" | "series" | "anime";

// External IDs used to match the same media across providers.
export interface ExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  worldArt?: string;
}

// Purpose of an image in the media model.
export type ImageType = "poster" | "backdrop" | "logo" | "still" | "profile";

// Image metadata shared by posters, backdrops, stills, logos, and photos.
export interface Image {
  url: string;
  type?: ImageType;
  width?: number;
  height?: number;
  language?: string;
  source?: string;
}

// Source that produced a rating value.
export type RatingSource =
  | "imdb"
  | "tmdb"
  | "kinopoisk"
  | "shikimori"
  | "myAnimeList"
  | "aniList"
  | "internal";

// Rating value from one source with its scale and optional vote count.
export interface Rating {
  source: RatingSource;
  value: number;
  max: number;
  votes?: number;
}

// Genre label, optionally tied to a provider-specific ID.
export interface Genre {
  id?: string;
  name: string;
  source?: string;
}

// External IDs used to match the same person across providers.
export interface PersonExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
}

// Person entity independent from a specific media role.
export interface Person {
  id?: string;
  name: string;
  originalName?: string;
  photo?: Image;
  ids?: PersonExternalIds;
}

// Role a person can have in a media item.
export type PersonRole =
  | "actor"
  | "director"
  | "writer"
  | "producer"
  | "composer"
  | "voice_actor"
  | "unknown";

// Relationship between a person and a specific media item.
export interface MediaPerson {
  person: Person;
  roles: PersonRole[];
  characterName?: string;
  order?: number;
}

// Single episode metadata for series and anime.
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

// Season metadata with optional nested episodes.
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

// Lifecycle status of a media item.
export type MediaStatus =
  | "announced"
  | "in_production"
  | "ongoing"
  | "released"
  | "ended"
  | "canceled"
  | "unknown";

// Money amount used for movie budget and revenue.
export interface Money {
  amount: number;
  currency: string;
}

// Collection or franchise metadata for related movies.
export interface CollectionInfo {
  id?: string;
  title: string;
  poster?: Image;
  backdrop?: Image;
}

// Provider attribution for merged media data.
export interface ProviderSource {
  provider: string;
  ids?: ExternalIds;
  url?: string;
}

// Compact media model used in search results.
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

// Shared detailed fields used by movie, series, and anime details.
export interface BaseMediaDetails extends MediaItem {
  status?: MediaStatus;
  runtimeMinutes?: number;
  countries?: string[];
  languages?: string[];
  images?: Image[];
  persons?: MediaPerson[];
  sourceProviders?: ProviderSource[];
}

// Detailed movie model with movie-specific financial and collection data.
export interface MovieDetails extends BaseMediaDetails {
  type: "movie";
  budget?: Money;
  revenue?: Money;
  collection?: CollectionInfo;
}

// Detailed series model with season and episode counters.
export interface SeriesDetails extends BaseMediaDetails {
  type: "series";
  seasons?: Season[];
  episodesCount?: number;
  seasonsCount?: number;
}

// Anime release format used by anime-specific providers.
export type AnimeKind = "tv" | "movie" | "ova" | "ona" | "special" | "music" | "unknown";

// Detailed anime model with anime-specific episode and release fields.
export interface AnimeDetails extends BaseMediaDetails {
  type: "anime";
  animeKind?: AnimeKind;
  episodes?: Episode[];
  episodesCount?: number;
  airedOn?: string;
  releasedOn?: string;
  ageRating?: string;
}

// Union of all detailed media models for discriminated narrowing.
export type MediaDetails = MovieDetails | SeriesDetails | AnimeDetails;

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
