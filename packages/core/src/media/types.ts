// Main media category used for filtering and type narrowing.
// Основная категория медиа для фильтрации и сужения типов.
export type MediaType = "movie" | "series" | "anime";

// External IDs used to match the same media across providers.
// Внешние ID для сопоставления одного медиа между провайдерами.
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
// Назначение изображения в медиа-модели.
export type ImageType = "poster" | "backdrop" | "logo" | "still" | "profile";

// Image metadata shared by posters, backdrops, stills, logos, and photos.
// Общие метаданные изображения для постеров, фонов, кадров, логотипов и фото.
export interface Image {
  url: string;
  type?: ImageType;
  width?: number;
  height?: number;
  language?: string;
  source?: string;
}

// Source that produced a rating value.
// Источник, который предоставил значение рейтинга.
export type RatingSource =
  "imdb" | "tmdb" | "kinopoisk" | "shikimori" | "myAnimeList" | "aniList" | "tvmaze" | "internal";

// Rating value from one source with its scale and optional vote count.
// Значение рейтинга из одного источника со шкалой и опциональным числом голосов.
export interface Rating {
  source: RatingSource;
  value: number;
  max: number;
  votes?: number;
}

// Genre label, optionally tied to a provider-specific ID.
// Название жанра с опциональным ID конкретного провайдера.
export interface Genre {
  id?: string;
  name: string;
  source?: string;
}

// External IDs used to match the same person across providers.
// Внешние ID для сопоставления одного человека между провайдерами.
export interface PersonExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
}

// Person entity independent from a specific media role.
// Сущность человека независимо от его роли в конкретном медиа.
export interface Person {
  id?: string;
  name: string;
  originalName?: string;
  photo?: Image;
  ids?: PersonExternalIds;
}

// Role a person can have in a media item.
// Роль, которую человек может иметь в медиа.
export type PersonRole =
  "actor" | "director" | "writer" | "producer" | "composer" | "voice_actor" | "unknown";

// Relationship between a person and a specific media item.
// Связь между человеком и конкретным медиа.
export interface MediaPerson {
  person: Person;
  roles: PersonRole[];
  characterName?: string;
  order?: number;
}

// Single episode metadata for series and anime.
// Метаданные одного эпизода для сериалов и аниме.
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
// Метаданные сезона с опциональными вложенными эпизодами.
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
// Статус жизненного цикла медиа.
export type MediaStatus =
  "announced" | "in_production" | "ongoing" | "released" | "ended" | "canceled" | "unknown";

// Money amount used for movie budget and revenue.
// Денежная сумма для бюджета и сборов фильма.
export interface Money {
  amount: number;
  currency: string;
}

// Collection or franchise metadata for related movies.
// Метаданные коллекции или франшизы для связанных фильмов.
export interface CollectionInfo {
  id?: string;
  title: string;
  poster?: Image;
  backdrop?: Image;
}

// Provider attribution for merged media data.
// Атрибуция провайдера для объединенных медиа-данных.
export interface ProviderSource {
  provider: string;
  ids?: ExternalIds;
  url?: string;
}

// Compact media model used in search results.
// Компактная медиа-модель для результатов поиска.
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
// Общие подробные поля для деталей фильма, сериала и аниме.
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
// Подробная модель фильма с финансовыми данными и коллекцией.
export interface MovieDetails extends BaseMediaDetails {
  type: "movie";
  budget?: Money;
  revenue?: Money;
  collection?: CollectionInfo;
}

// Detailed series model with season and episode counters.
// Подробная модель сериала со счетчиками сезонов и эпизодов.
export interface SeriesDetails extends BaseMediaDetails {
  type: "series";
  seasons?: Season[];
  episodesCount?: number;
  seasonsCount?: number;
}

// Anime release format used by anime-specific providers.
// Формат релиза аниме для аниме-специфичных провайдеров.
export type AnimeKind = "tv" | "movie" | "ova" | "ona" | "special" | "music" | "unknown";

// Detailed anime model with anime-specific episode and release fields.
// Подробная модель аниме с полями эпизодов и релиза.
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
// Объединение всех подробных медиа-моделей для дискриминирующего сужения.
export type MediaDetails = MovieDetails | SeriesDetails | AnimeDetails;
