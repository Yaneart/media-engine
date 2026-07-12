import type { Cache } from "../cache/index.js";
import type { DetailsQuery, DetailsResponse } from "../details/index.js";
import { MediaEngineError, ProviderError, toProviderFailure } from "../errors/index.js";
import type { ExternalIds } from "../media/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type MediaProvider, type ProviderInfo } from "../providers/index.js";
import type {
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
} from "../providers/index.js";
import type {
  EngineWarning,
  ProviderFailure,
  ProviderTimingMeta,
  ResponseMeta,
} from "../response/index.js";
import type { SearchQuery, SearchResponse } from "../search/index.js";
import type {
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
  StreamQuery,
  StreamingProvider,
  StreamingProviderInfo,
  StreamingProviderSource,
} from "../streaming/index.js";
import type { MediaEngineOptions } from "./types.js";

// Top-level public external ID shortcuts supported by engine queries.
// Верхнеуровневые публичные сокращения внешних ID, поддерживаемые query движка.
const EXTERNAL_ID_SHORTCUTS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
] as const;

const SEARCH_ID_ENRICHMENT_LIMIT = 6;
const SEARCH_ID_ENRICHMENT_TIMEOUT_MS = 1_500;
const SEARCH_FALLBACK_MIN_TOKENS = 3;
const SEARCH_FALLBACK_MIN_LAST_TOKEN_LENGTH = 4;
const MAX_SEARCH_LIMIT = 100;
const MAX_PROVIDER_SEARCH_LIMIT = 100;

// Main entry point for using Media Engine core.
// Главная точка входа для использования Media Engine core.
export class MediaEngine {
  private readonly registry: ProviderRegistry;
  private readonly streamingProviders: StreamingProvider[];
  private readonly cache?: Cache;
  private readonly mergeStrategy: MergeStrategy;
  private readonly timeoutMs?: number;
  private readonly providerTimeouts: Readonly<Record<string, number>>;
  private readonly debug: boolean;

  constructor(options: MediaEngineOptions = {}) {
    this.registry = new ProviderRegistry(options.providers ?? []);
    this.streamingProviders = validateStreamingProviders(options.streamingProviders ?? []);
    this.cache = options.cache;
    this.mergeStrategy = options.mergeStrategy ?? new DefaultMergeStrategy();
    this.timeoutMs = options.timeoutMs;
    this.providerTimeouts = { ...options.providerTimeouts };
    this.debug = options.debug ?? false;
  }

  // Returns safe registered provider metadata without provider internals.
  // Возвращает безопасные метаданные зарегистрированных провайдеров без внутренних данных.
  getProviders(): ProviderInfo[] {
    return this.registry.getProviders();
  }

  // Returns safe registered streaming provider metadata without provider internals.
  // Возвращает безопасные метаданные streaming-провайдеров без внутренних данных.
  getStreamingProviders(): StreamingProviderInfo[] {
    return this.streamingProviders.map((provider) => ({
      name: provider.name,
      version: provider.version,
      kind: provider.kind,
      capabilities: {
        mediaTypes: [...provider.capabilities.mediaTypes],
        lookup: {
          byTitle: provider.capabilities.lookup.byTitle,
          byExternalIds: [...provider.capabilities.lookup.byExternalIds],
          byEpisode: provider.capabilities.lookup.byEpisode,
        },
        features: provider.capabilities.features ? [...provider.capabilities.features] : undefined,
      },
    }));
  }

  // Searches media through selected providers and merges normalized results.
  // Ищет медиа через выбранных провайдеров и объединяет нормализованные результаты.
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeSearchQuery(query);
    validateSearchQuery(normalizedQuery);
    const searchLanguage = normalizedQuery.language ?? inferTitleLanguage(normalizedQuery.title);

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
    const providerTimings: ProviderTimingMeta[] = [];

    let outcomes = await Promise.all(
      providers.map((provider) =>
        callTimedProviderSearch(provider, createProviderSearchQuery(normalizedQuery), {
          debug: this.debug,
          language: searchLanguage,
          timeoutMs: this.getProviderTimeoutMs(provider.name),
        }),
      ),
    );

