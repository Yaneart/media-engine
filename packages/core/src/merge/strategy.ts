import type {
  ExternalIds,
  Genre,
  Image,
  MediaDetails,
  MediaItem,
  MediaType,
  ProviderSource,
  Rating,
} from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { MediaSearchResult, SearchQuery } from "../search/index.js";
import type { MatchStrength, MergeContext, MergeStrategy } from "./types.js";

// External ID object key used when merging provider IDs.
// Ключ объекта внешних ID, используемый при объединении ID провайдеров.
type ExternalIdKey = keyof ExternalIds;

// Provider search result paired with its original input position.
// Результат поиска провайдера вместе с исходной позицией во входном массиве.
interface SearchEntry {
  result: ProviderSearchResult;
  index: number;
}

// Provider details result paired with its original input position.
// Результат деталей провайдера вместе с исходной позицией во входном массиве.
interface DetailsEntry {
  result: ProviderDetailsResult;
  index: number;
}

// Internal group of search results that represent the same media item.
// Внутренняя группа результатов поиска, которые описывают одно медиа.
interface SearchGroup {
  entries: SearchEntry[];
  matchStrength: MatchStrength;
}

// Selected external ID value together with the provider that supplied it.
// Выбранное значение внешнего ID вместе с провайдером, который его дал.
interface SelectedExternalId {
  value: string;
  provider: string;
}

// Strong IDs that can safely prove two results describe the same media.
// Сильные ID, которые безопасно доказывают, что два результата описывают одно медиа.
const STRONG_ID_KEYS = ["imdb", "tmdb", "kinopoisk", "shikimori", "myAnimeList"] as const;
// All external ID fields copied into a merged media item.
// Все поля внешних ID, которые копируются в объединенный media item.
const EXTERNAL_ID_KEYS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
] as const;

// Default provider priority for movies and series.
// Приоритет провайдеров по умолчанию для фильмов и сериалов.
const DEFAULT_PRIORITY = ["tmdb", "kinobd", "cinemeta", "imdb", "wikidata", "kinopoisk"];
// Default provider priority for anime results.
// Приоритет провайдеров по умолчанию для аниме.
const ANIME_PRIORITY = [
  "shikimori",
  "anilist",
  "tmdb",
  "kinobd",
  "cinemeta",
  "imdb",
  "wikidata",
  "kinopoisk",
];
// Search-level tie-break priority used when results from different media types have equal scores.
// Search-level priority для tie-break, когда результаты разных media types имеют одинаковый score.
const SEARCH_RESULT_PRIORITY = [
  "tmdb",
  "kinobd",
  "cinemeta",
  "imdb",
  "wikidata",
  "kinopoisk",
  "shikimori",
  "anilist",
];

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

    return groups
      .filter((group) => isSearchGroupRelevant(group, context))
      .map((group, groupIndex) => ({
        groupIndex,
        result: mergeSearchGroup(group, context),
      }))
      .sort((left, right) => {
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
      })
      .map(({ result }) => result);
  }

  // Merges provider details results around a primary provider result.
  // Объединяет details-результаты провайдеров вокруг основного результата.
  mergeDetails(results: ProviderDetailsResult[], context: MergeContext = {}): MediaDetails | null {
    const mediaType = selectMergedMediaType(results.map((result) => result.details));
    const priorityType = selectMetadataPriorityType(results.map((result) => result.details));
    const sortedEntries = sortEntriesByPriority(
      results.map((result, index) => ({ result, index })),
      context,
      priorityType,
    );

    return mergeDetailsEntries(sortedEntries, context, mediaType);
  }
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

