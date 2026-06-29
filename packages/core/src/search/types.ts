import type { ExternalIds, MediaItem, MediaType, ProviderSource } from "../media/index.js";
import type { ResponseMeta } from "../response/index.js";

// Public query shape for media search.
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
export interface MediaSearchResult {
  item: MediaItem;
  score: number;
  sources: ProviderSource[];
}

// Search response returned by MediaEngine.search.
export interface SearchResponse {
  query: SearchQuery;
  results: MediaSearchResult[];
  meta: ResponseMeta;
}