    if (outcomes.length > 0 && outcomes.every((outcome) => outcome.failure)) {
      outcomes = await retryFailedSearchProviders(providers, outcomes, normalizedQuery, {
        debug: this.debug,
        language: searchLanguage,
        getTimeoutMs: (providerName) => this.getProviderTimeoutMs(providerName),
      });
    }

    for (const outcome of outcomes) {
      providerTimings.push(outcome.timing);

      if (outcome.failure) {
        failed.push(outcome.failure);
      } else {
        successful.push(outcome.provider);
        providerResults.push(...outcome.results);
      }
    }

    if (providers.length > 0 && successful.length === 0 && failed.length > 0) {
      throw new MediaEngineError({
        code: "PROVIDER_ERROR",
        message: "All search providers failed.",
        cause: { failed },
      });
    }

    let results = this.mergeStrategy.mergeSearchResults(providerResults, {
      query: normalizedQuery,
      language: searchLanguage,
      debug: this.debug,
      warnings,
      includeIrrelevantSearchResults: true,
    });

    const fallbackQuery = createSearchFallbackQuery(normalizedQuery);
    const hasRelevantResults = fallbackQuery
      ? this.mergeStrategy.mergeSearchResults(providerResults, {
          query: normalizedQuery,
          language: searchLanguage,
          debug: this.debug,
        }).length > 0
      : true;

    if (fallbackQuery && !hasRelevantResults) {
      const fallbackOutcomes = await Promise.all(
        providers.map((provider) =>
          callTimedProviderSearch(provider, createProviderSearchQuery(fallbackQuery), {
            debug: this.debug,
            language: searchLanguage,
            timeoutMs: this.getProviderTimeoutMs(provider.name),
          }),
        ),
      );

      providerResults.push(
        ...fallbackOutcomes.flatMap((outcome) => (outcome.failure ? [] : outcome.results)),
      );
      results = this.mergeStrategy.mergeSearchResults(providerResults, {
        query: normalizedQuery,
        language: searchLanguage,
        debug: this.debug,
        warnings,
        includeIrrelevantSearchResults: true,
      });
    }

    const enrichmentResults = await Promise.all(
      results
        .slice(0, SEARCH_ID_ENRICHMENT_LIMIT)
        .filter((result) => needsSearchEnrichment(result.item) && hasExternalIds(result.item.ids))
        .map(async (result) => {
          const existingProviders = new Set(result.sources.map((source) => source.provider));
          const enrichmentType = result.item.type === "anime" ? undefined : result.item.type;
          const enrichmentProvider = this.registry
            .selectSearchProviders({ ids: result.item.ids, type: enrichmentType })
            .find((provider) => !existingProviders.has(provider.name));

          if (!enrichmentProvider) {
            return [];
          }

          const providerTimeoutMs = this.getProviderTimeoutMs(enrichmentProvider.name);
          const enrichmentTimeoutMs =
            providerTimeoutMs === undefined
              ? SEARCH_ID_ENRICHMENT_TIMEOUT_MS
              : Math.min(providerTimeoutMs, SEARCH_ID_ENRICHMENT_TIMEOUT_MS);
          const outcome = await callTimedProviderSearch(
            enrichmentProvider,
            {
              ids: result.item.ids,
              type: enrichmentType,
              limit: 1,
              language: searchLanguage,
            },
            {
              debug: this.debug,
              language: searchLanguage,
              timeoutMs: enrichmentTimeoutMs,
            },
          );

          return outcome.failure ? [] : outcome.results;
        }),
    );
    const flattenedEnrichmentResults = enrichmentResults.flat();

    if (flattenedEnrichmentResults.length > 0) {
      providerResults.push(...flattenedEnrichmentResults);
    }