// Groups search results by exact IDs first, then by normalized title/year/type.
// Группирует результаты сначала по точным ID, затем по нормализованным title/year/type.
function groupSearchResults(results: ProviderSearchResult[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const groupsByStrongId = new Map<string, number[]>();
  const groupsByTitleYearType = new Map<string, number[]>();

  results.forEach((result, index) => {
    const entry = { result, index };
    const exactIdGroupIndex = findIndexedGroup(
      strongIdIndexKeys(result.item),
      groupsByStrongId,
      groups,
      (group) => canJoinByExactId(entry, group),
    );

    if (exactIdGroupIndex !== undefined) {
      const exactIdGroup = groups[exactIdGroupIndex]!;
      exactIdGroup.entries.push(entry);
      exactIdGroup.matchStrength = "exact_id";
      indexSearchEntry(entry, exactIdGroupIndex, groupsByStrongId, groupsByTitleYearType);
      return;
    }

    const titleGroupIndex = findIndexedGroup(
      titleYearTypeIndexKeys(result.item),
      groupsByTitleYearType,
      groups,
      (group) => canJoinByTitleYearType(entry, group),
    );

    if (titleGroupIndex !== undefined) {
      const titleGroup = groups[titleGroupIndex]!;
      const isExactTitleMatch = hasExactTitleYearTypeMatch(entry, titleGroup);

      titleGroup.entries.push(entry);
      titleGroup.matchStrength =
        titleGroup.matchStrength === "exact_title_year_type" || isExactTitleMatch
          ? "exact_title_year_type"
          : "normalized_title_year_type";
      indexSearchEntry(entry, titleGroupIndex, groupsByStrongId, groupsByTitleYearType);
      return;
    }

    const groupIndex = groups.length;
    groups.push({ entries: [entry], matchStrength: "none" });
    indexSearchEntry(entry, groupIndex, groupsByStrongId, groupsByTitleYearType);
  });

  return groups;
}

function findIndexedGroup(
  keys: string[],
  index: Map<string, number[]>,
  groups: SearchGroup[],
  matches: (group: SearchGroup) => boolean,
): number | undefined {
  const candidates = new Set<number>();

  for (const key of keys) {
    for (const groupIndex of index.get(key) ?? []) {
      candidates.add(groupIndex);
    }
  }

  return [...candidates]
    .sort((left, right) => left - right)
    .find((groupIndex) => {
      const group = groups[groupIndex];
      return group ? matches(group) : false;
    });
}

function indexSearchEntry(
  entry: SearchEntry,
  groupIndex: number,
  groupsByStrongId: Map<string, number[]>,
  groupsByTitleYearType: Map<string, number[]>,
): void {
  addGroupIndex(groupsByStrongId, strongIdIndexKeys(entry.result.item), groupIndex);
  addGroupIndex(groupsByTitleYearType, titleYearTypeIndexKeys(entry.result.item), groupIndex);
}

function addGroupIndex(index: Map<string, number[]>, keys: string[], groupIndex: number): void {
  for (const key of keys) {
    const groupIndexes = index.get(key);

    if (!groupIndexes) {
      index.set(key, [groupIndex]);
    } else if (groupIndexes.at(-1) !== groupIndex && !groupIndexes.includes(groupIndex)) {
      groupIndexes.push(groupIndex);
    }
  }
}

function strongIdIndexKeys(item: MediaItem): string[] {
  return STRONG_ID_KEYS.flatMap((key) => {
    const value = item.ids?.[key];
    return value ? [`${item.type}:${key}:${value}`] : [];
  });
}

function titleYearTypeIndexKeys(item: MediaItem): string[] {
  if (item.year === undefined) {
    return [];
  }

  const typeKey = item.type === "anime" || item.type === "series" ? "series-or-anime" : item.type;

  return [...normalizedTitleCandidateSet(item)].map((title) => `${typeKey}:${item.year}:${title}`);
}

// Checks whether an entry can join a group through a shared strong external ID.
// Проверяет, может ли entry войти в группу по общему сильному внешнему ID.
function canJoinByExactId(entry: SearchEntry, group: SearchGroup): boolean {
  return group.entries.some((groupEntry) => {
    return (
      groupEntry.result.item.type === entry.result.item.type &&
      hasSharedStrongId(groupEntry.result.item.ids, entry.result.item.ids)
    );
  });
}

// Checks whether an entry can join a group by normalized title, year, and type.
// Проверяет, может ли entry войти в группу по нормализованным title, year и type.
function canJoinByTitleYearType(entry: SearchEntry, group: SearchGroup): boolean {
  const item = entry.result.item;

  return group.entries.some((groupEntry) => {
    const groupItem = groupEntry.result.item;

    return (
      areSearchTypesCompatible(item.type, groupItem.type) &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      hasSharedNormalizedTitleCandidate(item, groupItem) &&
      !hasStrongIdConflict(item.ids, groupItem.ids)
    );
  });
}

// Checks whether a title/year/type match is exact before normalization.
// Проверяет, является ли совпадение title/year/type точным до нормализации.
function hasExactTitleYearTypeMatch(entry: SearchEntry, group: SearchGroup): boolean {
  const item = entry.result.item;

  return group.entries.some((groupEntry) => {
    const groupItem = groupEntry.result.item;

    return (
      areSearchTypesCompatible(item.type, groupItem.type) &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      hasSharedExactTitleCandidate(item, groupItem)
    );
  });
}

// Treats anime and series as compatible only for strong title/year grouping.
// Считает anime и series совместимыми только для сильной группировки по title/year.
function areSearchTypesCompatible(left: MediaType, right: MediaType): boolean {
  return (
    left === right ||
    (left === "anime" && right === "series") ||
    (left === "series" && right === "anime")
  );
}

// Checks title/original/alternative candidates after normalization.
// Проверяет title/original/alternative кандидаты после нормализации.
function hasSharedNormalizedTitleCandidate(left: MediaItem, right: MediaItem): boolean {
  const leftTitles = normalizedTitleCandidateSet(left);

  if (leftTitles.size === 0) {
    return false;
  }

  return titleCandidates(right).some((title) => leftTitles.has(normalizeTitle(title)));
}

// Checks title/original/alternative candidates without accent/case normalization.
// Проверяет title/original/alternative кандидаты без accent/case нормализации.
function hasSharedExactTitleCandidate(left: MediaItem, right: MediaItem): boolean {
  const leftTitles = new Set(titleCandidates(left).map(exactTitleKey).filter(Boolean));

  if (leftTitles.size === 0) {
    return false;
  }

  return titleCandidates(right).some((title) => leftTitles.has(exactTitleKey(title)));
}

// Builds normalized non-empty title candidate set for grouping.
// Собирает набор нормализованных непустых title candidates для группировки.
function normalizedTitleCandidateSet(item: MediaItem): Set<string> {
  return new Set(titleCandidates(item).map(normalizeTitle).filter(Boolean));
}

// Merges one internal search group into one public search result.
// Объединяет одну внутреннюю группу поиска в один публичный результат поиска.
function mergeSearchGroup(group: SearchGroup, context: MergeContext): MediaSearchResult {
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

  return {
    item,
    score: scoreGroup(group, sortedEntries, context),
    sources: mergeSources(sortedEntries),
  };
}

// Preserves anime semantics when a generic series catalog describes the same animated title.
// Сохраняет anime-семантику, когда generic series-каталог описывает тот же анимационный тайтл.
function selectMergedSearchType(entries: SearchEntry[]): MediaType | undefined {
  return selectMergedMediaType(entries.map((entry) => entry.result.item));
}

// Uses general-series metadata priority for mixed anime/catalog groups without losing anime type.
// Использует приоритет metadata сериалов для смешанных anime/catalog групп без потери anime-типа.
function selectMetadataPriorityType(items: MediaItem[]): MediaType | undefined {
  const types = new Set(items.map((item) => item.type));
  return types.has("anime") && types.has("series") ? "series" : items[0]?.type;
}

function selectMergedMediaType(items: MediaItem[]): MediaType | undefined {
  return items.some((item) => item.type === "anime") ? "anime" : items[0]?.type;
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
    originalTitle: firstDefinedDetails(entries, (entry) => entry.result.details.originalTitle),
    alternativeTitles: mergeDetailsAlternativeTitles(entries, title),
    status: firstMeaningfulDetailsStatus(entries),
    year: selectDetailsYear(entries, context),
    releaseDate: selectDetailsReleaseDate(entries),
    description: selectDetailsDescription(entries, context),
    shortDescription: firstDefinedDetails(
      entries,
      (entry) => entry.result.details.shortDescription,
    ),
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
        seasons: firstDefinedDetails(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.seasons : undefined,
        ),
        episodesCount: firstDefinedDetails(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.episodesCount : undefined,
        ),
        seasonsCount: firstDefinedDetails(entries, (entry) =>
          entry.result.details.type === "series" ? entry.result.details.seasonsCount : undefined,
        ),
      };
    case "anime":
      return {
        ...common,
        type: "anime",
        episodes: firstDefinedDetails(entries, (entry) =>
          entry.result.details.type === "anime" ? entry.result.details.episodes : undefined,
        ),
        episodesCount: firstDefinedDetails(entries, (entry) =>
          "episodesCount" in entry.result.details ? entry.result.details.episodesCount : undefined,
        ),
      };
  }
}

