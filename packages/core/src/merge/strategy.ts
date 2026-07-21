import type { ExternalIds, MediaDetails, MediaItem, MediaType } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { MediaSearchResult, SearchQuery, SearchRankEvidence } from "../search/index.js";
import { diversifySearchCandidates } from "./diversity.js";
import { filterDetailsEntriesByIdentity, warnDetailsTypeConflicts } from "./details-identity.js";
import {
  firstDefined,
  firstMeaningfulDetailsStatus,
  mergeAlternativeTitles,
  mergeDetailsAlternativeTitles,
  mergeDetailsGenres,
  mergeDetailsImages,
  mergeDetailsRatings,
  mergeDetailsSources,
  mergeGenres,
  mergeRatings,
  mergeSources,
  selectBestDetailsImage,
  selectBestImage,
  selectDescription,
  selectDetailsDescription,
  selectDetailsReleaseDate,
  selectDetailsTitle,
  selectDetailsYear,
  selectReleaseDate,
  selectShortDescription,
  selectTitle,
  selectYear,
} from "./fields.js";
import { groupSearchResults } from "./grouping.js";
import type {
  DetailsEntry,
  ExternalIdKey,
  SearchEntry,
  SearchGroup,
  SelectedExternalId,
} from "./internal.js";
import { EXTERNAL_ID_KEYS } from "./internal.js";
import {
  selectMergedMediaType,
  selectMergedSearchType,
  selectMetadataPriorityType,
} from "./media-type.js";
import { providerRank, SEARCH_RESULT_PRIORITY, sortEntriesByPriority } from "./priority.js";
import { hasExactPrimaryTitle, rankSearchGroup, titleRelevanceScore } from "./scoring.js";
import type { MergeContext, MergeStrategy } from "./types.js";

// Built-in merge strategy used by core when no custom strategy is provided.
// Встроенная стратегия объединения, используемая core без пользовательской стратегии.
export class DefaultMergeStrategy implements MergeStrategy {
  // Merges provider search results into normalized scored search results.
  // Объединяет результаты поиска провайдеров в нормализованные результаты с оценкой.
  mergeSearchResults(
    results: ProviderSearchResult[],
    context: MergeContext = {},
  ): MediaSearchResult[] {
    const groups = groupSearchResults(results);

    const ranked = groups
      .filter((group) => isSearchGroupRelevant(group, context))
      .map((group, groupIndex) => {
        const merged = mergeSearchGroup(group, context);

        return {
          groupIndex,
          exactPrimaryTitleMatch: hasExactPrimaryQueryTitle(group.entries, context),
          ...merged,
        };
      })
      .sort((left, right) => {
        // The engine's preliminary broad merge feeds a bounded enrichment window. Keep exact
        // canonical candidates in that window even when their initial provider card is sparse.
        if (
          context.includeIrrelevantSearchResults &&
          left.exactPrimaryTitleMatch !== right.exactPrimaryTitleMatch
        ) {
          return left.exactPrimaryTitleMatch ? -1 : 1;
        }

        const scoreDiff = right.result.score - left.result.score;

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const providerDiff =
          searchResultProviderRank(left.result) - searchResultProviderRank(right.result);

        if (providerDiff !== 0) {
          return providerDiff;
        }

        const titleDiff = left.result.item.title.localeCompare(right.result.item.title);

        if (titleDiff !== 0) {
          return titleDiff;
        }

        return left.groupIndex - right.groupIndex;
      });
    const query = context.query as SearchQuery | undefined;
    const diversified = diversifySearchCandidates(
      ranked.map((candidate) => ({
        value: candidate.result,
        score: candidate.result.score,
        mediaType: candidate.result.item.type,
        title: candidate.result.item.title,
        ranking: candidate.ranking,
      })),
      Boolean(query?.title?.trim()) && !context.includeIrrelevantSearchResults,
    );

    return diversified.map((candidate) => ({
      ...candidate.value,
      ...(context.debug
        ? {
            ranking: {
              ...candidate.ranking,
              scorePosition: candidate.scorePosition,
              diversityPosition: candidate.diversityPosition,
              finalPosition: candidate.diversityPosition,
              diversity: {
                family: candidate.diversityFamily,
                adjusted: candidate.scorePosition !== candidate.diversityPosition,
              },
            },
          }
        : {}),
    }));
  }

