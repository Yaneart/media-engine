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
import { filterDetailsEntriesByIdentity, warnDetailsTypeConflicts } from "./details-identity.js";
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
import { hasExactPrimaryTitle, scoreGroup, titleRelevanceScore } from "./scoring.js";
import { normalizeTitle, titleCandidates } from "./title.js";
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

    return groups
      .filter((group) => isSearchGroupRelevant(group, context))
      .map((group, groupIndex) => ({
        groupIndex,
        exactPrimaryTitleMatch: hasExactPrimaryQueryTitle(group.entries, context),
        result: mergeSearchGroup(group, context),
      }))
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
      })
      .map(({ result }) => result);
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
    const mediaType = selectMergedMediaType(sortedEntries.map((entry) => entry.result.details));
    const finalEntries = sortEntriesByPriority(
      sortedEntries,
      context,
      selectMetadataPriorityType(sortedEntries.map((entry) => entry.result.details)),
    );

    return mergeDetailsEntries(finalEntries, context, mediaType);
  }
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
  const queryTitle =
    "title" in (context.query ?? {}) ? (context.query as SearchQuery).title : undefined;
  const titleValues = entries.flatMap((entry) => titleCandidates(entry.result.item));
  const localizedTitleValues = filterLocalizedText(titleValues, context.language);
  const exactQueryTitle = queryTitle
    ? selectExactQueryTitle(
        localizedTitleValues.length ? localizedTitleValues : titleValues,
        queryTitle,
      )
    : undefined;

  if (exactQueryTitle) {
    return exactQueryTitle;
  }

  const localizedTitle = selectLocalizedText(
    entries.flatMap((entry) => [
      entry.result.item.title,
      entry.result.item.originalTitle,
      ...(entry.result.item.alternativeTitles ?? []),
    ]),
    context.language,
  );

  if (localizedTitle) {
    return localizedTitle;
  }

  return firstDefined(entries, (entry) => entry.result.item.title);
}

function selectExactQueryTitle(values: string[], queryTitle: string): string | undefined {
  const normalizedQueryTitle = normalizeTitle(queryTitle);
  return values.find((value) => normalizeTitle(value) === normalizedQueryTitle);
}

// Selects a details display title, preferring the queried title when it matches.
// Выбирает отображаемый title деталей, предпочитая title из запроса при совпадении.
function selectDetailsTitle(entries: DetailsEntry[], context: MergeContext): string | undefined {
  const localizedTitle = selectLocalizedText(
    entries.flatMap((entry) => [
      entry.result.details.title,
      entry.result.details.originalTitle,
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