// Sorts entries by explicit provider priority and then original input order.
// Сортирует entries по заданному приоритету провайдеров и исходному порядку.
function sortEntriesByPriority<T extends { result: { provider: string } }>(
  entries: T[],
  context: MergeContext,
  mediaType?: MediaType,
): T[] {
  const priority = context.providerPriority ?? defaultPriority(mediaType);

  return [...entries].sort((left, right) => {
    const priorityDiff =
      providerRank(left.result.provider, priority) - providerRank(right.result.provider, priority);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return getEntryIndex(left) - getEntryIndex(right);
  });
}

// Returns the default provider priority for a media type.
// Возвращает приоритет провайдеров по умолчанию для типа медиа.
function defaultPriority(mediaType?: MediaType): string[] {
  return mediaType === "anime" ? ANIME_PRIORITY : DEFAULT_PRIORITY;
}

// Calculates provider priority rank for deterministic sorting.
// Вычисляет ранг провайдера для детерминированной сортировки.
function providerRank(provider: string, priority: string[]): number {
  const index = priority.indexOf(provider);

  return index === -1 ? priority.length : index;
}

// Reads an entry index from generic sorted objects.
// Читает index из обобщенных объектов для сортировки.
function getEntryIndex(entry: unknown): number {
  return typeof entry === "object" &&
    entry !== null &&
    "index" in entry &&
    typeof entry.index === "number"
    ? entry.index
    : 0;
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

// Selects a display title, preferring the queried title when it matches.
// Выбирает отображаемый title, предпочитая title из запроса при совпадении.
function selectTitle(entries: SearchEntry[], context: MergeContext): string | undefined {
  const localizedTitle = selectLocalizedText(
    entries.flatMap((entry) => [
      entry.result.item.title,
      ...(entry.result.item.alternativeTitles ?? []),
    ]),
    context.language,
  );

  if (localizedTitle) {
    return localizedTitle;
  }

  const queryTitle =
    "title" in (context.query ?? {}) ? (context.query as SearchQuery).title : undefined;

  if (queryTitle) {
    const normalizedQueryTitle = normalizeTitle(queryTitle);
    const queryMatch = entries.find(
      (entry) => normalizeTitle(entry.result.item.title) === normalizedQueryTitle,
    );

    if (queryMatch) {
      return queryMatch.result.item.title;
    }
  }

  return firstDefined(entries, (entry) => entry.result.item.title);
}

// Selects a details display title, preferring the queried title when it matches.
// Выбирает отображаемый title деталей, предпочитая title из запроса при совпадении.
function selectDetailsTitle(entries: DetailsEntry[], context: MergeContext): string | undefined {
  const localizedTitle = selectLocalizedText(
    entries.flatMap((entry) => [
      entry.result.details.title,
      ...(entry.result.details.alternativeTitles ?? []),
    ]),
    context.language,
  );

  if (localizedTitle) {
    return localizedTitle;
  }

  const queryTitle =
    "title" in (context.query ?? {}) ? (context.query as SearchQuery).title : undefined;

  if (queryTitle) {
    const normalizedQueryTitle = normalizeTitle(queryTitle);
    const queryMatch = entries.find(
      (entry) => normalizeTitle(entry.result.details.title) === normalizedQueryTitle,
    );

    if (queryMatch) {
      return queryMatch.result.details.title;
    }
  }

  return firstDefinedDetails(entries, (entry) => entry.result.details.title);
}

// Selects text matching an explicitly requested language while preserving fallback behavior.
// Выбирает текст на явно запрошенном языке, сохраняя fallback-поведение.
function selectLocalizedText(
  values: Array<string | undefined>,
  language: string | undefined,
): string | undefined {
  return filterLocalizedText(
    values.filter((value): value is string => Boolean(value?.trim())),
    language,
  )[0];
}

function filterLocalizedText(values: string[], language: string | undefined): string[] {
  const baseLanguage = language?.split("-")[0]?.toLowerCase();

  if (!baseLanguage) {
    return [];
  }

  switch (baseLanguage) {
    case "ru":
    case "uk":
    case "be":
      return values.filter((value) => /[а-яёіїєґ]/iu.test(value));
    case "ja":
      return values.filter((value) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(value));
    case "en":
      return values.filter(
        (value) => /[a-z]/iu.test(value) && !/[а-яёіїєґ\u3040-\u30ff\u3400-\u9fff]/iu.test(value),
      );
    default:
      return [];
  }
}

// Selects the primary year and emits warnings for conflicting years.
// Выбирает основной год и добавляет warnings при конфликтующих годах.
function selectYear(entries: SearchEntry[], context: MergeContext): number | undefined {
  const primaryYear = firstDefined(entries, (entry) => entry.result.item.year);

  for (const entry of entries) {
    const year = entry.result.item.year;

    if (year !== undefined && primaryYear !== undefined && year !== primaryYear) {
      context.warnings?.push({
        code: "YEAR_CONFLICT",
        message: `Conflicting years while merging search results; kept ${primaryYear}.`,
        provider: entry.result.provider,
      });
    }
  }

  return primaryYear;
}

// Selects the primary details year and emits warnings for conflicting years.
// Выбирает основной год деталей и добавляет warnings при конфликтующих годах.
function selectDetailsYear(entries: DetailsEntry[], context: MergeContext): number | undefined {
  const primaryYear = firstDefinedDetails(entries, (entry) => entry.result.details.year);

  for (const entry of entries) {
    const year = entry.result.details.year;

    if (year !== undefined && primaryYear !== undefined && year !== primaryYear) {
      context.warnings?.push({
        code: "YEAR_CONFLICT",
        message: `Conflicting years while merging details; kept ${primaryYear}.`,
        provider: entry.result.provider,
      });
    }
  }

  return primaryYear;
}

// Selects the most precise release date by string length.
// Выбирает наиболее точную дату релиза по длине строки.
function selectReleaseDate(entries: SearchEntry[]): string | undefined {
  return maxBy(
    entries
      .map((entry) => entry.result.item.releaseDate)
      .filter((releaseDate): releaseDate is string => Boolean(releaseDate)),
    (releaseDate) => releaseDate.length,
  );
}

// Selects the most precise details release date by string length.
// Выбирает наиболее точную дату релиза деталей по длине строки.
function selectDetailsReleaseDate(entries: DetailsEntry[]): string | undefined {
  return maxBy(
    entries
      .map((entry) => entry.result.details.releaseDate)
      .filter((releaseDate): releaseDate is string => Boolean(releaseDate)),
    (releaseDate) => releaseDate.length,
  );
}

// Selects the longest useful description.
// Выбирает самое длинное полезное описание.
function selectDescription(entries: SearchEntry[], context?: MergeContext): string | undefined {
  const descriptions = entries
    .map((entry) => entry.result.item.description)
    .filter((description): description is string => Boolean(description?.trim()));
  const localized = filterLocalizedText(descriptions, context?.language);
  return maxBy(
    localized.length ? localized : descriptions,
    (description) => description.trim().length,
  );
}

// Selects the longest useful details description.
// Выбирает самое длинное полезное описание деталей.
function selectDetailsDescription(
  entries: DetailsEntry[],
  context?: MergeContext,
): string | undefined {
  const descriptions = entries
    .map((entry) => entry.result.details.description)
    .filter((description): description is string => Boolean(description?.trim()));
  const localized = filterLocalizedText(descriptions, context?.language);
  return maxBy(
    localized.length ? localized : descriptions,
    (description) => description.trim().length,
  );
}

// Selects the first available short description by provider priority.
// Выбирает первое доступное короткое описание по приоритету провайдера.
function selectShortDescription(entries: SearchEntry[]): string | undefined {
  return firstDefined(entries, (entry) => entry.result.item.shortDescription);
}

// Selects the best valid poster or backdrop image.
// Выбирает лучшее валидное изображение poster или backdrop.
function selectBestImage(entries: SearchEntry[], field: "poster" | "backdrop"): Image | undefined {
  const images = entries
    .map((entry, index) => ({ image: entry.result.item[field], index }))
    .filter((candidate): candidate is { image: Image; index: number } =>
      isValidImageUrl(candidate.image),
    );

  return [...images].sort((left, right) => {
    const areaDiff = imageArea(right.image) - imageArea(left.image);

    if (areaDiff !== 0) {
      return areaDiff;
    }

    return left.index - right.index;
  })[0]?.image;
}

// Selects the best valid details poster or backdrop image.
// Выбирает лучшее валидное изображение poster или backdrop из деталей.
function selectBestDetailsImage(
  entries: DetailsEntry[],
  field: "poster" | "backdrop",
): Image | undefined {
  const images = entries
    .map((entry, index) => ({ image: entry.result.details[field], index }))
    .filter((candidate): candidate is { image: Image; index: number } =>
      isValidImageUrl(candidate.image),
    );

  return [...images].sort((left, right) => {
    const areaDiff = imageArea(right.image) - imageArea(left.image);

    if (areaDiff !== 0) {
      return areaDiff;
    }

    return left.index - right.index;
  })[0]?.image;
}

// Merges unique genres by normalized genre name.
// Объединяет уникальные жанры по нормализованному названию.
function mergeGenres(entries: SearchEntry[]): Genre[] | undefined {
  const genres = new Map<string, Genre>();

  for (const entry of entries) {
    for (const genre of entry.result.item.genres ?? []) {
      const key = normalizeTitle(genre.name);

      if (key && !genres.has(key)) {
        genres.set(key, { ...genre });
      }
    }
  }

  return genres.size > 0 ? [...genres.values()] : undefined;
}

// Merges unique details genres by normalized genre name.
// Объединяет уникальные жанры деталей по нормализованному названию.
function mergeDetailsGenres(entries: DetailsEntry[]): Genre[] | undefined {
  const genres = new Map<string, Genre>();

  for (const entry of entries) {
    for (const genre of entry.result.details.genres ?? []) {
      const key = normalizeTitle(genre.name);

      if (key && !genres.has(key)) {
        genres.set(key, { ...genre });
      }
    }
  }

  return genres.size > 0 ? [...genres.values()] : undefined;
}

// Merges ratings while keeping one rating per source.
// Объединяет рейтинги, сохраняя один рейтинг на источник.
function mergeRatings(entries: SearchEntry[]): Rating[] | undefined {
  const ratings = new Map<string, Rating>();

  for (const entry of entries) {
    for (const rating of entry.result.item.ratings ?? []) {
      if (!ratings.has(rating.source)) {
        ratings.set(rating.source, { ...rating });
      }
    }
  }

  return ratings.size > 0 ? [...ratings.values()] : undefined;
}

// Merges details ratings while keeping one rating per source.
// Объединяет рейтинги деталей, сохраняя один рейтинг на источник.
function mergeDetailsRatings(entries: DetailsEntry[]): Rating[] | undefined {
  const ratings = new Map<string, Rating>();

  for (const entry of entries) {
    for (const rating of entry.result.details.ratings ?? []) {
      if (!ratings.has(rating.source)) {
        ratings.set(rating.source, { ...rating });
      }
    }
  }

  return ratings.size > 0 ? [...ratings.values()] : undefined;
}

// Merges alternative titles excluding the selected display title.
// Объединяет альтернативные названия, исключая выбранный отображаемый title.
function mergeAlternativeTitles(
  entries: SearchEntry[],
  selectedTitle: string,
): string[] | undefined {
  const selectedKey = normalizeTitle(selectedTitle);
  const titles = new Map<string, string>();

  for (const entry of entries) {
    addAlternativeTitle(titles, entry.result.item.title, selectedKey);
    addAlternativeTitle(titles, entry.result.item.originalTitle, selectedKey);

    for (const title of entry.result.item.alternativeTitles ?? []) {
      addAlternativeTitle(titles, title, selectedKey);
    }
  }

  return titles.size > 0 ? [...titles.values()] : undefined;
}

// Merges details alternative titles excluding the selected display title.
// Объединяет альтернативные названия деталей, исключая выбранный отображаемый title.
function mergeDetailsAlternativeTitles(
  entries: DetailsEntry[],
  selectedTitle: string,
): string[] | undefined {
  const selectedKey = normalizeTitle(selectedTitle);
  const titles = new Map<string, string>();

  for (const entry of entries) {
    addAlternativeTitle(titles, entry.result.details.title, selectedKey);
    addAlternativeTitle(titles, entry.result.details.originalTitle, selectedKey);

    for (const title of entry.result.details.alternativeTitles ?? []) {
      addAlternativeTitle(titles, title, selectedKey);
    }
  }

  return titles.size > 0 ? [...titles.values()] : undefined;
}

// Adds one normalized alternative title if it is useful and unique.
// Добавляет одно нормализованное альтернативное название, если оно полезно и уникально.
function addAlternativeTitle(
  titles: Map<string, string>,
  title: string | undefined,
  selectedKey: string,
): void {
  if (!title?.trim()) {
    return;
  }

  const key = normalizeTitle(title);

  if (key && key !== selectedKey && !titles.has(key)) {
    titles.set(key, title);
  }
}

// Builds public source attribution for a merged search result.
// Создает публичную атрибуцию источников для объединенного результата поиска.
function mergeSources(entries: SearchEntry[]): ProviderSource[] {
  return entries.map((entry) => ({
    provider: entry.result.source?.provider ?? entry.result.provider,
    ids: entry.result.source?.ids ?? entry.result.item.ids,
    url: entry.result.source?.url,
  }));
}

// Builds public source attribution for merged details.
// Создает публичную атрибуцию источников для объединенных деталей.
function mergeDetailsSources(entries: DetailsEntry[]): ProviderSource[] {
  return entries.map((entry) => ({
    provider: entry.result.source?.provider ?? entry.result.provider,
    ids: entry.result.source?.ids ?? entry.result.details.ids,
    url: entry.result.source?.url,
  }));
}

// Merges unique details images by URL.
// Объединяет уникальные изображения деталей по URL.
function mergeDetailsImages(entries: DetailsEntry[]): Image[] | undefined {
  const images = new Map<string, Image>();

  for (const entry of entries) {
    const candidates = [
      entry.result.details.poster,
      entry.result.details.backdrop,
      ...(entry.result.details.images ?? []),
    ];

    for (const image of candidates) {
      if (isValidImageUrl(image) && !images.has(image.url)) {
        images.set(image.url, { ...image });
      }
    }
  }

  return images.size > 0 ? [...images.values()] : undefined;
}

// Emits warnings when details results contain conflicting media types.
// Добавляет warnings, когда details-результаты содержат конфликтующие типы медиа.
function warnDetailsTypeConflicts(
  entries: DetailsEntry[],
  context: MergeContext,
  selectedType?: MediaType,
): void {
  const primaryType = selectedType ?? entries[0]?.result.details.type;

  if (!primaryType) {
    return;
  }

  for (const entry of entries) {
    const entryType = entry.result.details.type;
    const isCompatibleAnimeCatalogType = primaryType === "anime" && entryType === "series";

    if (entryType !== primaryType && !isCompatibleAnimeCatalogType) {
      context.warnings?.push({
        code: "MEDIA_TYPE_CONFLICT",
        message: `Conflicting media types while merging details; kept ${primaryType}.`,
        provider: entry.result.provider,
      });
    }
  }
}

// Calculates a public score from match strength, query relevance, and popularity signals.
// Вычисляет публичную оценку по силе совпадения, релевантности запросу и популярности.
function scoreGroup(group: SearchGroup, entries: SearchEntry[], context: MergeContext): number {
  const query = context.query as SearchQuery | undefined;
  const queryIds = "ids" in (query ?? {}) ? query?.ids : undefined;
  const queryTitle = "title" in (query ?? {}) ? query?.title : undefined;

  if (queryIds && entries.some((entry) => hasSharedStrongId(queryIds, entry.result.item.ids))) {
    return 1;
  }

  if (!queryTitle?.trim()) {
    return baseGroupScore(group, entries);
  }

  const baseScore = baseTextSearchScore(group, entries);
  const titleScore = titleRelevanceScore(entries, queryTitle);
  const exactPrimaryTitleScore = hasExactPrimaryTitle(entries, queryTitle) ? 1 : 0;
  const popularityScore = ratingVotesScore(entries);
  const ratingScore = normalizedRatingScore(entries);
  const idScore = externalIdCompletenessScore(entries);
  const sourceScore = sourceCoverageScore(entries);
  const authorityScore = sourceAuthorityScore(entries);

  return boundedTextScore(
    baseScore +
      titleScore * 0.2 +
      exactPrimaryTitleScore * 0.15 +
      popularityScore * 0.15 +
      ratingScore * 0.05 +
      idScore * 0.01 +
      sourceScore * 0.02 +
      authorityScore * 0.15,
  );
}

// Distinguishes exact primary/original titles from incidental alternative aliases.
// Отличает точные основные/оригинальные названия от случайных alternative aliases.
function hasExactPrimaryTitle(entries: SearchEntry[], queryTitle: string): boolean {
  const normalizedQuery = normalizeTitle(queryTitle);

  return entries.some((entry) =>
    [entry.result.item.title, entry.result.item.originalTitle]
      .filter((title): title is string => Boolean(title))
      .some((title) => normalizeTitle(title) === normalizedQuery),
  );
}

// Keeps legacy scores for non-title searches where no relevance ranking is possible.
// Сохраняет прежние оценки для поиска без title, где нельзя посчитать релевантность.
function baseGroupScore(group: SearchGroup, entries: SearchEntry[]): number {
  switch (group.matchStrength) {
    case "exact_id":
      return 1;
    case "exact_title_year_type":
      return 0.9;
    case "normalized_title_year_type":
      return 0.8;
    case "weak":
      return 0.4;
    case "none":
      return clampScore(entries[0]?.result.confidence ?? 0.5);
  }
}

// Starts text-search scoring below 1 so popularity and relevance can break exact-ID ties.
// Начинает оценку текстового поиска ниже 1, чтобы популярность и релевантность разбивали tie по ID.
function baseTextSearchScore(group: SearchGroup, entries: SearchEntry[]): number {
  switch (group.matchStrength) {
    case "exact_id":
      return 0.44 + bestProviderConfidence(entries) * 0.18;
    case "exact_title_year_type":
      return 0.62;
    case "normalized_title_year_type":
      return 0.52;
    case "weak":
      return 0.25;
    case "none":
      return bestProviderConfidence(entries) * 0.45;
  }
}

// Uses the strongest provider confidence inside a merged group.
// Использует самый сильный confidence провайдера внутри объединенной группы.
function bestProviderConfidence(entries: SearchEntry[]): number {
  return Math.max(...entries.map((entry) => clampScore(entry.result.confidence ?? 0.5)));
}

// Scores how well result titles match the user's text query.
// Оценивает, насколько названия результатов совпадают с текстовым запросом пользователя.
function titleRelevanceScore(entries: SearchEntry[], queryTitle: string): number {
  const normalizedQuery = normalizeTitle(queryTitle);

  if (!normalizedQuery) {
    return 0;
  }

  return Math.max(
    ...entries.flatMap((entry) =>
      titleCandidates(entry.result.item).map((title) =>
        scoreNormalizedTitle(normalizeTitle(title), normalizedQuery),
      ),
    ),
  );
}

// Returns all useful titles that may match the query.
// Возвращает все полезные названия, которые могут совпасть с запросом.
function titleCandidates(item: MediaItem): string[] {
  return [item.title, item.originalTitle, ...(item.alternativeTitles ?? [])].filter(
    (title): title is string => Boolean(title?.trim()),
  );
}

// Scores one normalized title against one normalized query.
// Оценивает одно нормализованное название против одного нормализованного запроса.
function scoreNormalizedTitle(title: string, query: string): number {
  if (!title) {
    return 0;
  }

  if (title === query) {
    return 1;
  }

  if (title.replace(/\s+/g, "") === query.replace(/\s+/g, "")) {
    return 0.98;
  }

  if (title.startsWith(`${query} `)) {
    return 0.92;
  }

  if (title.includes(` ${query} `) || title.endsWith(` ${query}`)) {
    return 0.75;
  }

  const queryTokens = query.split(" ").filter(Boolean);

  if (queryTokens.length > 0 && queryTokens.every((token) => title.includes(token))) {
    return 0.55;
  }

  const titleTokens = title.split(" ").filter(Boolean);
  const fuzzyTokenScores = queryTokens.map((queryToken) =>
    Math.max(...titleTokens.map((titleToken) => fuzzyTokenSimilarity(queryToken, titleToken)), 0),
  );
  const minimumFuzzyScore = queryTokens.length >= 3 ? 0.7 : 0.75;

  if (
    fuzzyTokenScores.length > 0 &&
    fuzzyTokenScores.every((score) => score >= minimumFuzzyScore)
  ) {
    return (
      (fuzzyTokenScores.reduce((sum, score) => sum + score, 0) / fuzzyTokenScores.length) * 0.7
    );
  }

  return 0;
}

// Allows one small typo in meaningful words while keeping short tokens exact.
// Допускает одну небольшую опечатку в значимых словах, сохраняя короткие токены точными.
function fuzzyTokenSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (Math.min(left.length, right.length) < 4) {
    return 0;
  }

  if (isSingleAdjacentTransposition(left, right)) {
    return 1 - 1 / Math.max(left.length, right.length);
  }

  const variants = [right, ...(right.endsWith("s") ? [right.slice(0, -1)] : [])];
  const distance = Math.min(
    ...variants
      .filter((variant) => Math.abs(left.length - variant.length) <= 1)
      .map((variant) => levenshteinDistance(left, variant, 1)),
  );

  if (distance <= 1) {
    return 1 - distance / Math.max(left.length, right.length);
  }

  if (Math.min(left.length, right.length) >= 6 && isTranspositionPlusOneEdit(left, right)) {
    return 1 - 2 / Math.max(left.length, right.length);
  }

  return 0;
}