  // Merges provider details results around a primary provider result.
  // Объединяет details-результаты провайдеров вокруг основного результата.
  mergeDetails(results: ProviderDetailsResult[], context: MergeContext = {}): MediaDetails | null {
    const priorityType = selectMetadataPriorityType(results.map((result) => result.details));
    const sortedEntries = filterDetailsEntriesByIdentity(
      sortEntriesByPriority(
        results.map((result, index) => ({ result, index })),
        context,
        priorityType,
      ),
      context,
    );
    const mediaType = selectMergedDetailsType(
      sortedEntries.map((entry) => entry.result.details),
      context,
    );
    const finalEntries = sortEntriesByPriority(
      sortedEntries,
      context,
      selectMetadataPriorityType(sortedEntries.map((entry) => entry.result.details)),
    );

    return mergeDetailsEntries(finalEntries, context, mediaType);
  }
}

const ANIME_ID_KEYS = ["shikimori", "myAnimeList", "aniList"] as const;

// Keeps explicit anime identity when only compatible generic catalogs survive an upstream outage.
// Сохраняет явную anime-идентичность, когда при upstream outage отвечают лишь общие каталоги.
function selectMergedDetailsType(items: MediaItem[], context: MergeContext): MediaType | undefined {
  const query = context.query;
  const hasAnimeId = ANIME_ID_KEYS.some((key) => Boolean(query?.ids?.[key] ?? query?.[key]));

  return query?.type === "anime" && hasAnimeId ? "anime" : selectMergedMediaType(items);
}

// Checks exact primary/original query intent for preliminary search enrichment ordering.
// Проверяет точное основное/original соответствие для предварительного enrichment-порядка.
function hasExactPrimaryQueryTitle(entries: SearchEntry[], context: MergeContext): boolean {
  const query = context.query as SearchQuery | undefined;
  const queryTitle = "title" in (query ?? {}) ? query?.title : undefined;

  return Boolean(queryTitle?.trim() && hasExactPrimaryTitle(entries, queryTitle));
}

// Drops provider noise that has no textual relationship to a title query.
// Убирает шум провайдеров, который никак текстово не связан с title-запросом.
function isSearchGroupRelevant(group: SearchGroup, context: MergeContext): boolean {
  if (context.includeIrrelevantSearchResults) {
    return true;
  }

  const query = context.query as SearchQuery | undefined;
  const queryTitle = "title" in (query ?? {}) ? query?.title : undefined;

  if (!queryTitle?.trim()) {
    return true;
  }

  return titleRelevanceScore(group.entries, queryTitle) > 0;
}

// Calculates rank for a merged search result using its primary source provider.
// Вычисляет rank для merged search result по его основному source provider.
function searchResultProviderRank(result: MediaSearchResult): number {
  return providerRank(result.sources[0]?.provider ?? "", SEARCH_RESULT_PRIORITY);
}

// Merges one internal search group into one public search result.
// Объединяет одну внутреннюю группу поиска в один публичный результат поиска.
function mergeSearchGroup(
  group: SearchGroup,
  context: MergeContext,
): {
  result: MediaSearchResult;
  ranking: Omit<
    SearchRankEvidence,
    "scorePosition" | "diversityPosition" | "finalPosition" | "diversity"
  >;
} {
  const mediaType = selectMergedSearchType(group.entries);
  const priorityType = selectMetadataPriorityType(group.entries.map((entry) => entry.result.item));
  const sortedEntries = sortEntriesByPriority(group.entries, context, priorityType);
  const primary = sortedEntries[0]?.result.item;

  if (!primary) {
    throw new Error("Cannot merge an empty search group.");
  }

  const ids = mergeExternalIds(sortedEntries, context);
  const title = selectTitle(sortedEntries, context) ?? primary.title;
  const item: MediaItem = {
    ...primary,
    id: primary.id,
    type: mediaType ?? primary.type,
    title,
    originalTitle: firstDefined(sortedEntries, (entry) => entry.result.item.originalTitle),
    alternativeTitles: mergeAlternativeTitles(sortedEntries, title),
    year: selectYear(sortedEntries, context),
    releaseDate: selectReleaseDate(sortedEntries),
    description: selectDescription(sortedEntries, context),
    shortDescription: selectShortDescription(sortedEntries),
    poster: selectBestImage(sortedEntries, "poster"),
    backdrop: selectBestImage(sortedEntries, "backdrop"),
    genres: mergeGenres(sortedEntries),
    ratings: mergeRatings(sortedEntries),
    ids,
  };

  const ranking = rankSearchGroup(group, sortedEntries, context);

  return {
    result: {
      item,
      score: ranking.score,
      sources: mergeSources(sortedEntries),
    },
    ranking: ranking.evidence,
  };
}