    if (
      this.mergeStrategy instanceof DefaultMergeStrategy ||
      flattenedEnrichmentResults.length > 0
    ) {
      results = this.mergeStrategy.mergeSearchResults(providerResults, {
        query: normalizedQuery,
        language: searchLanguage,
        debug: this.debug,
        warnings,
      });
    }

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
        timings: providerTimings,
      }),
    };

    await this.cache?.set(cacheKey, response);

    return response;
  }

  // Loads media details through selected providers and merges normalized results.
  // Загружает детали медиа через выбранных провайдеров и объединяет нормализованные результаты.
  async getDetails(query: DetailsQuery): Promise<DetailsResponse> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeDetailsQuery(query);
    validateDetailsQuery(normalizedQuery);

    const cacheKey = createDetailsCacheKey(normalizedQuery);
    const cached = await this.cache?.get<DetailsResponse>(cacheKey);

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

    const providers = this.registry.selectDetailsProviders(normalizedQuery);
    const requested = providers.map((provider) => provider.name);
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const warnings: EngineWarning[] = [];
    const providerResults: ProviderDetailsResult[] = [];
    const providerTimings: ProviderTimingMeta[] = [];

    const outcomes = await Promise.all(
      providers.map((provider) =>
        callTimedProviderDetails(provider, normalizedQuery, {
          debug: this.debug,
          language: normalizedQuery.language,
          timeoutMs: this.getProviderTimeoutMs(provider.name),
        }),
      ),
    );

    for (const outcome of outcomes) {
      providerTimings.push(outcome.timing);

      if (outcome.failure) {
        failed.push(outcome.failure);
      } else {
        successful.push(outcome.provider);

        if (outcome.result) {
          providerResults.push(outcome.result);
        }
      }
    }

    if (providers.length > 0 && successful.length === 0 && failed.length > 0) {
      throw new MediaEngineError({
        code: "PROVIDER_ERROR",
        message: "All details providers failed.",
        cause: { failed },
      });
    }

    const details = this.mergeStrategy.mergeDetails(providerResults, {
      query: normalizedQuery,
      language: normalizedQuery.language,
      debug: this.debug,
      warnings,
    });

    const response: DetailsResponse = {
      query: normalizedQuery,
      details,
      meta: createResponseMeta({
        requested,
        successful,
        failed,
        warnings,
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
        timings: providerTimings,
      }),
    };

    await this.cache?.set(cacheKey, response);

    return response;
  }

  // Loads normalized player and stream availability through streaming providers.
  // Загружает нормализованную доступность player и stream через streaming-провайдеры.
  async getAvailability(query: StreamQuery): Promise<MediaAvailability> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeStreamQuery(query);
    validateStreamQuery(normalizedQuery);

    const cacheKey = createAvailabilityCacheKey(normalizedQuery);
    const cached = await this.cache?.get<MediaAvailability>(cacheKey);

    if (cached) {
      return {
        ...cached,
        query: normalizedQuery,
        meta: cached.meta
          ? {
              ...cached.meta,
              cached: true,
              tookMs: elapsedSince(startedAt),
            }
          : undefined,
      };
    }

    const providers = selectStreamingProviders(this.streamingProviders, normalizedQuery);
    const requested = providers.map((provider) => provider.name);
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const providerResults: MediaAvailability[] = [];
    const providerTimings: ProviderTimingMeta[] = [];

    const outcomes = await Promise.all(
      providers.map((provider) =>
        callTimedProviderAvailability(provider, normalizedQuery, {
          debug: this.debug,
          language: normalizedQuery.language,
          timeoutMs: this.getProviderTimeoutMs(provider.name),
        }),
      ),
    );

    for (const outcome of outcomes) {
      providerTimings.push(outcome.timing);

      if (outcome.failure) {
        failed.push(outcome.failure);
      } else if (outcome.result) {
        successful.push(outcome.provider);
        providerResults.push(outcome.result);
      }
    }

    if (providers.length > 0 && providerResults.length === 0 && failed.length > 0) {
      throw new MediaEngineError({
        code: "PROVIDER_ERROR",
        message: "All streaming providers failed.",
        cause: { failed },
      });
    }

    const availability = mergeAvailabilityResults(normalizedQuery, providerResults);
    availability.meta = createResponseMeta({
      requested,
      successful,
      failed,
      warnings: [],
      cached: false,
      tookMs: elapsedSince(startedAt),
      debug: this.debug,
      timings: providerTimings,
    });

    await this.cache?.set(cacheKey, availability);

    return availability;
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

  // Resolves a provider override without allowing it to exceed the global boundary.
  // Выбирает override провайдера, не позволяя ему превысить глобальную границу.
  private getProviderTimeoutMs(providerName: string): number | undefined {
    const providerTimeoutMs = this.providerTimeouts[providerName];

    if (providerTimeoutMs === undefined) {
      return this.timeoutMs;
    }

    return this.timeoutMs === undefined
      ? providerTimeoutMs
      : Math.min(this.timeoutMs, providerTimeoutMs);
  }

  // Gives future engine methods access to the debug flag.
  // Дает будущим методам движка доступ к debug-флагу.
  protected get engineDebug(): boolean {
    return this.debug;
  }
}

