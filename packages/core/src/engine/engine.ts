import type { Cache } from "../cache/index.js";
import { MediaEngineError, ProviderError, toProviderFailure } from "../errors/index.js";
import type { ExternalIds } from "../media/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type MediaProvider, type ProviderInfo } from "../providers/index.js";
import type { ProviderSearchQuery, ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning, ProviderFailure, ResponseMeta } from "../response/index.js";
import type { SearchQuery, SearchResponse } from "../search/index.js";
import type { MediaEngineOptions } from "./types.js";

// Top-level public external ID shortcuts supported by search queries.
// Верхнеуровневые публичные сокращения внешних ID, поддерживаемые search query.
const SEARCH_ID_SHORTCUTS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
] as const;

// Main entry point for using Media Engine core.
// Главная точка входа для использования Media Engine core.
export class MediaEngine {
  private readonly registry: ProviderRegistry;
  private readonly cache?: Cache;
  private readonly mergeStrategy: MergeStrategy;
  private readonly timeoutMs?: number;
  private readonly debug: boolean;

  constructor(options: MediaEngineOptions = {}) {
    this.registry = new ProviderRegistry(options.providers ?? []);
    this.cache = options.cache;
    this.mergeStrategy = options.mergeStrategy ?? new DefaultMergeStrategy();
    this.timeoutMs = options.timeoutMs;
    this.debug = options.debug ?? false;
  }

  // Returns safe registered provider metadata without provider internals.
  // Возвращает безопасные метаданные зарегистрированных провайдеров без внутренних данных.
  getProviders(): ProviderInfo[] {
    return this.registry.getProviders();
  }

  // Searches media through selected providers and merges normalized results.
  // Ищет медиа через выбранных провайдеров и объединяет нормализованные результаты.
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeSearchQuery(query);
    validateSearchQuery(normalizedQuery);

    const cacheKey = createSearchCacheKey(normalizedQuery);
    const cached = await this.cache?.get<SearchResponse>(cacheKey);

    if (cached) {
      return {
        ...cached,
        query: normalizedQuery,
        meta: {
          ...cached.meta,
          cached: true,
          tookMs: elapsedSince(startedAt),
        },
      };
    }

    const providers = this.registry.selectSearchProviders(normalizedQuery);
    const requested = providers.map((provider) => provider.name);
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const warnings: EngineWarning[] = [];
    const providerResults: ProviderSearchResult[] = [];

    for (const provider of providers) {
      try {
        const results = await callProviderSearch(provider, normalizedQuery, {
          debug: this.debug,
          language: normalizedQuery.language,
          timeoutMs: this.timeoutMs,
        });

        successful.push(provider.name);
        providerResults.push(...results);
      } catch (error) {
        failed.push(toProviderFailure(provider.name, error));
      }
    }

    if (providers.length > 0 && successful.length === 0 && failed.length > 0) {
      throw new MediaEngineError({
        code: "PROVIDER_ERROR",
        message: "All search providers failed.",
        cause: { failed },
      });
    }

    const results = this.mergeStrategy.mergeSearchResults(providerResults, {
      query: normalizedQuery,
      language: normalizedQuery.language,
      debug: this.debug,
      warnings,
    });

    const limitedResults =
      normalizedQuery.limit === undefined ? results : results.slice(0, normalizedQuery.limit);

    const response: SearchResponse = {
      query: normalizedQuery,
      results: limitedResults,
      meta: createResponseMeta({
        requested,
        successful,
        failed,
        warnings,
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
      }),
    };

    await this.cache?.set(cacheKey, response);

