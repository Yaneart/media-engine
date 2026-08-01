import type { ExternalIds, MediaType } from '@media-engine/core';

// Keep API adapters and their OpenAPI descriptions on one media-identity vocabulary.
// Держит API-адаптеры и их OpenAPI-описания на одном словаре media identity.
export const MEDIA_TYPES = [
  'movie',
  'series',
  'anime',
] as const satisfies readonly MediaType[];

export const TOP_LEVEL_EXTERNAL_ID_KEYS = [
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
] as const satisfies readonly (keyof ExternalIds)[];

export const NESTED_ONLY_EXTERNAL_ID_KEYS = [
  'worldArt',
] as const satisfies readonly (keyof ExternalIds)[];

export const EXTERNAL_ID_KEYS = [
  ...TOP_LEVEL_EXTERNAL_ID_KEYS,
  ...NESTED_ONLY_EXTERNAL_ID_KEYS,
] as const satisfies readonly (keyof ExternalIds)[];

export const MEDIA_QUERY_BOUNDS = {
  mediaTypeLength: 16,
  titleLength: 300,
  alternativeTitles: 20,
  languageLength: 35,
  externalIdLength: 128,
  providerNameLength: 100,
  providers: 100,
  torrentLimit: 100,
} as const;

export function isMediaType(value: string): value is MediaType {
  return MEDIA_TYPES.some((mediaType) => mediaType === value);
}
