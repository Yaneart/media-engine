import type { Cache } from "../cache/index.js";
import type { DetailsQuery, DetailsResponse } from "../details/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { MediaDetails } from "../media/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type ProviderInfo } from "../providers/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type {
  EngineWarning,
  ProviderFailure,
  ProviderTimingMeta,
  SearchIdentitySnapshotDebugMeta,
} from "../response/index.js";
import type { SearchQuery, SearchResponse } from "../search/index.js";
import type {
  MediaAvailability,
  StreamQuery,
  StreamingProvider,
  StreamingProviderInfo,
} from "../streaming/index.js";
import {
  createAvailabilityCacheOptions,
  hasUnknownStreamValidation,
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
  createAvailabilityCacheKey,
  createDetailsCacheKey,
  createProviderSearchQuery,
  createSearchCacheKey,
  createSearchFallbackQuery,
  createSearchIdentitySnapshotCacheKey,
  inferTitleLanguage,
  normalizeDetailsQuery,
  normalizeSearchQuery,
  normalizeStreamQuery,
  validateDetailsQuery,
  validateSearchQuery,
  validateStreamQuery,
} from "./query.js";
import { createResponseMeta, elapsedSince } from "./response-meta.js";
import { applySearchDetailsEnrichments, executeSearchEnrichmentPlan } from "./search-enrichment.js";
import { needsFallbackTitleDiscovery } from "./search-discovery.js";
import { applySearchPosterEnrichments } from "./search-poster-enrichment.js";
import {
  createSearchIdentitySnapshot,
  isUsableSearchIdentitySnapshot,
  recoverSearchIdentitySnapshot,
  SEARCH_IDENTITY_SNAPSHOT_CACHE_OPTIONS,
  type SearchIdentitySnapshot,
} from "./search-identity-snapshot.js";
import { SearchOutcomeAccumulator } from "./search-outcomes.js";
import { InFlightRequestCoalescer } from "./in-flight.js";
import { throwIfAborted, waitForCaller } from "./operation.js";
import { resolveProviderTimeoutMs, validateStreamingProviders } from "./runtime.js";
import { loadWithStaleFallback } from "./stale-fallback.js";
import { ProviderTimeoutBudget } from "./timeout-budget.js";
import type {
  MediaEngineOperationOptions,
  MediaEngineOptions,
  ProviderHealthStatus,
} from "./types.js";

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
  async search(
    query: SearchQuery,
    options: MediaEngineOperationOptions = {},
  ): Promise<SearchResponse> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const normalizedQuery = normalizeSearchQuery(query);
    validateSearchQuery(normalizedQuery);

    if (normalizedQuery.limit === 0) {
      return {
        query: normalizedQuery,
        results: [],
        meta: createResponseMeta({
          requested: [],
          successful: [],
          failed: [],
          warnings: [],
          cached: false,
          tookMs: elapsedSince(startedAt),
          debug: this.debug,
          timings: [],
        }),
      };
    }

    const searchLanguage = normalizedQuery.language ?? inferTitleLanguage(normalizedQuery.title);

    const cacheKey = createSearchCacheKey(normalizedQuery);
    const identitySnapshotCacheKey = createSearchIdentitySnapshotCacheKey(normalizedQuery);
    const cached = await waitForCaller(this.cache?.get<SearchResponse>(cacheKey), options.signal);

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

    const stale = await waitForCaller(
      this.cache?.getStale?.<SearchResponse>(cacheKey),
      options.signal,
    );
    const inFlight = this.inFlightRequests.forCaller(options);
    const pending = inFlight.run(`search:${cacheKey}`, async (operationSignal) => {
      const timeoutBudget = this.createProviderTimeoutBudget();
      const providers = this.registry.selectSearchProviders(normalizedQuery, {
        titleDiscovery: "primary",
      });
      const primaryProviderNames = new Set(providers.map((provider) => provider.name));
      const fallbackProviders = this.registry
        .selectSearchProviders(normalizedQuery, { titleDiscovery: "fallback" })
        .filter((provider) => !primaryProviderNames.has(provider.name));
      const requested = providers.map((provider) => provider.name);
      const successful: string[] = [];
      const failed: ProviderFailure[] = [];
      const warnings: EngineWarning[] = [];
      const providerResults: ProviderSearchResult[] = [];
      const providerTimings: ProviderTimingMeta[] = [];
      const searchOutcomes = new SearchOutcomeAccumulator({
        successful,
        failed,
        results: providerResults,
        timings: providerTimings,
        warnings,
      });

      const outcomes = await Promise.all(
        providers.map((provider) =>
          callTimedProviderSearch(provider, createProviderSearchQuery(normalizedQuery), {
            debug: this.debug,
            language: searchLanguage,
            signal: operationSignal,
            timeoutMs: timeoutBudget.getRemainingMs(provider.name),
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
          }),
        ),
      );
      searchOutcomes.appendMandatory(outcomes, "primary");

      if (outcomes.length > 0 && outcomes.every((outcome) => outcome.failure)) {
        const retryOutcomes = await retryFailedSearchProviders(
          providers,
          outcomes,
          normalizedQuery,
          {
            debug: this.debug,
            language: searchLanguage,
            signal: operationSignal,
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
            getTimeoutMs: (providerName) => timeoutBudget.getRemainingMs(providerName),
          },
        );
        searchOutcomes.appendMandatory(retryOutcomes, "retry");
      }

      let results = this.mergeStrategy.mergeSearchResults(providerResults, {
        query: normalizedQuery,
        language: searchLanguage,
        debug: this.debug,
        warnings,
        includeIrrelevantSearchResults: true,
      });

      const fallbackQuery = createSearchFallbackQuery(normalizedQuery);
      let relevantResults =
        fallbackQuery || fallbackProviders.length > 0
          ? this.mergeStrategy.mergeSearchResults(providerResults, {
              query: normalizedQuery,
              language: searchLanguage,
              debug: this.debug,
            })
          : results;

      if (fallbackQuery && relevantResults.length === 0) {
        const fallbackOutcomes = await Promise.all(
          providers.map((provider) =>
            callTimedProviderSearch(provider, createProviderSearchQuery(fallbackQuery), {
              debug: this.debug,
              language: searchLanguage,
              signal: operationSignal,
              timeoutMs: timeoutBudget.getRemainingMs(provider.name),
              circuitBreaker: this.circuitBreaker,
              concurrencyLimiter: this.concurrencyLimiter,
            }),
          ),
        );

        searchOutcomes.appendMandatory(fallbackOutcomes, "fallback", {
          deduplicateResults: true,
        });
        results = this.mergeStrategy.mergeSearchResults(providerResults, {
          query: normalizedQuery,
          language: searchLanguage,
          debug: this.debug,
          warnings,
          includeIrrelevantSearchResults: true,
        });
        relevantResults = this.mergeStrategy.mergeSearchResults(providerResults, {
          query: normalizedQuery,
          language: searchLanguage,
          debug: this.debug,
        });
      }

      if (
        fallbackProviders.length > 0 &&
        needsFallbackTitleDiscovery(normalizedQuery, relevantResults)
      ) {
        requested.push(...fallbackProviders.map((provider) => provider.name));
        const providerFallbackQuery =
          relevantResults.length === 0 && fallbackQuery ? fallbackQuery : normalizedQuery;
        const providerFallbackOutcomes = await Promise.all(
          fallbackProviders.map((provider) =>
            callTimedProviderSearch(provider, createProviderSearchQuery(providerFallbackQuery), {
              debug: this.debug,
              language: searchLanguage,
              signal: operationSignal,
              timeoutMs: timeoutBudget.getRemainingMs(provider.name),
              circuitBreaker: this.circuitBreaker,
              concurrencyLimiter: this.concurrencyLimiter,
            }),
          ),
        );

        searchOutcomes.appendMandatory(providerFallbackOutcomes, "provider_fallback", {
          deduplicateResults: true,
        });
        results = this.mergeStrategy.mergeSearchResults(providerResults, {
          query: normalizedQuery,
          language: searchLanguage,
          debug: this.debug,
          warnings,
          includeIrrelevantSearchResults: true,
        });
      }

      if (requested.length > 0 && successful.length === 0 && failed.length > 0) {
        throw new MediaEngineError({
          code: "PROVIDER_ERROR",
          message: "All search providers failed.",
          cause: { failed },
        });
      }

      const excludedPosterProviders = new Set(failed.map((failure) => failure.provider));
      const enrichment = await executeSearchEnrichmentPlan({
        results,
        publicLimit: normalizedQuery.limit,
        language: searchLanguage,
        excludedProviders: excludedPosterProviders,
        registry: this.registry,
        mergeStrategy: this.mergeStrategy,
        debug: this.debug,
        signal: operationSignal,
        circuitBreaker: this.circuitBreaker,
        concurrencyLimiter: this.concurrencyLimiter,
        getProviderTimeoutMs: (providerName) => timeoutBudget.getRemainingMs(providerName),
        loadReusableDetails: (query, signal, maxWaitMs) =>
          this.loadReusableDetails(query, signal, maxWaitMs),
      });
      searchOutcomes.appendIdEnrichment(enrichment.idOutcomes, enrichment.skippedId);
      searchOutcomes.observePosterEnrichment(
        enrichment.posterEnrichments.flatMap((item) => item.outcomes),
        enrichment.skippedPoster,
      );
      searchOutcomes.appendEnrichmentWarnings();
      const flattenedEnrichmentResults = enrichment.idOutcomes.flatMap((outcome) =>
        outcome.failure ? [] : outcome.results,
      );

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

      const detailsEnrichedResults = applySearchDetailsEnrichments(
        results,
        enrichment.detailsEnrichments,
      );
      const posterEnrichedResults = applySearchPosterEnrichments(
        detailsEnrichedResults,
        enrichment.posterEnrichments,
      );
      let identitySnapshotDebug: SearchIdentitySnapshotDebugMeta | undefined;
      const hasRetryableMandatoryFailure = searchOutcomes.hasRetryableMandatoryFailure();
      const identitySnapshot = await waitForCaller(
        this.cache?.get<SearchIdentitySnapshot>(identitySnapshotCacheKey),
        operationSignal,
      );

      if (failed.length === 0 || hasRetryableMandatoryFailure) {
        const recovery = recoverSearchIdentitySnapshot(posterEnrichedResults, identitySnapshot);
        posterEnrichedResults.splice(0, posterEnrichedResults.length, ...recovery.results);
        identitySnapshotDebug = recovery.debug;

        if (recovery.debug) {
          warnings.push({
            code: hasRetryableMandatoryFailure
              ? "SEARCH_IDENTITY_SNAPSHOT_FALLBACK"
              : "SEARCH_IDENTITY_SNAPSHOT_STABILIZED",
            message: hasRetryableMandatoryFailure
              ? "Restored previously confirmed search identities because mandatory discovery was retryably degraded."
              : "Kept previously confirmed search identities stable across equivalent searches.",
          });
        }
      }

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
          enrichment: searchOutcomes.getEnrichmentDebugMeta(),
          identitySnapshot: identitySnapshotDebug,
        }),
      };

      throwIfAborted(operationSignal);

      if (failed.length === 0 && !isUsableSearchIdentitySnapshot(identitySnapshot)) {
        const newIdentitySnapshot = createSearchIdentitySnapshot(posterEnrichedResults);

        if (newIdentitySnapshot) {
          await this.cache?.set(
            identitySnapshotCacheKey,
            newIdentitySnapshot,
            SEARCH_IDENTITY_SNAPSHOT_CACHE_OPTIONS,
          );
        } else {
          await this.cache?.delete(identitySnapshotCacheKey);
        }
      }

      // Keep the complete response most recent when a bounded cache can retain only one entry.
      // Сохраняем полный ответ последним, если bounded cache вмещает только одну запись.
      if (!hasRetryableMandatoryFailure) {
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
  async getDetails(
    query: DetailsQuery,
    options: MediaEngineOperationOptions = {},
  ): Promise<DetailsResponse> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const normalizedQuery = normalizeDetailsQuery(query);
    validateDetailsQuery(normalizedQuery);

    const cacheKey = createDetailsCacheKey(normalizedQuery);
    const cached = await waitForCaller(this.cache?.get<DetailsResponse>(cacheKey), options.signal);

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

    const stale = await waitForCaller(
      this.cache?.getStale?.<DetailsResponse>(cacheKey),
      options.signal,
    );
    const inFlight = this.inFlightRequests.forCaller(options);
    const pending = inFlight.run(`details:${cacheKey}`, async (operationSignal) => {
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
            signal: operationSignal,
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

      throwIfAborted(operationSignal);

      if (!hasRetryableProviderFailure(failed)) {
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

  // Loads normalized player and stream availability through streaming providers.
  // Загружает нормализованную доступность player и stream через streaming-провайдеры.
  async getAvailability(
    query: StreamQuery,
    options: MediaEngineOperationOptions = {},
  ): Promise<MediaAvailability> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const normalizedQuery = normalizeStreamQuery(query);
    validateStreamQuery(normalizedQuery);

    const cacheKey = createAvailabilityCacheKey(normalizedQuery);
    const cached = await waitForCaller(
      this.cache?.get<MediaAvailability>(cacheKey),
      options.signal,
    );

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

    const inFlight = this.inFlightRequests.forCaller(options);
    return inFlight.run(`availability:${cacheKey}`, async (operationSignal) => {
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
            signal: operationSignal,
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

      if (providers.length > 0 && failed.length === providers.length) {
        throw new MediaEngineError({
          code: "PROVIDER_ERROR",
          message: "All streaming providers failed.",
          cause: { failed },
        });
      }

      const availability = mergeAvailabilityResults(normalizedQuery, providerResults);
      const hasUnknownValidation = hasUnknownStreamValidation(availability);
      availability.meta = createResponseMeta({
        requested,
        successful,
        failed,
        warnings: hasUnknownValidation
          ? [
              {
                code: "STREAM_VALIDATION_DEGRADED",
                message: "One or more discovered player options could not be validated reliably.",
              },
            ]
          : [],
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
        timings: providerTimings,
      });

      throwIfAborted(operationSignal);

      if (!hasRetryableProviderFailure(failed) && !hasUnknownValidation) {
        await this.cache?.set(
          cacheKey,
          structuredClone(availability),
          createAvailabilityCacheOptions(availability),
        );
      }

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

  private async loadReusableDetails(
    query: DetailsQuery,
    signal: AbortSignal | undefined,
    maxWaitMs: number,
  ): Promise<MediaDetails | undefined> {
    if (maxWaitMs <= 0) {
      return undefined;
    }

    const normalizedQuery = normalizeDetailsQuery(query);
    const cacheKey = createDetailsCacheKey(normalizedQuery);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), maxWaitMs);
    const waitSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const cached = await waitForCaller(this.cache?.get<DetailsResponse>(cacheKey), waitSignal);

      if (cached) {
        return cached.details ?? undefined;
      }

      const inFlight = this.inFlightRequests.joinExisting<DetailsResponse>(`details:${cacheKey}`, {
        signal: waitSignal,
      });

      if (!inFlight) {
        return undefined;
      }

      return (await inFlight).details ?? undefined;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      if (timeoutController.signal.aborted) {
        return undefined;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

function hasRetryableProviderFailure(failures: ProviderFailure[]): boolean {
  return failures.some((failure) => failure.retryable);
}