// Enriches compact catalog hits when follow-up cards would otherwise choose different metadata.
// Обогащает compact catalog hits, чтобы search и details не выбирали разные metadata.
function needsSearchEnrichment(item: {
  ratings?: unknown[];
  description?: string;
  poster?: unknown;
}): boolean {
  return !item.ratings?.length || !item.description?.trim() || !item.poster;
}

// Validates streaming providers and rejects duplicate public names.
// Проверяет streaming-провайдеры и отклоняет дубли публичных имен.
function validateStreamingProviders(providers: StreamingProvider[]): StreamingProvider[] {
  const names = new Set<string>();

  for (const provider of providers) {
    const name = provider.name.trim();

    if (!name) {
      throw new Error("Streaming provider name is required.");
    }

    if (name !== provider.name) {
      throw new Error(
        `Streaming provider name "${provider.name}" must not include leading or trailing whitespace.`,
      );
    }

    if (names.has(name)) {
      throw new Error(`Streaming provider "${name}" is already registered.`);
    }

    names.add(name);
  }

  return [...providers];
}

// Context passed to a single provider call.
// Контекст, передаваемый в один вызов провайдера.
interface ProviderCallContext {
  debug: boolean;
  language?: string;
  timeoutMs?: number;
}

interface SearchRetryContext {
  debug: boolean;
  language?: string;
  getTimeoutMs(providerName: string): number | undefined;
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
  timings?: ProviderTimingMeta[];
}

// Result of one provider search call after timing and failure normalization.
// Результат одного search-вызова провайдера после замера времени и нормализации ошибок.
interface ProviderSearchCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  results: ProviderSearchResult[];
  failure?: ProviderFailure;
}

// Result of one provider details call after timing and failure normalization.
// Результат одного details-вызова провайдера после замера времени и нормализации ошибок.
interface ProviderDetailsCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  result: ProviderDetailsResult | null;
  failure?: ProviderFailure;
}

// Result of one streaming provider call after timing and failure normalization.
// Результат одного streaming-вызова провайдера после замера времени и нормализации ошибок.
interface ProviderAvailabilityCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  result: MediaAvailability | null;
  failure?: ProviderFailure;
}

