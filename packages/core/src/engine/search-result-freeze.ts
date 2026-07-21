import type { ExternalIds, MediaItem, ProviderSource } from "../media/index.js";
import {
  mergeAlternativeTitles,
  mergeGenres,
  mergeRatings,
  selectBestImage,
  selectDescription,
  selectReleaseDate,
  selectShortDescription,
} from "../merge/fields.js";
import { hasSharedStrongId } from "../merge/identity.js";
import { EXTERNAL_ID_KEYS, type SearchEntry } from "../merge/internal.js";
import { titleRelevanceScore } from "../merge/scoring.js";
import type { ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning } from "../response/index.js";
import type { MediaSearchResult, SearchQuery } from "../search/index.js";
import type { ProviderSearchCallOutcome } from "./provider-calls.js";
import { hasSharedExternalId } from "./search-enrichment-shared.js";

export interface SearchIdEnrichment {
  ids: ExternalIds | undefined;
  outcome: ProviderSearchCallOutcome;
}

// Applies optional provider data to frozen discovery candidates without changing identity/order.
// Применяет optional provider data к frozen discovery candidates без изменения identity/order.
export function applySearchIdEnrichments(
  results: MediaSearchResult[],
  enrichments: SearchIdEnrichment[],
  warnings: EngineWarning[],
  language: string | undefined,
): MediaSearchResult[] {
  return results.map((result) => {
    const candidates = enrichments.flatMap((enrichment) => {
      if (enrichment.outcome.failure || !hasSharedExternalId(result.item.ids, enrichment.ids)) {
        return [];
      }

      return enrichment.outcome.results.filter(
        (candidate) =>
          hasSharedExternalId(candidate.item.ids, enrichment.ids) &&
          arePresentationTypesCompatible(result.item, candidate.item),
      );
    });

    if (candidates.length === 0) {
      return result;
    }

    const entries = createPresentationEntries(result, candidates);
    const imageEntries = [...entries.slice(1), entries[0]!];

    return {
      ...result,
      item: {
        ...result.item,
        alternativeTitles: mergeAlternativeTitles(entries, result.item.title),
        releaseDate: selectReleaseDate(entries),
        description: selectDescription(entries, { language }),
        shortDescription: selectShortDescription(entries),
        poster: selectBestImage(imageEntries, "poster"),
        backdrop: selectBestImage(imageEntries, "backdrop"),
        genres: mergeGenres(entries),
        ratings: mergeRatings(entries),
        ids: mergeFrozenExternalIds(result.item.ids, candidates, warnings),
      },
      sources: mergeFrozenSources(result.sources, candidates),
    };
  });
}

// Refreshes final debug positions after snapshot recovery without changing candidate order.
// Обновляет итоговые debug-позиции после snapshot recovery без изменения порядка кандидатов.
export function finalizeSearchRankingEvidence(results: MediaSearchResult[]): MediaSearchResult[] {
  return results.map((result, index) =>
    result.ranking
      ? {
          ...result,
          ranking: {
            ...result.ranking,
            finalPosition: index + 1,
          },
        }
      : result,
  );
}

// Keeps ranked relevant identities first while retaining unresolved discovery candidates for aliases.
// Сохраняет ranked relevant identities первыми и оставляет unresolved candidates для aliases.
export function createFrozenDiscoveryResults(
  rankedResults: MediaSearchResult[],
  preliminaryResults: MediaSearchResult[],
): MediaSearchResult[] {
  const frozen = [...rankedResults];

  for (const candidate of preliminaryResults) {
    if (!frozen.some((existing) => isSameDiscoveryCandidate(existing, candidate))) {
      frozen.push(candidate);
    }
  }

  return frozen;
}

// Selects bounded enrichment targets by preliminary discovery priority without changing response order.
// Выбирает bounded enrichment targets по preliminary priority без изменения порядка ответа.
export function createSearchEnrichmentCandidates(
  frozenResults: MediaSearchResult[],
  preliminaryResults: MediaSearchResult[],
): MediaSearchResult[] {
  const candidates: MediaSearchResult[] = [];

  for (const preliminary of preliminaryResults) {
    const frozen = frozenResults.find((result) => isSameDiscoveryCandidate(result, preliminary));

    if (frozen && !candidates.includes(frozen)) {
      candidates.push(frozen);
    }
  }

  for (const frozen of frozenResults) {
    if (!candidates.includes(frozen)) {
      candidates.push(frozen);
    }
  }

  return candidates;
}

// Removes candidates that remain unrelated after presentation enrichment without changing order.
// Удаляет нерелевантные после presentation enrichment candidates без изменения порядка.
export function filterFrozenSearchResults(
  results: MediaSearchResult[],
  query: SearchQuery,
): MediaSearchResult[] {
  const queryTitle = query.title?.trim();

  if (!queryTitle) {
    return results;
  }

  return results.filter((result) => {
    const entry: SearchEntry = {
      result: {
        provider: result.sources[0]?.provider ?? "search-discovery",
        item: result.item,
      },
      index: 0,
    };

    return titleRelevanceScore([entry], queryTitle) > 0;
  });
}

function createPresentationEntries(
  result: MediaSearchResult,
  candidates: ProviderSearchResult[],
): SearchEntry[] {
  const base: ProviderSearchResult = {
    provider: result.sources[0]?.provider ?? "search-discovery",
    item: result.item,
  };

  return [base, ...candidates].map((providerResult, index) => ({
    result: providerResult,
    index,
  }));
}

function arePresentationTypesCompatible(left: MediaItem, right: MediaItem): boolean {
  return (
    left.type === right.type ||
    (left.type === "anime" && right.type === "series") ||
    (left.type === "series" && right.type === "anime")
  );
}

function isSameDiscoveryCandidate(left: MediaSearchResult, right: MediaSearchResult): boolean {
  return (
    (left.item.type === right.item.type && left.item.id === right.item.id) ||
    (left.item.type === right.item.type && hasSharedStrongId(left.item.ids, right.item.ids))
  );
}

function mergeFrozenExternalIds(
  discoveryIds: ExternalIds | undefined,
  candidates: ProviderSearchResult[],
  warnings: EngineWarning[],
): ExternalIds | undefined {
  const merged: ExternalIds = { ...discoveryIds };

  for (const candidate of candidates) {
    for (const key of EXTERNAL_ID_KEYS) {
      const value = candidate.item.ids?.[key];

      if (!value) {
        continue;
      }

      const existing = merged[key];

      if (!existing) {
        merged[key] = value;
      } else if (existing !== value) {
        warnings.push({
          code: "EXTERNAL_ID_CONFLICT",
          message: `Conflicting ${key} IDs during search enrichment; kept ${existing}.`,
          provider: candidate.provider,
        });
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeFrozenSources(
  discoverySources: ProviderSource[],
  candidates: ProviderSearchResult[],
): ProviderSource[] {
  const sources = discoverySources.map((source) => structuredClone(source));

  for (const candidate of candidates) {
    const source: ProviderSource = {
      provider: candidate.source?.provider ?? candidate.provider,
      ids: candidate.source?.ids ?? candidate.item.ids,
      url: candidate.source?.url,
    };

    if (!sources.some((existing) => existing.provider === source.provider)) {
      sources.push(source);
    }
  }

  return sources;
}
