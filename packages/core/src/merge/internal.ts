import type { ExternalIds } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { MatchStrength } from "./types.js";

// External ID object key used when merging provider IDs.
// Ключ объекта внешних ID, используемый при объединении ID провайдеров.
export type ExternalIdKey = keyof ExternalIds;

// Provider search result paired with its original input position.
// Результат поиска провайдера вместе с исходной позицией во входном массиве.
export interface SearchEntry {
  result: ProviderSearchResult;
  index: number;
}

// Provider details result paired with its original input position.
// Результат деталей провайдера вместе с исходной позицией во входном массиве.
export interface DetailsEntry {
  result: ProviderDetailsResult;
  index: number;
}

// Internal group of search results that represent the same media item.
// Внутренняя группа результатов поиска, которые описывают одно медиа.
export interface SearchGroup {
  entries: SearchEntry[];
  matchStrength: MatchStrength;
}

// Selected external ID value together with the provider that supplied it.
// Выбранное значение внешнего ID вместе с провайдером, который его дал.
export interface SelectedExternalId {
  value: string;
  provider: string;
}

// Strong IDs that can safely prove two results describe the same media.
// Сильные ID, которые безопасно доказывают, что два результата описывают одно медиа.
export const STRONG_ID_KEYS = ["imdb", "tmdb", "kinopoisk", "shikimori", "myAnimeList"] as const;

// All external ID fields copied into a merged media item.
// Все поля внешних ID, которые копируются в объединенный media item.
export const EXTERNAL_ID_KEYS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
] as const;