// Merges sorted details entries while keeping unsafe nested fields from primary.
// Объединяет отсортированные details entries, сохраняя небезопасные вложенные поля из primary.
function mergeDetailsEntries(
  entries: DetailsEntry[],
  context: MergeContext,
  mediaType?: MediaType,
): MediaDetails | null {
  const primary = entries[0]?.result.details;

  if (!primary) {
    return null;
  }

  warnDetailsTypeConflicts(entries, context, mediaType);

  const ids = mergeDetailsExternalIds(entries, context);
  const title = selectDetailsTitle(entries, context) ?? primary.title;
  const common = {
    ...primary,
    id: primary.id,
    type: primary.type,
    title,
    originalTitle: firstDefined(entries, (entry) => entry.result.details.originalTitle),
    alternativeTitles: mergeDetailsAlternativeTitles(entries, title),
    status: firstMeaningfulDetailsStatus(entries),
    year: selectDetailsYear(entries, context),
    releaseDate: selectDetailsReleaseDate(entries),
    description: selectDetailsDescription(entries, context),
    shortDescription: firstDefined(entries, (entry) => entry.result.details.shortDescription),
    poster: selectBestDetailsImage(entries, "poster"),
    backdrop: selectBestDetailsImage(entries, "backdrop"),
    genres: mergeDetailsGenres(entries),
    ratings: mergeDetailsRatings(entries),
    ids,
    images: mergeDetailsImages(entries),
    sourceProviders: mergeDetailsSources(entries),
  };

  switch (mediaType ?? primary.type) {
    case "movie":
      return common;
    case "series":
      return {
        ...common,
        type: "series",
        seasons: firstDefined(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.seasons : undefined,
        ),
        episodesCount: firstDefined(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.episodesCount : undefined,
        ),
        seasonsCount: firstDefined(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.seasonsCount : undefined,
        ),
      };
    case "anime":
      return {
        ...common,
        type: "anime",
        episodes: firstDefined(entries, (entry) =>
          entry.result.details.type === "anime" ? entry.result.details.episodes : undefined,
        ),
        episodesCount: firstDefined(entries, (entry) =>
          "episodesCount" in entry.result.details ? entry.result.details.episodesCount : undefined,
        ),
      };
  }
}

// Merges external IDs and records conflicts without overwriting priority values.
// Объединяет внешние ID и записывает конфликты без перезаписи приоритетных значений.
function mergeExternalIds(entries: SearchEntry[], context: MergeContext): ExternalIds | undefined {
  const selected = new Map<ExternalIdKey, SelectedExternalId>();

  for (const entry of entries) {
    const ids = entry.result.item.ids;

    if (!ids) {
      continue;
    }

    for (const key of EXTERNAL_ID_KEYS) {
      const value = ids[key];

      if (!value) {
        continue;
      }

      const existing = selected.get(key);

      if (!existing) {
        selected.set(key, { value, provider: entry.result.provider });
        continue;
      }

      if (existing.value !== value) {
        context.warnings?.push({
          code: "EXTERNAL_ID_CONFLICT",
          message: `Conflicting ${key} IDs while merging search results; kept ${existing.value}.`,
          provider: entry.result.provider,
        });
      }
    }
  }

  if (selected.size === 0) {
    return undefined;
  }

  const merged: ExternalIds = {};

  for (const [key, selectedId] of selected) {
    merged[key] = selectedId.value;
  }

  return merged;
}

// Merges details external IDs and records conflicts without overwriting priority values.
// Объединяет внешние ID деталей и записывает конфликты без перезаписи приоритетных значений.
function mergeDetailsExternalIds(
  entries: DetailsEntry[],
  context: MergeContext,
): ExternalIds | undefined {
  const selected = new Map<ExternalIdKey, SelectedExternalId>();

  for (const entry of entries) {
    const ids = entry.result.details.ids;

    if (!ids) {
      continue;
    }

    for (const key of EXTERNAL_ID_KEYS) {
      const value = ids[key];

      if (!value) {
        continue;
      }

      const existing = selected.get(key);

      if (!existing) {
        selected.set(key, { value, provider: entry.result.provider });
        continue;
      }

      if (existing.value !== value) {
        context.warnings?.push({
          code: "EXTERNAL_ID_CONFLICT",
          message: `Conflicting ${key} IDs while merging details; kept ${existing.value}.`,
          provider: entry.result.provider,
        });
      }
    }
  }

  if (selected.size === 0) {
    return undefined;
  }

  const merged: ExternalIds = {};

  for (const [key, selectedId] of selected) {
    merged[key] = selectedId.value;
  }

  return merged;
}
