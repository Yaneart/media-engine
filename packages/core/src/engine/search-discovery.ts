import type { MediaSearchResult, SearchQuery } from "../search/index.js";
import { normalizeTitle } from "../merge/title.js";

// Decides whether slower fallback discovery can still resolve title identity.
// Решает, может ли более медленный fallback discovery уточнить identity по названию.
export function needsFallbackTitleDiscovery(
  query: SearchQuery,
  relevantResults: MediaSearchResult[],
): boolean {
  if (!query.title?.trim() || hasExternalIds(query)) {
    return false;
  }

  if (relevantResults.length === 0) {
    return true;
  }

  const normalizedQuery = normalizeTitle(query.title);
  const isExactPrimaryMatch = (result: MediaSearchResult): boolean =>
    [result.item.title, result.item.originalTitle]
      .filter((title): title is string => Boolean(title))
      .some((title) => normalizeTitle(title) === normalizedQuery);
  const exactMatches = relevantResults.filter((result) => isExactPrimaryMatch(result));

  if (exactMatches.length === 0) {
    return normalizedQuery.split(" ").filter(Boolean).length >= 2;
  }

  return isExactPrimaryMatch(relevantResults[0]!) && exactMatches.length > 1;
}

// Broadens likely multi-word typos even when weak fuzzy candidates prevented an empty result.
// Расширяет вероятную multi-word опечатку, даже если weak fuzzy candidates дали непустой ответ.
export function needsPrimaryTitleBroadening(
  query: SearchQuery,
  relevantResults: MediaSearchResult[],
): boolean {
  if (!query.title?.trim() || hasExternalIds(query)) {
    return false;
  }

  const normalizedQuery = normalizeTitle(query.title);

  return !relevantResults.some((result) =>
    [result.item.title, result.item.originalTitle]
      .filter((title): title is string => Boolean(title))
      .some((title) => normalizeTitle(title) === normalizedQuery),
  );
}

function hasExternalIds(query: SearchQuery): boolean {
  return Object.values(query.ids ?? {}).some(Boolean);
}
