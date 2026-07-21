import type { DetailsQuery } from "../details/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { ExternalIds } from "../media/index.js";
import type { ProviderSearchQuery, ProviderSearchResult } from "../providers/index.js";
import type { SearchQuery } from "../search/index.js";
import type { StreamQuery } from "../streaming/index.js";

// Top-level public external ID shortcuts supported by engine queries.
// Верхнеуровневые публичные сокращения внешних ID, поддерживаемые query движка.
export const EXTERNAL_ID_SHORTCUTS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
] as const;

const EXTERNAL_ID_SOURCES = [...EXTERNAL_ID_SHORTCUTS, "worldArt"] as const;
const NUMERIC_EXTERNAL_ID_SOURCES = new Set<keyof ExternalIds>([
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
]);
const MEDIA_TYPES = new Set(["movie", "series", "anime"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const IMDB_TITLE_ID = /^tt\d{7,12}$/u;
const NUMERIC_EXTERNAL_ID = /^\d+$/u;

const SEARCH_FALLBACK_MIN_TOKENS = 3;
const SEARCH_FALLBACK_MIN_LAST_TOKEN_LENGTH = 4;
const SEARCH_JOINED_FALLBACK_MIN_LENGTH = 6;
const SEARCH_JOINED_FALLBACK_MAX_LENGTH = 8;
const SEARCH_JOINED_FALLBACK_MIN_PART_LENGTH = 3;
const MAX_SEARCH_LIMIT = 100;
const MAX_PROVIDER_SEARCH_LIMIT = 100;
const MAX_TITLE_LENGTH = 300;
const MAX_LANGUAGE_LENGTH = 35;
const MAX_EXTERNAL_ID_LENGTH = 128;
const MAX_DEPRECATED_DETAILS_ID_LENGTH = 128;
const MAX_PROVIDER_FILTER_LENGTH = 100;
const MAX_PROVIDER_FILTERS = 100;

// Normalizes top-level external ID shortcuts into the ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids.
export function normalizeSearchQuery(query: SearchQuery): SearchQuery {
  const title = normalizeOptionalString(query.title);
  const ids = normalizeExternalIds(query.ids, query);
  const language = normalizeLanguage(query.language);

  return {
    ...(title ? { title } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(query.year !== undefined ? { year: query.year } : {}),
    ...(ids ? { ids } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(language ? { language } : {}),
  };
}

// Infers a provider lookup language only when the caller did not specify one.
// Определяет язык provider lookup только если caller не передал его явно.
export function inferTitleLanguage(title: string | undefined): string | undefined {
  if (!title) return undefined;
  if (/[а-яё]/iu.test(title)) return "ru";
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(title)) return "ja";
  return /[a-z]/iu.test(title) ? "en" : undefined;
}

// Normalizes top-level external ID shortcuts into a details ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids для details.
export function normalizeDetailsQuery(query: DetailsQuery): DetailsQuery {
  const ids = normalizeExternalIds(query.ids, query);
  const id = normalizeOptionalString(query.id);
  const language = normalizeLanguage(query.language);

  return {
    ...(!ids && id ? { id } : {}),
    ...(ids ? { ids } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(language ? { language } : {}),
  };
}

// Normalizes top-level external ID shortcuts into a streaming ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids для streaming.
export function normalizeStreamQuery(query: StreamQuery): StreamQuery {
  const title = normalizeOptionalString(query.title);
  const ids = normalizeExternalIds(query.ids, query);
  const providers = normalizeProviderFilters(query.providers);
  const language = normalizeLanguage(query.language);

  return {
    type: query.type,
    ...(ids ? { ids } : {}),
    ...(title ? { title } : {}),
    ...(query.year !== undefined ? { year: query.year } : {}),
    ...(query.seasonNumber !== undefined ? { seasonNumber: query.seasonNumber } : {}),
    ...(query.episodeNumber !== undefined ? { episodeNumber: query.episodeNumber } : {}),
    ...(query.absoluteEpisodeNumber !== undefined
      ? { absoluteEpisodeNumber: query.absoluteEpisodeNumber }
      : {}),
    ...(providers ? { providers } : {}),
    ...(language ? { language } : {}),
  };
}

// Validates that a search query has at least one supported lookup input.
// Проверяет, что search query содержит хотя бы один поддерживаемый вход для поиска.
export function validateSearchQuery(query: SearchQuery): void {
  validateCommonQueryFields(query);

  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 0 || query.limit > MAX_SEARCH_LIMIT)
  ) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: `Search query limit must be an integer between 0 and ${MAX_SEARCH_LIMIT}.`,
    });
  }

  if (query.year !== undefined && (!Number.isInteger(query.year) || query.year < 0)) {
    throwInvalidQuery("Search query year must be a non-negative integer.");
  }

  if (query.title || hasExternalIds(query.ids)) {
    return;
  }

  throw new MediaEngineError({
    code: "INVALID_QUERY",
    message: "Search query must include title or external ids.",
  });
}

