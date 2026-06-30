import type { ExternalIds, MediaItem, MediaType, ProviderSource } from "../media/index.js";
import type { ResponseMeta } from "../response/index.js";

// Public query shape for media search.
// Публичная форма запроса для поиска медиа.
export interface SearchQuery {
  title?: string;
  type?: MediaType;
  year?: number;
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  limit?: number;
  language?: string;
}

// One merged search result with score and source attribution.
// Один объединенный результат поиска с оценкой и атрибуцией источников.
export interface MediaSearchResult {
  item: MediaItem;
  score: number;
  sources: ProviderSource[];
}

// Search response returned by MediaEngine.search.
// Ответ поиска, который возвращает MediaEngine.search.
export interface SearchResponse {
  query: SearchQuery;
  results: MediaSearchResult[];
  meta: ResponseMeta;
}