// Normalizes top-level external ID shortcuts into the ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids.
function normalizeSearchQuery(query: SearchQuery): SearchQuery {
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
function inferTitleLanguage(title: string | undefined): string | undefined {
  return title && /[а-яё]/iu.test(title) ? "ru" : undefined;
}

// Normalizes top-level external ID shortcuts into a details ids object.
// Нормализует верхнеуровневые сокращения внешних ID в объект ids для details.
function normalizeDetailsQuery(query: DetailsQuery): DetailsQuery {
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
function normalizeStreamQuery(query: StreamQuery): StreamQuery {
  const queryWithShortcuts = query as StreamQuery &
    Partial<Record<(typeof EXTERNAL_ID_SHORTCUTS)[number], string>>;
  const ids: ExternalIds = { ...(query.ids ?? {}) };
  const providers = query.providers?.map((provider) => provider.trim()).filter(Boolean);
  const language = query.language?.trim();

  for (const key of EXTERNAL_ID_SHORTCUTS) {
    const value = queryWithShortcuts[key];

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
function validateSearchQuery(query: SearchQuery): void {
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
function validateDetailsQuery(query: DetailsQuery): void {
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
function validateStreamQuery(query: StreamQuery): void {
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

// Selects streaming providers that can answer the normalized stream query.
// Выбирает streaming-провайдеры, которые могут ответить на нормализованный stream query.
function selectStreamingProviders(
  providers: StreamingProvider[],
  query: StreamQuery,
): StreamingProvider[] {
  return providers.filter((provider) => {
    if (query.providers && !query.providers.includes(provider.name)) {
      return false;
    }

    if (!provider.capabilities.mediaTypes.includes(query.type)) {
      return false;
    }

    if (hasEpisodeQuery(query) && !provider.capabilities.lookup.byEpisode) {
      return false;
    }

    return (
      Boolean(query.title && provider.capabilities.lookup.byTitle) ||
      hasSupportedExternalId(query.ids, provider.capabilities.lookup.byExternalIds)
    );
  });
}

// Gives providers enough candidates so the engine can rank before applying the public limit.
// Дает провайдерам достаточно кандидатов, чтобы движок ранжировал до применения публичного limit.
function createProviderSearchQuery(query: SearchQuery): ProviderSearchQuery {
  if (query.limit === undefined || query.limit === 0) {
    return query;
  }

  return {
    ...query,
    limit: getProviderSearchLimit(query),
  };
}

// Retries only transient failures when every selected search provider failed together.
// Повторяет только временные ошибки, когда одновременно упали все выбранные search-провайдеры.
async function retryFailedSearchProviders(
  providers: MediaProvider[],
  outcomes: ProviderSearchCallOutcome[],
  query: SearchQuery,
  context: SearchRetryContext,
): Promise<ProviderSearchCallOutcome[]> {
  return Promise.all(
    outcomes.map(async (outcome, index) => {
      const provider = providers[index];

      if (!provider || !outcome.failure?.retryable) {
        return outcome;
      }

      return callTimedProviderSearch(provider, createProviderSearchQuery(query), {
        debug: context.debug,
        language: context.language,
        timeoutMs: context.getTimeoutMs(provider.name),
      });
    }),
  );
}

// Broadens an empty multi-word search by removing its likely mistyped final word.
// Расширяет пустой многословный поиск, убирая последнее, вероятно ошибочное слово.
function createSearchFallbackQuery(query: SearchQuery): SearchQuery | undefined {
  if (!query.title || hasExternalIds(query.ids)) {
    return undefined;
  }

  const tokens = query.title.trim().split(/\s+/);
  const lastToken = tokens.at(-1);

  if (
    tokens.length < SEARCH_FALLBACK_MIN_TOKENS ||
    !lastToken ||
    lastToken.length < SEARCH_FALLBACK_MIN_LAST_TOKEN_LENGTH
  ) {
    return undefined;
  }

  return {
    ...query,
    title: tokens.slice(0, -1).join(" "),
  };
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

// Calls one search provider and returns normalized timing/failure metadata.
// Вызывает один search-провайдер и возвращает нормализованные timing/failure метаданные.
async function callTimedProviderSearch(
  provider: MediaProvider,
  query: ProviderSearchQuery,
  context: ProviderCallContext,
): Promise<ProviderSearchCallOutcome> {
  const startedAt = Date.now();

  try {
    const results = await callProviderSearch(provider, query, context);

    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "success",
        tookMs: elapsedSince(startedAt),
      },
      results,
    };
  } catch (error) {
    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "failed",
        tookMs: elapsedSince(startedAt),
      },
      results: [],
      failure: toProviderFailure(provider.name, error),
    };
  }
}

// Calls one details provider and returns normalized timing/failure metadata.
// Вызывает один details-провайдер и возвращает нормализованные timing/failure метаданные.
async function callTimedProviderDetails(
  provider: MediaProvider,
  query: ProviderDetailsQuery,
  context: ProviderCallContext,
): Promise<ProviderDetailsCallOutcome> {
  const startedAt = Date.now();

  try {
    const result = await callProviderDetails(provider, query, context);

    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "success",
        tookMs: elapsedSince(startedAt),
      },
      result,
    };
  } catch (error) {
    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "failed",
        tookMs: elapsedSince(startedAt),
      },
      result: null,
      failure: toProviderFailure(provider.name, error),
    };
  }
}