// Allows one adjacent swap plus one insertion, deletion, or substitution in long words.
// Допускает перестановку соседних символов и еще одну правку в длинных словах.
function isTranspositionPlusOneEdit(left: string, right: string): boolean {
  for (let index = 0; index < right.length - 1; index += 1) {
    const swapped =
      right.slice(0, index) + right[index + 1] + right[index] + right.slice(index + 2);

    if (Math.abs(left.length - swapped.length) <= 1 && levenshteinDistance(left, swapped, 1) <= 1) {
      return true;
    }
  }

  return false;
}

// Recognizes a single swapped adjacent character, a common typing error Levenshtein counts as two.
// Распознает перестановку соседних символов, которую Levenshtein считает двумя ошибками.
function isSingleAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let firstDifference = -1;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }

    if (firstDifference !== -1) {
      return (
        index === firstDifference + 1 &&
        left[firstDifference] === right[index] &&
        left[index] === right[firstDifference] &&
        left.slice(index + 1) === right.slice(index + 1)
      );
    }

    firstDifference = index;
  }

  return false;
}

function levenshteinDistance(left: string, right: string, maxDistance: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length] ?? maxDistance + 1;
}

// Scores popularity from the largest available vote count.
// Оценивает популярность по самому большому доступному числу голосов.
function ratingVotesScore(entries: SearchEntry[]): number {
  const maxVotes = Math.max(
    0,
    ...entries.flatMap(
      (entry) => entry.result.item.ratings?.map((rating) => rating.votes ?? 0) ?? [],
    ),
  );

  return Math.min(1, Math.log10(maxVotes + 1) / 7);
}