    return response;
  }

  // Gives future engine methods access to the registered providers.
  // Дает будущим методам движка доступ к зарегистрированным провайдерам.
  protected get providerRegistry(): ProviderRegistry {
    return this.registry;
  }

  // Gives future engine methods access to the optional cache.
  // Дает будущим методам движка доступ к опциональному cache.
  protected get engineCache(): Cache | undefined {
    return this.cache;
  }

  // Gives future engine methods access to the configured merge strategy.
  // Дает будущим методам движка доступ к настроенной стратегии объединения.
  protected get engineMergeStrategy(): MergeStrategy {
    return this.mergeStrategy;
  }

  // Gives future engine methods access to the configured timeout.
  // Дает будущим методам движка доступ к настроенному timeout.
  protected get engineTimeoutMs(): number | undefined {
    return this.timeoutMs;
  }

  // Gives future engine methods access to the debug flag.
  // Дает будущим методам движка доступ к debug-флагу.
  protected get engineDebug(): boolean {
    return this.debug;
  }
}

// Context passed to a single provider search call.
// Контекст, передаваемый в один вызов поиска провайдера.
interface SearchCallContext {
  debug: boolean;
  language?: string;
  timeoutMs?: number;
}

// Values used to build response metadata.
// Значения, используемые для создания метаданных ответа.
interface ResponseMetaInput {
  requested: string[];
  successful: string[];
  failed: ProviderFailure[];
  warnings: EngineWarning[];
  cached: boolean;
  tookMs: number;
  debug: boolean;
}

// Normalizes top-level external ID shortcuts into the ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids.
function normalizeSearchQuery(query: SearchQuery): SearchQuery {
  const ids: ExternalIds = { ...(query.ids ?? {}) };

  for (const key of SEARCH_ID_SHORTCUTS) {
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

// Validates that a search query has at least one supported lookup input.
// Проверяет, что search query содержит хотя бы один поддерживаемый вход для поиска.
function validateSearchQuery(query: SearchQuery): void {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) {
    throw new MediaEngineError({
      code: "INVALID_QUERY",
      message: "Search query limit must be a non-negative integer.",
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

// Calls one provider search method with timeout and abort signal support.
// Вызывает search одного провайдера с поддержкой timeout и abort signal.
async function callProviderSearch(
  provider: MediaProvider,
  query: ProviderSearchQuery,
  context: SearchCallContext,
): Promise<ProviderSearchResult[]> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const searchPromise = provider.search(query, {
      signal: controller.signal,
      timeoutMs: context.timeoutMs,
      debug: context.debug,
      language: context.language,
    });

    if (context.timeoutMs === undefined) {
      return await searchPromise;
    }

    const timeoutPromise = new Promise<ProviderSearchResult[]>((_, reject) => {
      const timeoutError = new ProviderError({
        provider: provider.name,
        code: "PROVIDER_TIMEOUT",
        message: `Provider "${provider.name}" timed out.`,
        retryable: true,
      });

      if (context.timeoutMs! <= 0) {
        controller.abort(timeoutError);
        reject(timeoutError);
        return;
      }

      timeout = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, context.timeoutMs);
    });

    return await Promise.race([searchPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// Creates public response metadata for a search call.
// Создает публичные метаданные ответа для search-вызова.
function createResponseMeta(input: ResponseMetaInput): ResponseMeta {
  return {
    providers: {
      requested: input.requested,
      successful: input.successful,
      failed: input.failed,
    },
    cached: input.cached,
    tookMs: input.tookMs,
    warnings: input.warnings.length > 0 ? input.warnings : undefined,
    debug: input.debug ? { providers: input.requested } : undefined,
  };
}

// Creates a stable cache key for a normalized search query.
// Создает стабильный cache key для нормализованного search query.
function createSearchCacheKey(query: SearchQuery): string {
  return `search:${JSON.stringify(sortObject(query))}`;
}

// Checks whether an external ID object contains at least one ID.
// Проверяет, содержит ли объект внешних ID хотя бы один ID.
function hasExternalIds(ids: ExternalIds | undefined): boolean {
  return Boolean(ids && Object.values(ids).some((value) => Boolean(value)));
}

// Returns elapsed milliseconds since a start timestamp.
// Возвращает количество миллисекунд, прошедших с начального timestamp.
function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}

// Sorts object keys recursively for deterministic JSON cache keys.
// Рекурсивно сортирует ключи объекта для детерминированных JSON cache keys.
function sortObject(value: unknown): unknown {
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