// Calls one streaming provider and returns normalized timing/failure metadata.
// Вызывает один streaming-провайдер и возвращает нормализованные timing/failure метаданные.
async function callTimedProviderAvailability(
  provider: StreamingProvider,
  query: StreamQuery,
  context: ProviderCallContext,
): Promise<ProviderAvailabilityCallOutcome> {
  const startedAt = Date.now();

  try {
    const result = await callProviderAvailability(provider, query, context);

    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "success",
        tookMs: elapsedSince(startedAt),
      },
      result,
    };
  } catch (error) {
    return {
      provider: provider.name,
      timing: {
        provider: provider.name,
        status: "failed",
        tookMs: elapsedSince(startedAt),
      },
      result: null,
      failure: toProviderFailure(provider.name, error),
    };
  }
}

// Calls one provider search method with timeout and abort signal support.
// Вызывает search одного провайдера с поддержкой timeout и abort signal.
async function callProviderSearch(
  provider: MediaProvider,
  query: ProviderSearchQuery,
  context: ProviderCallContext,
): Promise<ProviderSearchResult[]> {
  return withProviderTimeout(provider.name, context, (controller) =>
    provider.search(query, {
      signal: controller.signal,
      timeoutMs: context.timeoutMs,
      debug: context.debug,
      language: context.language,
    }),
  );
}

// Calls one provider details method with timeout and abort signal support.
// Вызывает getDetails одного провайдера с поддержкой timeout и abort signal.
async function callProviderDetails(
  provider: MediaProvider,
  query: ProviderDetailsQuery,
  context: ProviderCallContext,
): Promise<ProviderDetailsResult | null> {
  if (!provider.getDetails) {
    return null;
  }

  return withProviderTimeout(provider.name, context, (controller) =>
    provider.getDetails!(query, {
      signal: controller.signal,
      timeoutMs: context.timeoutMs,
      debug: context.debug,
      language: context.language,
    }),
  );
}

// Calls one streaming provider with timeout and abort signal support.
// Вызывает один streaming-провайдер с поддержкой timeout и abort signal.
async function callProviderAvailability(
  provider: StreamingProvider,
  query: StreamQuery,
  context: ProviderCallContext,
): Promise<MediaAvailability | null> {
  return withProviderTimeout(provider.name, context, (controller) =>
    provider.getAvailability(query, {
      signal: controller.signal,
      timeoutMs: context.timeoutMs,
      debug: context.debug,
      language: context.language,
    }),
  );
}

// Merges availability results without hiding provider attribution.
// Объединяет availability-результаты, не скрывая атрибуцию провайдеров.
function mergeAvailabilityResults(
  query: StreamQuery,
  results: MediaAvailability[],
): MediaAvailability {
  return {
    query,
    item: results.find((result) => result.item)?.item,
    episodes: mergeEpisodeAvailability(results),
    options: uniqueBy(
      results.flatMap((result) => result.options),
      (option) => `${option.provider}:${option.id}`,
    ),
    sourceProviders: uniqueBy(
      results.flatMap((result) => result.sourceProviders),
      (source) => createStreamingSourceKey(source),
    ),
    checkedAt: new Date().toISOString(),
  };
}

// Merges episode-level availability blocks by episode identity.
// Объединяет episode-level availability блоки по идентичности эпизода.
function mergeEpisodeAvailability(
  results: MediaAvailability[],
): StreamEpisodeAvailability[] | undefined {
  const episodesByKey = new Map<string, StreamEpisodeAvailability>();

  for (const episode of results.flatMap((result) => [
    ...(result.episodes ?? []),
    ...createEpisodeAvailabilityFromOptions(result.options),
  ])) {
    const key = createEpisodeKey(episode);
    const existing = episodesByKey.get(key);

    if (!existing) {
      episodesByKey.set(key, {
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
        title: episode.title,
        options: uniqueBy(episode.options, (option) => `${option.provider}:${option.id}`),
      });
      continue;
    }

    existing.options = uniqueBy(
      [...existing.options, ...episode.options],
      (option) => `${option.provider}:${option.id}`,
    );
    existing.title ??= episode.title;
  }

  return episodesByKey.size > 0 ? [...episodesByKey.values()] : undefined;
}