// Scores normalized rating values across providers.
// Оценивает нормализованные значения рейтингов от провайдеров.
function normalizedRatingScore(entries: SearchEntry[]): number {
  const values = entries.flatMap(
    (entry) =>
      entry.result.item.ratings
        ?.map((rating) => rating.value / rating.max)
        .filter((value) => Number.isFinite(value)) ?? [],
  );

  return values.length === 0 ? 0 : Math.max(...values.map((value) => clampScore(value)));
}

// Rewards results that carry strong external IDs for better follow-up details lookup.
// Поощряет результаты с сильными внешними ID для более надежной загрузки деталей.
function externalIdCompletenessScore(entries: SearchEntry[]): number {
  const idCount = Math.max(
    0,
    ...entries.map(
      (entry) => STRONG_ID_KEYS.filter((key) => Boolean(entry.result.item.ids?.[key])).length,
    ),
  );

  return Math.min(1, idCount / 3);
}

// Rewards results confirmed by multiple providers.
// Поощряет результаты, подтвержденные несколькими провайдерами.
function sourceCoverageScore(entries: SearchEntry[]): number {
  return Math.min(1, new Set(entries.map((entry) => entry.result.provider)).size / 3);
}

// Adds a small authority signal for sources that usually imply broader popularity.
// Добавляет небольшой сигнал авторитетности для источников, которые обычно отражают популярность.
function sourceAuthorityScore(entries: SearchEntry[]): number {
  const providers = [...new Set(entries.map((entry) => entry.result.provider))];

  return (
    providers.reduce((total, provider) => total + providerAuthority(provider), 0) /
    Math.max(1, providers.length)
  );
}