// Validates that a details query has at least one supported lookup input.
// Проверяет, что details query содержит хотя бы один поддерживаемый вход для поиска.
export function validateDetailsQuery(query: DetailsQuery): void {
  validateCommonQueryFields(query);

  if (query.id) {
    validateBoundedString("Details query id", query.id, MAX_DEPRECATED_DETAILS_ID_LENGTH);
  }

  if (hasExternalIds(query.ids)) {
    return;
  }

  if (query.id?.trim()) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message:
        "Details query id is not a supported global lookup. Use ids or a named external ID shortcut.",
    });
  }

  throw new MediaEngineError({
    code: "INVALID_QUERY",
    message: "Details query must include external ids.",
  });
}

// Validates that a streaming query can identify a media item or episode.
// Проверяет, что streaming query может определить медиа или эпизод.
export function validateStreamQuery(query: StreamQuery): void {
  validateCommonQueryFields(query);

  if (!query.type) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: "Stream query type is required.",
    });
  }

  if (query.providers && query.providers.length > MAX_PROVIDER_FILTERS) {
    throwInvalidQuery(
      `Stream query providers must contain at most ${MAX_PROVIDER_FILTERS} unique names.`,
    );
  }

  for (const provider of query.providers ?? []) {
    validateBoundedString("Stream query provider", provider, MAX_PROVIDER_FILTER_LENGTH);
  }

  if (
    [query.year, query.seasonNumber, query.episodeNumber, query.absoluteEpisodeNumber].some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0),
    )
  ) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: "Stream query numeric fields must be non-negative integers.",
    });
  }

  if (query.title || hasExternalIds(query.ids)) {
    return;
  }

  throw new MediaEngineError({
    code: "INVALID_QUERY",
    message: "Stream query must include title or external ids.",
  });
}

// Gives providers enough candidates so the engine can rank before applying the public limit.
// Дает провайдерам достаточно кандидатов, чтобы движок ранжировал до применения публичного limit.
export function createProviderSearchQuery(query: SearchQuery): ProviderSearchQuery {
  if (query.limit === undefined || query.limit === 0) {
    return query;
  }

  return {
    ...query,
    limit: getProviderSearchLimit(query),
  };
}

// Broadens an empty typo search or separates one likely joined compound title.
// Расширяет пустой поиск с опечаткой или разделяет вероятно слитное составное название.
export function createSearchFallbackQuery(query: SearchQuery): SearchQuery | undefined {
  if (!query.title || hasExternalIds(query.ids)) {
    return undefined;
  }

  const title = query.title.trim();
  const tokens = title.split(/\s+/);
  const lastToken = tokens.at(-1);

  if (
    tokens.length >= SEARCH_FALLBACK_MIN_TOKENS &&
    lastToken &&
    lastToken.length >= SEARCH_FALLBACK_MIN_LAST_TOKEN_LENGTH
  ) {
    return {
      ...query,
      title: tokens.slice(0, -1).join(" "),
    };
  }

  const characters = [...title];

  if (
    tokens.length !== 1 ||
    characters.length < SEARCH_JOINED_FALLBACK_MIN_LENGTH ||
    characters.length > SEARCH_JOINED_FALLBACK_MAX_LENGTH ||
    !/^\p{Script=Cyrillic}+$/u.test(title)
  ) {
    return undefined;
  }

  const splitIndex = Math.floor(characters.length / 2);

  if (
    splitIndex < SEARCH_JOINED_FALLBACK_MIN_PART_LENGTH ||
    characters.length - splitIndex < SEARCH_JOINED_FALLBACK_MIN_PART_LENGTH
  ) {
    return undefined;
  }

  return {
    ...query,
    title: `${characters.slice(0, splitIndex).join("")} ${characters.slice(splitIndex).join("")}`,
  };
}

// Adds fallback discoveries without duplicating the same provider item and its attribution.
// Добавляет fallback-результаты без дублирования item и атрибуции одного провайдера.
export function appendUniqueSearchResults(
  target: ProviderSearchResult[],
  candidates: ProviderSearchResult[],
): void {
  for (const candidate of candidates) {
    const isDuplicate = target.some(
      (existing) =>
        existing.provider === candidate.provider &&
        existing.item.type === candidate.item.type &&
        existing.item.id === candidate.item.id,
    );

    if (!isDuplicate) {
      target.push(candidate);
    }
  }
}

// Creates a stable cache key for a normalized search query.
// Создает стабильный cache key для нормализованного search query.
export function createSearchCacheKey(query: SearchQuery): string {
  return `search:${JSON.stringify(sortObject(query))}`;
}

// Shares confirmed identity ordering across equivalent searches with different public limits.
// Разделяет подтвержденный порядок identity между эквивалентными поисками с разными limit.
export function createSearchIdentitySnapshotCacheKey(query: SearchQuery): string {
  const { limit: _limit, ...identityQuery } = query;
  return `search-identity:${JSON.stringify(sortObject(identityQuery))}`;
}