// Creates episode blocks from top-level options that carry episode identity.
// Создает episode blocks из top-level options, которые содержат идентичность эпизода.
function createEpisodeAvailabilityFromOptions(
  options: StreamOption[],
): StreamEpisodeAvailability[] {
  return options
    .filter((option) => option.episode)
    .map((option) => ({
      seasonNumber: option.episode?.seasonNumber,
      episodeNumber: option.episode?.episodeNumber,
      absoluteEpisodeNumber: option.episode?.absoluteEpisodeNumber,
      options: [option],
    }));
}

// Wraps a provider promise with configured timeout behavior.
// Оборачивает promise провайдера настроенным timeout-поведением.
async function withProviderTimeout<T>(
  providerName: string,
  context: ProviderCallContext,
  run: (controller: AbortController) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const providerPromise = run(controller);

    if (context.timeoutMs === undefined) {
      return await providerPromise;
    }

    const timeoutPromise = new Promise<T>((_, reject) => {
      const timeoutError = new ProviderError({
        provider: providerName,
        code: "PROVIDER_TIMEOUT",
        message: `Provider "${providerName}" timed out.`,
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

    return await Promise.race([providerPromise, timeoutPromise]);
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
    debug: input.debug
      ? {
          providers: input.requested,
          timings: input.timings ?? [],
        }
      : undefined,
  };
}

// Creates a stable cache key for a normalized search query.
// Создает стабильный cache key для нормализованного search query.
function createSearchCacheKey(query: SearchQuery): string {
  return `search:${JSON.stringify(sortObject(query))}`;
}

// Creates a stable cache key for a normalized details query.
// Создает стабильный cache key для нормализованного details query.
function createDetailsCacheKey(query: DetailsQuery): string {
  return `details:${JSON.stringify(sortObject(query))}`;
}

// Creates a stable cache key for a normalized streaming query.
// Создает стабильный cache key для нормализованного streaming query.
function createAvailabilityCacheKey(query: StreamQuery): string {
  return `availability:${JSON.stringify(sortObject(query))}`;
}

// Checks whether an external ID object contains at least one ID.
// Проверяет, содержит ли объект внешних ID хотя бы один ID.
function hasExternalIds(ids: ExternalIds | undefined): boolean {
  return Boolean(ids && Object.values(ids).some((value) => Boolean(value)));
}

// Checks whether query ids overlap provider-supported external ID sources.
// Проверяет, пересекаются ли query ids с поддерживаемыми провайдером источниками ID.
function hasSupportedExternalId(
  ids: ExternalIds | undefined,
  supportedSources: readonly string[],
): boolean {
  return Boolean(
    ids && supportedSources.some((source) => Boolean(ids[source as keyof ExternalIds])),
  );
}

// Checks whether query targets a concrete episode.
// Проверяет, нацелен ли query на конкретный эпизод.
function hasEpisodeQuery(query: StreamQuery): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}

// Creates a stable identity for an episode availability block.
// Создает стабильную идентичность для блока доступности эпизода.
function createEpisodeKey(episode: StreamEpisodeAvailability): string {
  return [
    episode.seasonNumber ?? "",
    episode.episodeNumber ?? "",
    episode.absoluteEpisodeNumber ?? "",
  ].join(":");
}

// Creates a stable identity for provider source attribution.
// Создает стабильную идентичность для атрибуции источника провайдера.
function createStreamingSourceKey(source: StreamingProviderSource): string {
  return `${source.provider}:${source.url ?? ""}:${JSON.stringify(sortObject(source.ids ?? {}))}`;
}

// Keeps the first value for each derived key.
// Оставляет первое значение для каждого вычисленного ключа.
function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const value of values) {
    const key = getKey(value);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(value);
    }
  }

  return unique;
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
