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

const SEARCH_FALLBACK_MIN_TOKENS = 3;
const SEARCH_FALLBACK_MIN_LAST_TOKEN_LENGTH = 4;
const SEARCH_JOINED_FALLBACK_MIN_LENGTH = 6;
const SEARCH_JOINED_FALLBACK_MAX_LENGTH = 8;
const SEARCH_JOINED_FALLBACK_MIN_PART_LENGTH = 3;
const MAX_SEARCH_LIMIT = 100;
const MAX_PROVIDER_SEARCH_LIMIT = 100;

// Normalizes top-level external ID shortcuts into the ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids.
export function normalizeSearchQuery(query: SearchQuery): SearchQuery {
  const ids: ExternalIds = { ...(query.ids ?? {}) };

  for (const key of EXTERNAL_ID_SHORTCUTS) {
    const value = query[key];

    if (value) {
      ids[key] = value;
    }
  }

  return {
    ...query,
    title: query.title?.trim(),
    ids: hasExternalIds(ids) ? ids : undefined,
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
  const ids: ExternalIds = { ...(query.ids ?? {}) };

  for (const key of EXTERNAL_ID_SHORTCUTS) {
    const value = query[key];

    if (value) {
      ids[key] = value;
    }
  }

  return {
    ...query,
    ids: hasExternalIds(ids) ? ids : undefined,
  };
}

// Normalizes top-level external ID shortcuts into a streaming ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids для streaming.
export function normalizeStreamQuery(query: StreamQuery): StreamQuery {
  const ids: ExternalIds = { ...(query.ids ?? {}) };
  const providers = query.providers?.map((provider) => provider.trim()).filter(Boolean);
  const language = query.language?.trim();

  for (const key of EXTERNAL_ID_SHORTCUTS) {
    const value = query[key];

    if (value) {
      ids[key] = value;
    }
  }

  return {
    ...query,
    title: query.title?.trim(),
    ...(hasExternalIds(ids) ? { ids } : {}),
    ...(providers && providers.length > 0 ? { providers } : {}),
    ...(language ? { language } : {}),
  };
}

// Validates that a search query has at least one supported lookup input.
// Проверяет, что search query содержит хотя бы один поддерживаемый вход для поиска.
export function validateSearchQuery(query: SearchQuery): void {
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 0 || query.limit > MAX_SEARCH_LIMIT)
  ) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: `Search query limit must be an integer between 0 and ${MAX_SEARCH_LIMIT}.`,
    });
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
  if (query.id?.trim() || hasExternalIds(query.ids)) {
    return;
  }

  throw new MediaEngineError({
    code: "INVALID_QUERY",
    message: "Details query must include id or external ids.",
  });
}

// Validates that a streaming query can identify a media item or episode.
// Проверяет, что streaming query может определить медиа или эпизод.
export function validateStreamQuery(query: StreamQuery): void {
  if (!query.type) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: "Stream query type is required.",
    });
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
