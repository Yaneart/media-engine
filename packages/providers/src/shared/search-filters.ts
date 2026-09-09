import type { MediaItem, ProviderSearchQuery } from "@media-engine/core";

// Applies normalized provider-independent search filters to mapped items.
// Применяет нормализованные общие поисковые фильтры к данным провайдера.
export function matchesSearchFilters(item: MediaItem, query: ProviderSearchQuery): boolean {
  if (query.year !== undefined && item.year !== query.year) {
    return false;
  }

  if (
    query.genre &&
    !item.genres?.some(
      (genre) => normalizeFilterValue(genre.name) === normalizeFilterValue(query.genre!),
    )
  ) {
    return false;
  }

  return (
    query.minimumRating === undefined ||
    Boolean(
      item.ratings?.some(
        (rating) => rating.max > 0 && (rating.value / rating.max) * 10 >= query.minimumRating!,
      ),
    )
  );
}

export function normalizeFilterValue(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]+/gu, " ");
}
