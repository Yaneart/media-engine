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

  return isExactPrimaryMatch(relevantResults[0]!) && exactMatches.length > 1;
}

function hasExternalIds(query: SearchQuery): boolean {
  return Object.values(query.ids ?? {}).some(Boolean);
}