// Scores provider authority for broad text search ranking.
// Оценивает авторитетность провайдера для ранжирования широкого текстового поиска.
function providerAuthority(provider: string): number {
  switch (provider) {
    case "wikidata":
      return 0.7;
    case "tmdb":
      return 0.95;
    case "cinemeta":
      return 0.75;
    case "kinobd":
      return 0.75;
    case "imdb":
      return 0.65;
    case "kinopoisk":
      return 0.6;
    case "shikimori":
      return 0.9;
    case "anilist":
      return 0.9;
    default:
      return 0.3;
  }
}

// Keeps text-search scores comparable without flattening many strong matches to exactly 1.
// Сохраняет сравнимость text-search score без схлопывания сильных совпадений ровно в 1.
function boundedTextScore(score: number): number {
  return 0.5 + clampScore(score / (score + 1)) * 0.5;
}

// Restricts a score value to the public 0..1 range.
// Ограничивает значение score публичным диапазоном 0..1.
function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

// Returns the first non-empty selected value from sorted entries.
// Возвращает первое непустое выбранное значение из отсортированных entries.
function firstDefined<T>(
  entries: SearchEntry[],
  pick: (entry: SearchEntry) => T | undefined,
): T | undefined {
  for (const entry of entries) {
    const value = pick(entry);

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

// Returns the first non-empty selected value from sorted details entries.
// Возвращает первое непустое выбранное значение из отсортированных details entries.
function firstDefinedDetails<T>(
  entries: DetailsEntry[],
  pick: (entry: DetailsEntry) => T | undefined,
): T | undefined {
  for (const entry of entries) {
    const value = pick(entry);

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

// Returns the first lifecycle status that carries useful provider information.
// Возвращает первый lifecycle status, который несет полезную информацию от provider.
function firstMeaningfulDetailsStatus(entries: DetailsEntry[]): MediaDetails["status"] {
  return firstDefinedDetails(entries, (entry) => {
    const status = entry.result.details.status;

    return status === "unknown" ? undefined : status;
  });
}

// Returns the item with the highest computed score.
// Возвращает элемент с максимальной вычисленной оценкой.
function maxBy<T>(items: T[], score: (item: T) => number): T | undefined {
  return [...items].sort((left, right) => score(right) - score(left))[0];
}

// Calculates comparable image size from optional width and height.
// Вычисляет сравнимый размер изображения по опциональным width и height.
function imageArea(image: Image): number {
  if (image.width && image.height) {
    return image.width * image.height;
  }

  return image.width ?? image.height ?? 0;
}

// Checks whether an image has a valid HTTP(S) URL.
// Проверяет, есть ли у изображения валидный HTTP(S) URL.
function isValidImageUrl(image: Image | undefined): image is Image {
  if (!image?.url) {
    return false;
  }

  try {
    const url = new URL(image.url);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Checks whether two ID maps share at least one strong external ID.
// Проверяет, есть ли у двух карт ID хотя бы один общий сильный внешний ID.
function hasSharedStrongId(left: ExternalIds | undefined, right: ExternalIds | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return STRONG_ID_KEYS.some((key) => Boolean(left[key] && right[key] && left[key] === right[key]));
}

// Checks whether two ID maps contain conflicting strong external IDs.
// Проверяет, содержат ли две карты ID конфликтующие сильные внешние ID.
function hasStrongIdConflict(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return STRONG_ID_KEYS.some((key) => Boolean(left[key] && right[key] && left[key] !== right[key]));
}

// Normalizes titles for safe exact automatic grouping.
// Нормализует названия для безопасной автоматической группировки.
function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Builds a less aggressive key for exact title comparison.
// Создает менее агрессивный ключ для точного сравнения title.
function exactTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}
