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
const DEFAULT_PRIORITY = ["tmdb", "imdb", "kinopoisk", "shikimori"];
// Default provider priority for anime results.
// Приоритет провайдеров по умолчанию для аниме.
const ANIME_PRIORITY = ["shikimori", "tmdb", "imdb", "kinopoisk"];

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
      .map((group, groupIndex) => ({
        groupIndex,
        result: mergeSearchGroup(group, context),
      }))
      .sort((left, right) => {
        const scoreDiff = right.result.score - left.result.score;

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const titleDiff = left.result.item.title.localeCompare(right.result.item.title);

        if (titleDiff !== 0) {
          return titleDiff;
        }

        return left.groupIndex - right.groupIndex;
      })
      .map(({ result }) => result);
  }

  // Picks a primary details result for the early details merge implementation.
  // Выбирает основной details-результат для ранней реализации объединения деталей.
  mergeDetails(results: ProviderDetailsResult[], context: MergeContext = {}): MediaDetails | null {
    const primary = sortEntriesByPriority(
      results.map((result, index) => ({ result, index })),
      context,
      results[0]?.details.type,
    )[0];

    return primary?.result.details ?? null;
  }
}

// Groups search results by exact IDs first, then by normalized title/year/type.
// Группирует результаты сначала по точным ID, затем по нормализованным title/year/type.
function groupSearchResults(results: ProviderSearchResult[]): SearchGroup[] {
  const groups: SearchGroup[] = [];

  results.forEach((result, index) => {
    const entry = { result, index };
    const exactIdGroup = groups.find((group) => canJoinByExactId(entry, group));

    if (exactIdGroup) {
      exactIdGroup.entries.push(entry);
      exactIdGroup.matchStrength = "exact_id";
      return;
    }

    const titleGroup = groups.find((group) => canJoinByTitleYearType(entry, group));

    if (titleGroup) {
      const isExactTitleMatch = hasExactTitleYearTypeMatch(entry, titleGroup);

      titleGroup.entries.push(entry);
      titleGroup.matchStrength =
        titleGroup.matchStrength === "exact_title_year_type" || isExactTitleMatch
          ? "exact_title_year_type"
          : "normalized_title_year_type";
      return;
    }

    groups.push({ entries: [entry], matchStrength: "none" });
  });

  return groups;
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
      item.type === groupItem.type &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      normalizeTitle(item.title) !== "" &&
      normalizeTitle(item.title) === normalizeTitle(groupItem.title) &&
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
      item.type === groupItem.type &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      exactTitleKey(item.title) !== "" &&
      exactTitleKey(item.title) === exactTitleKey(groupItem.title)
    );
  });
}

// Merges one internal search group into one public search result.
// Объединяет одну внутреннюю группу поиска в один публичный результат поиска.
function mergeSearchGroup(group: SearchGroup, context: MergeContext): MediaSearchResult {
  const mediaType = group.entries[0]?.result.item.type;
  const sortedEntries = sortEntriesByPriority(group.entries, context, mediaType);
  const primary = sortedEntries[0]?.result.item;

  if (!primary) {
    throw new Error("Cannot merge an empty search group.");
  }

  const ids = mergeExternalIds(sortedEntries, context);
  const title = selectTitle(sortedEntries, context) ?? primary.title;
  const item: MediaItem = {
    ...primary,
    id: primary.id,
    type: primary.type,
    title,
    originalTitle: firstDefined(sortedEntries, (entry) => entry.result.item.originalTitle),
    alternativeTitles: mergeAlternativeTitles(sortedEntries, title),
    year: selectYear(sortedEntries, context),
    releaseDate: selectReleaseDate(sortedEntries),
    description: selectDescription(sortedEntries),
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

// Selects a display title, preferring the queried title when it matches.
// Выбирает отображаемый title, предпочитая title из запроса при совпадении.
function selectTitle(entries: SearchEntry[], context: MergeContext): string | undefined {
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

// Selects the longest useful description.
// Выбирает самое длинное полезное описание.
function selectDescription(entries: SearchEntry[]): string | undefined {
  return maxBy(
    entries
      .map((entry) => entry.result.item.description)
      .filter((description): description is string => Boolean(description?.trim())),
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

// Calculates a public score from match strength and query ID matches.
// Вычисляет публичную оценку по силе совпадения и ID из запроса.
function scoreGroup(group: SearchGroup, entries: SearchEntry[], context: MergeContext): number {
  const queryIds = "ids" in (context.query ?? {}) ? (context.query as SearchQuery).ids : undefined;

  if (queryIds && entries.some((entry) => hasSharedStrongId(queryIds, entry.result.item.ids))) {
    return 1;
  }

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

// Returns the item with the highest computed score.
// Возвращает элемент с максимальной вычисленной оценкой.
function maxBy<T>(items: T[], score: (item: T) => number): T | undefined {
  return [...items].sort((left, right) => score(right) - score(left))[0];
}

// Calculates image area from optional width and height.
// Вычисляет площадь изображения по опциональным width и height.
function imageArea(image: Image): number {
  return (image.width ?? 0) * (image.height ?? 0);
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
