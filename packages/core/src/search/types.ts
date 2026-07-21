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

// How one candidate title matched a text search query.
// Как название одного кандидата совпало с текстовым поисковым запросом.
export type SearchTitleMatchKind =
  | "not_applicable"
  | "none"
  | "exact_primary"
  | "exact_alias"
  | "joined"
  | "prefix"
  | "contains"
  | "all_tokens"
  | "fuzzy";

// One normalized ranking factor together with its configured weight and contribution.
// Один нормализованный ranking-фактор вместе с его весом и вкладом.
export interface SearchRankSignal {
  value: number;
  weight: number;
  contribution: number;
}

// Debug-only explanation of a built-in search result score and final position.
// Debug-only объяснение score и итоговой позиции встроенного search result.
export interface SearchRankEvidence {
  formula: "external_id" | "non_text" | "text";
  matchStrength:
    "exact_id" | "exact_title_year_type" | "normalized_title_year_type" | "weak" | "none";
  titleMatch: {
    kind: SearchTitleMatchKind;
    score: number;
    matchedTitle?: string;
  };
  signals: {
    base: SearchRankSignal;
    title: SearchRankSignal;
    exactPrimaryTitle: SearchRankSignal;
    popularity: SearchRankSignal;
    rating: SearchRankSignal;
    externalIds: SearchRankSignal;
    sourceCoverage: SearchRankSignal;
    sourceAuthority: SearchRankSignal;
  };
  preBoundedScore: number;
  scorePosition: number;
  diversityPosition: number;
  finalPosition: number;
  diversity: {
    family: string;
    adjusted: boolean;
  };
}

// One merged search result with score and source attribution.
// Один объединенный результат поиска с оценкой и атрибуцией источников.
export interface MediaSearchResult {
  item: MediaItem;
  score: number;
  sources: ProviderSource[];
  ranking?: SearchRankEvidence;
}

// Search response returned by MediaEngine.search.
// Ответ поиска, который возвращает MediaEngine.search.
export interface SearchResponse {
  query: SearchQuery;
  results: MediaSearchResult[];
  meta: ResponseMeta;
}