// Creates a stable cache key for a normalized details query.
// Создает стабильный cache key для нормализованного details query.
export function createDetailsCacheKey(query: DetailsQuery): string {
  return `details:${JSON.stringify(sortObject(query))}`;
}

// Creates a stable cache key for a normalized streaming query.
// Создает стабильный cache key для нормализованного streaming query.
export function createAvailabilityCacheKey(query: StreamQuery): string {
  return `availability:${JSON.stringify(sortObject(query))}`;
}

// Checks whether an external ID object contains at least one ID.
// Проверяет, содержит ли объект внешних ID хотя бы один ID.
export function hasExternalIds(ids: ExternalIds | undefined): boolean {
  return Boolean(ids && Object.values(ids).some((value) => Boolean(value)));
}

function normalizeExternalIds(
  nestedIds: ExternalIds | undefined,
  shortcuts: Partial<Record<(typeof EXTERNAL_ID_SHORTCUTS)[number], string | undefined>>,
): ExternalIds | undefined {
  const ids: ExternalIds = {};

  for (const source of EXTERNAL_ID_SOURCES) {
    const nestedValue = normalizeOptionalString(nestedIds?.[source]);
    const shortcutValue = EXTERNAL_ID_SHORTCUTS.includes(
      source as (typeof EXTERNAL_ID_SHORTCUTS)[number],
    )
      ? normalizeOptionalString(shortcuts[source as (typeof EXTERNAL_ID_SHORTCUTS)[number]])
      : undefined;
    const value = shortcutValue ?? nestedValue;

    if (value) {
      ids[source] = source === "imdb" ? value.toLowerCase() : value;
    }
  }

  return hasExternalIds(ids) ? ids : undefined;
}

function normalizeProviderFilters(providers: string[] | undefined): string[] | undefined {
  if (!providers) {
    return undefined;
  }

  const normalized = [...new Set(providers.map(normalizeOptionalString).filter(isString))].sort();

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  return normalizeOptionalString(language)?.toLowerCase();
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function validateCommonQueryFields(query: {
  title?: string;
  type?: unknown;
  ids?: ExternalIds;
  language?: string;
}): void {
  if (query.type !== undefined && !MEDIA_TYPES.has(query.type as string)) {
    throwInvalidQuery("Query type must be movie, series, or anime.");
  }

  if (query.title) {
    validateBoundedString("Query title", query.title, MAX_TITLE_LENGTH);
  }

  if (query.language) {
    validateBoundedString("Query language", query.language, MAX_LANGUAGE_LENGTH);
  }

  for (const [source, value] of Object.entries(query.ids ?? {})) {
    validateBoundedString(`External ID ${source}`, value, MAX_EXTERNAL_ID_LENGTH);

    if (source === "imdb" && !IMDB_TITLE_ID.test(value)) {
      throwInvalidQuery("External ID imdb must use the tt prefix followed by 7 to 12 digits.");
    }

    if (
      NUMERIC_EXTERNAL_ID_SOURCES.has(source as keyof ExternalIds) &&
      !NUMERIC_EXTERNAL_ID.test(value)
    ) {
      throwInvalidQuery(`External ID ${source} must contain only digits.`);
    }
  }
}

function validateBoundedString(field: string, value: string, maxLength: number): void {
  if (value.length > maxLength) {
    throwInvalidQuery(`${field} must be at most ${maxLength} characters.`);
  }

  if (CONTROL_CHARACTERS.test(value)) {
    throwInvalidQuery(`${field} must not contain control characters.`);
  }
}

function throwInvalidQuery(message: string): never {
  throw new MediaEngineError({ code: "INVALID_QUERY", message });
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

// Sorts object keys recursively for deterministic JSON cache keys.
// Рекурсивно сортирует ключи объекта для детерминированных JSON cache keys.
export function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortObject(entryValue)]),
    );
  }

  return value;
}

// Expands broad short queries more because final ranking needs enough cross-provider candidates.
// Расширяет короткие широкие запросы сильнее, потому что финальному ranking нужны кандидаты разных провайдеров.
function getProviderSearchLimit(query: SearchQuery): number {
  if (isBroadShortTitleSearch(query)) {
    return Math.min(MAX_PROVIDER_SEARCH_LIMIT, Math.max(query.limit! * 10, 50));
  }

  return Math.min(MAX_PROVIDER_SEARCH_LIMIT, Math.max(query.limit! * 5, 10));
}

// Detects searches like "one" or "game" where popular canonical results may be deeper.
// Определяет поиски вроде "one" или "game", где популярные канонические результаты могут быть глубже.
function isBroadShortTitleSearch(query: SearchQuery): boolean {
  if (query.type || hasExternalIds(query.ids)) {
    return false;
  }

  const normalizedTitle = query.title?.trim().replace(/\s+/g, " ") ?? "";

  return (
    normalizedTitle.length > 0 && normalizedTitle.length <= 4 && !normalizedTitle.includes(" ")
  );
}
