import type { Cache, CacheSetOptions } from "../cache/index.js";
import type { DetailsQuery, DetailsResponse } from "../details/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { ExternalIds, Image } from "../media/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type MediaProvider, type ProviderInfo } from "../providers/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
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
import {
  callTimedProviderAvailability,
  callTimedProviderDetails,
  callTimedProviderSearch,
  retryFailedSearchProviders,
  type ProviderAvailabilityCallOutcome,
  type ProviderDetailsCallOutcome,
  type ProviderSearchCallOutcome,
} from "./provider-calls.js";
import {
  appendUniqueSearchResults,
  createAvailabilityCacheKey,
  createDetailsCacheKey,
  createProviderSearchQuery,
  createSearchCacheKey,
  createSearchFallbackQuery,
  EXTERNAL_ID_SHORTCUTS,
  hasExternalIds,
  inferTitleLanguage,
  normalizeDetailsQuery,
  normalizeSearchQuery,
  normalizeStreamQuery,
  sortObject,
  validateDetailsQuery,
  validateSearchQuery,
  validateStreamQuery,
} from "./query.js";
import type { MediaEngineOptions } from "./types.js";

const SEARCH_ID_ENRICHMENT_LIMIT = 6;
const SEARCH_ID_ENRICHMENT_TIMEOUT_MS = 1_500;
const SEARCH_DETAILS_POSTER_ENRICHMENT_LIMIT = 3;
const SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS = 1_500;
const EXPIRING_AVAILABILITY_CACHE_SAFETY_MS = 1_000;

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

      appendUniqueSearchResults(
        providerResults,
        fallbackOutcomes.flatMap((outcome) => (outcome.failure ? [] : outcome.results)),
      );
      results = this.mergeStrategy.mergeSearchResults(providerResults, {
        query: normalizedQuery,
        language: searchLanguage,
        debug: this.debug,
        warnings,
        includeIrrelevantSearchResults: true,
      });
    }

    const excludedPosterProviders = new Set(failed.map((failure) => failure.provider));
    const posterEnrichmentPromise = Promise.all(
      results
        .slice(0, SEARCH_DETAILS_POSTER_ENRICHMENT_LIMIT)
        .filter((result) => hasExternalIds(result.item.ids))
        .map(async (result) => ({
          ids: result.item.ids,
          poster: await this.loadSearchPoster(
            result.item.type,
            result.item.ids,
            searchLanguage,
            excludedPosterProviders,
          ).catch(() => undefined),
        })),
    );
    const enrichmentResultsPromise = Promise.all(
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
    const [enrichmentResults, posterEnrichments] = await Promise.all([
      enrichmentResultsPromise,
      posterEnrichmentPromise,
    ]);
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

    const posterEnrichedResults = results.map((result) => {
      const poster = posterEnrichments.find(
        (enrichment) => enrichment.poster && hasSharedExternalId(result.item.ids, enrichment.ids),
      )?.poster;
      return poster ? { ...result, item: { ...result.item, poster } } : result;
    });
    const limitedResults =
      normalizedQuery.limit === undefined
        ? posterEnrichedResults
        : posterEnrichedResults.slice(0, normalizedQuery.limit);

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

    await this.cache?.set(cacheKey, availability, createAvailabilityCacheOptions(availability));

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

  // Loads only the canonical poster needed by search without blocking on a full details request.
  // Загружает только канонический постер для search, не блокируя полный details-запрос.
  private async loadSearchPoster(
    type: DetailsQuery["type"],
    ids: ExternalIds | undefined,
    language: string | undefined,
    excludedProviders: ReadonlySet<string>,
  ): Promise<Image | undefined> {
    if (!hasExternalIds(ids)) {
      return undefined;
    }

    const query: DetailsQuery = { type, ids, language };
    const providers = this.registry
      .selectDetailsProviders(query)
      .filter((provider) => !excludedProviders.has(provider.name));
    const outcomes = await Promise.all(
      providers.map((provider) => {
        const providerTimeoutMs = this.getProviderTimeoutMs(provider.name);
        return callTimedProviderDetails(provider, query, {
          debug: this.debug,
          language,
          timeoutMs:
            providerTimeoutMs === undefined
              ? SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS
              : Math.min(providerTimeoutMs, SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS),
        });
      }),
    );
    const providerResults = outcomes.flatMap((outcome) =>
      outcome.failure || !outcome.result ? [] : [outcome.result],
    );

    return this.mergeStrategy.mergeDetails(providerResults, {
      query,
      language,
      debug: this.debug,
      warnings: [],
    })?.poster;
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

// Keeps cached direct links from outliving the earliest advertised expiration.
// Не позволяет кешированным прямым ссылкам пережить ближайший заявленный срок действия.
function createAvailabilityCacheOptions(
  availability: MediaAvailability,
): CacheSetOptions | undefined {
  const expiresAtValues = [
    ...availability.options,
    ...(availability.episodes?.flatMap((episode) => episode.options) ?? []),
  ]
    .map((option) => option.expiresAt)
    .filter((value): value is string => value !== undefined)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  if (expiresAtValues.length === 0) {
    return undefined;
  }

  const earliestExpiration = Math.min(...expiresAtValues);

  return {
    ttlMs: Math.max(0, earliestExpiration - Date.now() - EXPIRING_AVAILABILITY_CACHE_SAFETY_MS),
  };
}

// Checks whether two normalized media identities share at least one exact external ID.
// Проверяет, совпадает ли у двух нормализованных media identity хотя бы один внешний ID.
function hasSharedExternalId(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return EXTERNAL_ID_SHORTCUTS.some((key) => Boolean(left[key] && left[key] === right[key]));
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
