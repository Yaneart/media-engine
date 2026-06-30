import type { ExternalIds, MediaDetails, MediaType } from "../media/index.js";
import type { ResponseMeta } from "../response/index.js";

// Public query shape for media details lookup.
// Публичная форма запроса для получения деталей медиа.
export interface DetailsQuery {
  id?: string;
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  type?: MediaType;
  language?: string;
}

// Details response returned by MediaEngine.getDetails.
// Ответ с деталями, который возвращает MediaEngine.getDetails.
export interface DetailsResponse {
  query: DetailsQuery;
  details: MediaDetails | null;
  meta: ResponseMeta;
}
