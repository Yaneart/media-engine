import type { Cache } from "../cache/index.js";
import type { DetailsQuery, DetailsResponse } from "../details/index.js";
import { MediaEngineError } from "../errors/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type ProviderInfo } from "../providers/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning, ProviderFailure, ProviderTimingMeta } from "../response/index.js";
import type { SearchQuery, SearchResponse } from "../search/index.js";
import type {
  MediaAvailability,
  StreamQuery,
  StreamingProvider,
  StreamingProviderInfo,
} from "../streaming/index.js";
import {
  createAvailabilityCacheOptions,
  mergeAvailabilityResults,
  selectStreamingProviders,
} from "./availability.js";
import { ProviderCircuitBreaker } from "./circuit-breaker.js";
import { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import {
  callTimedProviderAvailability,
  callTimedProviderDetails,
  callTimedProviderSearch,
  retryFailedSearchProviders,
} from "./provider-calls.js";
import {
  appendUniqueSearchResults,
  createAvailabilityCacheKey,
  createDetailsCacheKey,
  createProviderSearchQuery,
  createSearchCacheKey,
  createSearchFallbackQuery,
  hasExternalIds,
  inferTitleLanguage,
  normalizeDetailsQuery,
  normalizeSearchQuery,
  normalizeStreamQuery,
  validateDetailsQuery,
  validateSearchQuery,
  validateStreamQuery,
} from "./query.js";
import { createResponseMeta, elapsedSince } from "./response-meta.js";
import {
  applySearchPosterEnrichments,
  loadSearchPoster,
  needsSearchEnrichment,
} from "./search-enrichment.js";
import { InFlightRequestCoalescer } from "./in-flight.js";
import { resolveProviderTimeoutMs, validateStreamingProviders } from "./runtime.js";
import { loadWithStaleFallback } from "./stale-fallback.js";
import { ProviderTimeoutBudget } from "./timeout-budget.js";
import type { MediaEngineOptions, ProviderHealthStatus } from "./types.js";

const SEARCH_ID_ENRICHMENT_LIMIT = 6;
const SEARCH_ID_ENRICHMENT_TIMEOUT_MS = 1_500;
const SEARCH_DETAILS_POSTER_ENRICHMENT_LIMIT = 3;

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
  private readonly circuitBreaker?: ProviderCircuitBreaker;
  private readonly concurrencyLimiter?: ProviderConcurrencyLimiter;
  private readonly inFlightRequests = new InFlightRequestCoalescer();

  constructor(options: MediaEngineOptions = {}) {
    this.registry = new ProviderRegistry(options.providers ?? []);
    this.streamingProviders = validateStreamingProviders(options.streamingProviders ?? []);
    this.cache = options.cache;
    this.mergeStrategy = options.mergeStrategy ?? new DefaultMergeStrategy();
    this.timeoutMs = options.timeoutMs;
    this.providerTimeouts = { ...options.providerTimeouts };
    this.debug = options.debug ?? false;
    this.circuitBreaker =
      options.circuitBreaker === false
        ? undefined
        : new ProviderCircuitBreaker(options.circuitBreaker);
    this.concurrencyLimiter =
      options.providerConcurrency === false
        ? undefined
        : new ProviderConcurrencyLimiter(options.providerConcurrency);
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

  // Returns process-local provider reliability counters without exposing provider internals.
  // Возвращает локальные health-счетчики провайдеров без раскрытия их внутренностей.
  getProviderHealth(): ProviderHealthStatus[] {
    const metadata = this.registry
      .getProviders()
      .map((provider) => this.createProviderHealthStatus(provider.name, "metadata"));
    const streaming = this.streamingProviders.map((provider) =>
      this.createProviderHealthStatus(provider.name, "streaming"),
    );

    return [...metadata, ...streaming];
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
      const response = structuredClone(cached);

      return {
        ...response,
        query: normalizedQuery,
        meta: {
          ...response.meta,
          cached: true,
          tookMs: elapsedSince(startedAt),
        },
      };
    }

    const stale = await this.cache?.getStale?.<SearchResponse>(cacheKey);
    const pending = this.inFlightRequests.run(`search:${cacheKey}`, async () => {
      const timeoutBudget = this.createProviderTimeoutBudget();
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
            timeoutMs: timeoutBudget.getRemainingMs(provider.name),
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
          }),
        ),
      );

      if (outcomes.length > 0 && outcomes.every((outcome) => outcome.failure)) {
        outcomes = await retryFailedSearchProviders(providers, outcomes, normalizedQuery, {
          debug: this.debug,
          language: searchLanguage,
          circuitBreaker: this.circuitBreaker,
          concurrencyLimiter: this.concurrencyLimiter,
          getTimeoutMs: (providerName) => timeoutBudget.getRemainingMs(providerName),
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
              timeoutMs: timeoutBudget.getRemainingMs(provider.name),
              circuitBreaker: this.circuitBreaker,
              concurrencyLimiter: this.concurrencyLimiter,
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
            poster: await loadSearchPoster({
              result,
              language: searchLanguage,
              excludedProviders: excludedPosterProviders,
              registry: this.registry,
              mergeStrategy: this.mergeStrategy,
              debug: this.debug,
              circuitBreaker: this.circuitBreaker,
              concurrencyLimiter: this.concurrencyLimiter,
              getProviderTimeoutMs: (providerName) => timeoutBudget.getRemainingMs(providerName),
            }).catch(() => undefined),
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

            const enrichmentTimeoutMs = timeoutBudget.getRemainingMs(
              enrichmentProvider.name,
              SEARCH_ID_ENRICHMENT_TIMEOUT_MS,
            );
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
                circuitBreaker: this.circuitBreaker,
                concurrencyLimiter: this.concurrencyLimiter,
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

      const posterEnrichedResults = applySearchPosterEnrichments(results, posterEnrichments);
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

      if (!failed.some((failure) => failure.retryable)) {
        await this.cache?.set(cacheKey, structuredClone(response));
      }

      return response;
    });

    return loadWithStaleFallback({
      stale,
      pending,
      tookMs: () => elapsedSince(startedAt),
    });
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
      const response = structuredClone(cached);

      return {
        ...response,
        query: normalizedQuery,
        meta: {
          ...response.meta,
          cached: true,
          tookMs: elapsedSince(startedAt),
        },
      };
    }

    const stale = await this.cache?.getStale?.<DetailsResponse>(cacheKey);
    const pending = this.inFlightRequests.run(`details:${cacheKey}`, async () => {
      const timeoutBudget = this.createProviderTimeoutBudget();
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
            timeoutMs: timeoutBudget.getRemainingMs(provider.name),
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
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

      await this.cache?.set(cacheKey, structuredClone(response));

      return response;
    });

    return loadWithStaleFallback({
      stale,
      pending,
      tookMs: () => elapsedSince(startedAt),
    });
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
      const response = structuredClone(cached);

      return {
        ...response,
        query: normalizedQuery,
        meta: response.meta
          ? {
              ...response.meta,
              cached: true,
              tookMs: elapsedSince(startedAt),
            }
          : undefined,
      };
    }

    return this.inFlightRequests.run(`availability:${cacheKey}`, async () => {
      const timeoutBudget = this.createProviderTimeoutBudget();
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
            timeoutMs: timeoutBudget.getRemainingMs(provider.name),
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
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

      await this.cache?.set(
        cacheKey,
        structuredClone(availability),
        createAvailabilityCacheOptions(availability),
      );

      return availability;
    });
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
    return resolveProviderTimeoutMs(providerName, this.timeoutMs, this.providerTimeouts);
  }

  private createProviderTimeoutBudget(): ProviderTimeoutBudget {
    return new ProviderTimeoutBudget((providerName) => this.getProviderTimeoutMs(providerName));
  }

  private createProviderHealthStatus(
    provider: string,
    kind: ProviderHealthStatus["kind"],
  ): ProviderHealthStatus {
    if (!this.circuitBreaker) {
      return {
        provider,
        kind,
        circuitState: "disabled",
        consecutiveFailures: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      };
    }

    const snapshot = this.circuitBreaker.getSnapshot(`${kind}:${provider}`);

    return {
      provider,
      kind,
      circuitState: snapshot.state,
      consecutiveFailures: snapshot.consecutiveFailures,
      totalRequests: snapshot.totalRequests,
      totalSuccesses: snapshot.totalSuccesses,
      totalFailures: snapshot.totalFailures,
      lastSuccessAt:
        snapshot.lastSuccessAt === undefined
          ? undefined
          : new Date(snapshot.lastSuccessAt).toISOString(),
      lastFailureAt:
        snapshot.lastFailureAt === undefined
          ? undefined
          : new Date(snapshot.lastFailureAt).toISOString(),
      lastFailureCode: snapshot.lastFailureCode,
      failureCounts: snapshot.totalFailures > 0 ? snapshot.failureCounts : undefined,
      retryAfterMs: snapshot.retryAfterMs,
    };
  }

  // Gives future engine methods access to the debug flag.
  // Дает будущим методам движка доступ к debug-флагу.
  protected get engineDebug(): boolean {
    return this.debug;
  }
}
