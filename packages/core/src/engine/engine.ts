import type { Cache } from "../cache/index.js";
import type { DetailsQuery, DetailsResponse } from "../details/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { ExternalIds, MediaDetails } from "../media/index.js";
import type { IdentityResolver } from "../identity/index.js";
import { DefaultMergeStrategy, type MergeStrategy } from "../merge/index.js";
import { ProviderRegistry, type ProviderInfo } from "../providers/index.js";
import type {
  ProviderDetailsResult,
  MediaProvider,
  ProviderRelatedMediaResult,
  ProviderSearchResult,
} from "../providers/index.js";
import type {
  EngineWarning,
  ProviderFailure,
  ProviderTimingMeta,
  SearchIdentitySnapshotDebugMeta,
} from "../response/index.js";
import type { SearchQuery, SearchResponse } from "../search/index.js";
import type { RelatedMediaQuery, RelatedMediaResponse } from "../related/index.js";
import type {
  MediaAvailability,
  MediaAvailabilityProgressSnapshot,
  StreamQuery,
  StreamingProvider,
  StreamingProviderInfo,
} from "../streaming/index.js";
import type {
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentProvider,
  TorrentProviderInfo,
} from "../torrent/index.js";
import {
  createAvailabilityCacheOptions,
  createMediaAvailabilityState,
  enrichStreamQueryIdentity,
  getMissingStreamingIdentitySources,
  hasUnknownStreamValidation,
  mergeAvailabilityResults,
  selectStreamingProviders,
} from "./availability.js";
import { ProviderCircuitBreaker } from "./circuit-breaker.js";
import { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import {
  callTimedProviderAvailability,
  callTimedProviderAvailabilityProgressively,
  callTimedProviderDetails,
  callTimedProviderRelatedMedia,
  callTimedProviderSearch,
  retryFailedSearchProviders,
  type ProviderDetailsCallOutcome,
  type ProviderAvailabilityCallOutcome,
} from "./provider-calls.js";
import {
  createAvailabilityCacheKey,
  createDetailsCacheKey,
  createRelatedMediaCacheKey,
  createProviderSearchQuery,
  createSearchCacheKey,
  createSearchFallbackQuery,
  createSearchIdentitySnapshotCacheKey,
  inferTitleLanguage,
  normalizeDetailsQuery,
  normalizeRelatedMediaQuery,
  normalizeSearchQuery,
  normalizeStreamQuery,
  normalizeTorrentQuery,
  validateDetailsQuery,
  validateRelatedMediaQuery,
  validateSearchQuery,
  validateStreamQuery,
  validateTorrentQuery,
} from "./query.js";
import { createResponseMeta, elapsedSince } from "./response-meta.js";
import { applySearchDetailsEnrichments, executeSearchEnrichmentPlan } from "./search-enrichment.js";
import { needsFallbackTitleDiscovery, needsPrimaryTitleBroadening } from "./search-discovery.js";
import { applySearchPosterEnrichments } from "./search-poster-enrichment.js";
import {
  applySearchIdEnrichments,
  createFrozenDiscoveryResults,
  createSearchEnrichmentCandidates,
  finalizeSearchRankingEvidence,
  filterFrozenSearchResults,
} from "./search-result-freeze.js";
import {
  createSearchIdentitySnapshot,
  isUsableSearchIdentitySnapshot,
  recoverSearchIdentitySnapshot,
  SEARCH_IDENTITY_SNAPSHOT_CACHE_OPTIONS,
  type SearchIdentitySnapshot,
} from "./search-identity-snapshot.js";
import { SearchOutcomeAccumulator } from "./search-outcomes.js";
import { InFlightRequestCoalescer } from "./in-flight.js";
import { OperationCancelledError, throwIfAborted, waitForCaller } from "./operation.js";
import {
  resolveProviderTimeoutMs,
  validateStreamingProviders,
  validateTorrentProviders,
} from "./runtime.js";
import { executeTorrentDiscovery } from "./torrents.js";
import { mergeRelatedMediaResults } from "./related-media.js";
import { loadWithStaleFallback } from "./stale-fallback.js";
import {
  canonicalizeSearchCandidateWindow,
  hasIdentitySourceFailure,
  resolveItemIdentity,
  resolveQueryIdentity,
} from "./identity-integration.js";
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
  private readonly torrentProviders: TorrentProvider[];
  private readonly cache?: Cache;
  private readonly identityResolver?: IdentityResolver;
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
    this.torrentProviders = validateTorrentProviders(options.torrentProviders ?? []);
    this.cache = options.cache;
    this.identityResolver = options.identityResolver;
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
        ...(provider.capabilities.animeKinds
          ? { animeKinds: [...provider.capabilities.animeKinds] }
          : {}),
        lookup: {
          byTitle: provider.capabilities.lookup.byTitle,
          byExternalIds: [...provider.capabilities.lookup.byExternalIds],
          byEpisode: provider.capabilities.lookup.byEpisode,
        },
        features: provider.capabilities.features ? [...provider.capabilities.features] : undefined,
      },
    }));
  }

  // Returns safe registered torrent provider metadata without provider internals.
  // Возвращает безопасные метаданные torrent-провайдеров без внутренних данных.
  getTorrentProviders(): TorrentProviderInfo[] {
    return this.torrentProviders.map((provider) => ({
      name: provider.name,
      version: provider.version,
      kind: provider.kind,
      catalog: provider.catalog
        ? {
            displayName: provider.catalog.displayName,
            scope: provider.catalog.scope,
            ...(provider.catalog.locale ? { locale: provider.catalog.locale } : {}),
          }
        : undefined,
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
      .map((provider) =>
        this.createProviderHealthStatus(provider.name, "metadata", provider.configured),
      );
    const streaming = this.streamingProviders.map((provider) =>
      this.createProviderHealthStatus(provider.name, "streaming"),
    );
    const torrent = this.torrentProviders.map((provider) =>
      this.createProviderHealthStatus(provider.name, "torrent"),
    );

    return [...metadata, ...streaming, ...torrent];
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
    const usesMetadataRoutes = this.registry
      .selectSearchProviders(normalizedQuery)
      .some((provider) => provider.capabilities.metadataRoute === "primary");
    const load = async (operationSignal: AbortSignal) => {
      const timeoutBudget = this.createProviderTimeoutBudget();
      const providerSearchLanguage = usesMetadataRoutes
        ? (normalizedQuery.language ?? "ru")
        : searchLanguage;
      const requiresRussianMetadata =
        usesMetadataRoutes && (normalizedQuery.language ?? "ru").startsWith("ru");
      const providers = this.registry.selectSearchProviders(normalizedQuery, {
        titleDiscovery: "primary",
        ...(usesMetadataRoutes ? { metadataRoute: "primary" as const } : {}),
      });
      const primaryProviderNames = new Set(providers.map((provider) => provider.name));
      const fallbackProviders = this.registry
        .selectSearchProviders(
          normalizedQuery,
          usesMetadataRoutes ? { metadataRoute: "fallback" } : { titleDiscovery: "fallback" },
        )
        .filter(
          (provider) =>
            !primaryProviderNames.has(provider.name) &&
            !(requiresRussianMetadata && provider.name === "anilist"),
        );
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
            language: providerSearchLanguage,
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
            language: providerSearchLanguage,
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
              language: providerSearchLanguage,
              debug: this.debug,
            })
          : results;
      let primaryTitleBroadened = false;
      let providerFallbackUsed = false;

      if (fallbackQuery && needsPrimaryTitleBroadening(normalizedQuery, relevantResults)) {
        primaryTitleBroadened = true;
        const fallbackOutcomes = await Promise.all(
          providers.map((provider) =>
            callTimedProviderSearch(provider, createProviderSearchQuery(fallbackQuery), {
              debug: this.debug,
              language: providerSearchLanguage,
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
        !(primaryTitleBroadened && relevantResults.length > 0) &&
        (!usesMetadataRoutes || relevantResults.length === 0) &&
        needsFallbackTitleDiscovery(normalizedQuery, relevantResults)
      ) {
        providerFallbackUsed = true;
        requested.push(...fallbackProviders.map((provider) => provider.name));
        const providerFallbackQuery =
          relevantResults.length === 0 && fallbackQuery ? fallbackQuery : normalizedQuery;
        const providerFallbackOutcomes = await Promise.all(
          fallbackProviders.map((provider) =>
            callTimedProviderSearch(provider, createProviderSearchQuery(providerFallbackQuery), {
              debug: this.debug,
              language: providerSearchLanguage,
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

      let rankedDiscoveryResults =
        this.mergeStrategy instanceof DefaultMergeStrategy
          ? this.mergeStrategy.mergeSearchResults(providerResults, {
              query: normalizedQuery,
              language: searchLanguage,
              debug: this.debug,
            })
          : results;
      const identityCandidates =
        this.mergeStrategy instanceof DefaultMergeStrategy
          ? createFrozenDiscoveryResults(rankedDiscoveryResults, results)
          : results;
      const canonicalProviderResults =
        usesMetadataRoutes && !providerFallbackUsed
          ? providerResults
          : await canonicalizeSearchCandidateWindow(
              providerResults,
              identityCandidates,
              this.identityResolver,
              operationSignal,
              warnings,
            );

      if (canonicalProviderResults !== providerResults) {
        results = this.mergeStrategy.mergeSearchResults(canonicalProviderResults, {
          query: normalizedQuery,
          language: searchLanguage,
          debug: this.debug,
          includeIrrelevantSearchResults: true,
        });
        rankedDiscoveryResults =
          this.mergeStrategy instanceof DefaultMergeStrategy
            ? this.mergeStrategy.mergeSearchResults(canonicalProviderResults, {
                query: normalizedQuery,
                language: searchLanguage,
                debug: this.debug,
              })
            : results;
      }

      const preliminaryDiscoveryResults = results;

      if (this.mergeStrategy instanceof DefaultMergeStrategy) {
        results = createFrozenDiscoveryResults(rankedDiscoveryResults, results);
      }

      let identitySnapshotDebug: SearchIdentitySnapshotDebugMeta | undefined;
      const hasRetryableMandatoryFailure = searchOutcomes.hasRetryableMandatoryFailure();
      const identitySnapshot = await waitForCaller(
        this.cache?.get<SearchIdentitySnapshot>(identitySnapshotCacheKey),
        operationSignal,
      );

      if (failed.length === 0 || hasRetryableMandatoryFailure) {
        const recovery = recoverSearchIdentitySnapshot(results, identitySnapshot);
        results = recovery.results;
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

      const frozenDiscoveryResults = results;
      const enrichmentCandidates = createSearchEnrichmentCandidates(
        frozenDiscoveryResults,
        preliminaryDiscoveryResults,
      );

      const excludedPosterProviders = new Set(failed.map((failure) => failure.provider));
      const enrichment = await executeSearchEnrichmentPlan({
        results: enrichmentCandidates,
        publicLimit: normalizedQuery.limit,
        language: providerSearchLanguage,
        excludedProviders: excludedPosterProviders,
        metadataRoute: usesMetadataRoutes
          ? providerFallbackUsed
            ? "fallback"
            : "primary"
          : undefined,
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
      const idOutcomes = enrichment.idEnrichments.map((item) => item.outcome);
      searchOutcomes.appendIdEnrichment(idOutcomes, enrichment.skippedId);
      searchOutcomes.observePosterEnrichment(
        enrichment.posterEnrichments.flatMap((item) => item.outcomes),
        enrichment.skippedPoster,
      );
      searchOutcomes.appendEnrichmentWarnings();
      const idEnrichedResults = applySearchIdEnrichments(
        frozenDiscoveryResults,
        enrichment.idEnrichments,
        warnings,
        searchLanguage,
      );

      const detailsEnrichedResults = applySearchDetailsEnrichments(
        idEnrichedResults,
        enrichment.detailsEnrichments,
      );
      const posterEnrichedResults = applySearchPosterEnrichments(
        detailsEnrichedResults,
        enrichment.posterEnrichments,
      );
      const filteredResults = filterFrozenSearchResults(posterEnrichedResults, normalizedQuery, {
        enforceTitleRelevance: this.mergeStrategy instanceof DefaultMergeStrategy,
      });
      const visibleResultSet = new Set(filteredResults);
      const visibleDiscoveryResults = frozenDiscoveryResults.filter((_, index) =>
        visibleResultSet.has(posterEnrichedResults[index]!),
      );
      const visibleResults = finalizeSearchRankingEvidence(filteredResults);
      const offset = normalizedQuery.offset ?? 0;
      const limitedResults =
        normalizedQuery.limit === undefined
          ? visibleResults
          : visibleResults.slice(offset, offset + normalizedQuery.limit);
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
        const newIdentitySnapshot = createSearchIdentitySnapshot(visibleDiscoveryResults);

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
      if (!hasRetryableMandatoryFailure && !hasIdentitySourceFailure(warnings)) {
        await this.cache?.set(
          cacheKey,
          structuredClone(response),
          usesMetadataRoutes ? { ttlMs: 5 * 60_000, staleTtlMs: 30 * 60_000 } : undefined,
        );
      }

      return response;
    };

    if (stale && usesMetadataRoutes) {
      const background = this.inFlightRequests.forCaller().run(`search:${cacheKey}`, load);
      void background.catch(() => undefined);
      return createStaleSearchResponse(stale, normalizedQuery, startedAt);
    }

    const pending = this.inFlightRequests.forCaller(options).run(`search:${cacheKey}`, load);
    return usesMetadataRoutes
      ? await pending
      : loadWithStaleFallback({
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
    const identityWarnings: EngineWarning[] = [];
    const hasDirectPrimaryIdentity = this.registry
      .selectDetailsProviders(normalizedQuery)
      .some((provider) => provider.capabilities.metadataRoute === "primary");
    const resolvedQuery = hasDirectPrimaryIdentity
      ? normalizedQuery
      : await resolveQueryIdentity(
          normalizedQuery,
          this.identityResolver,
          options.signal,
          identityWarnings,
        );
    throwIfAborted(options.signal);

    const cacheKey = createDetailsCacheKey(resolvedQuery);
    const identityResolutionFailed = hasIdentitySourceFailure(identityWarnings);
    const cached = identityResolutionFailed
      ? undefined
      : await waitForCaller(this.cache?.get<DetailsResponse>(cacheKey), options.signal);

    if (cached) {
      const response = structuredClone(cached);

      return appendDetailsWarnings(
        {
          ...response,
          query: resolvedQuery,
          meta: {
            ...response.meta,
            cached: true,
            tookMs: elapsedSince(startedAt),
          },
        },
        identityWarnings,
      );
    }

    const stale = identityResolutionFailed
      ? undefined
      : await waitForCaller(this.cache?.getStale?.<DetailsResponse>(cacheKey), options.signal);
    const usesMetadataRoutes = this.registry
      .selectDetailsProviders(resolvedQuery)
      .some((provider) => provider.capabilities.metadataRoute === "primary");
    const load = (operationSignal: AbortSignal) =>
      this.loadDetailsSnapshot(
        resolvedQuery,
        cacheKey,
        operationSignal,
        startedAt,
        identityResolutionFailed,
      );

    if (stale && usesMetadataRoutes) {
      const background = this.inFlightRequests.forCaller().run(`details:${cacheKey}`, load);
      void background.catch(() => undefined);
      return appendDetailsWarnings(createStaleDetailsResponse(stale, startedAt), identityWarnings);
    }

    const pending = this.inFlightRequests.forCaller(options).run(`details:${cacheKey}`, load);
    const response = usesMetadataRoutes
      ? await pending
      : await loadWithStaleFallback({
          stale,
          pending,
          tookMs: () => elapsedSince(startedAt),
        });
    return appendDetailsWarnings(response, identityWarnings);
  }

  // Loads direct provider-neutral relationships for one exact media identity.
  // Загружает прямые провайдер-независимые связи для одной точной media identity.
  async getRelatedMedia(
    query: RelatedMediaQuery,
    options: MediaEngineOperationOptions = {},
  ): Promise<RelatedMediaResponse> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const normalizedQuery = normalizeRelatedMediaQuery(query);
    validateRelatedMediaQuery(normalizedQuery);

    const cacheKey = createRelatedMediaCacheKey(normalizedQuery);
    const cached = await waitForCaller(
      this.cache?.get<RelatedMediaResponse>(cacheKey),
      options.signal,
    );

    if (cached) {
      const response = structuredClone(cached);
      return {
        ...response,
        query: normalizedQuery,
        meta: { ...response.meta, cached: true, tookMs: elapsedSince(startedAt) },
      };
    }

    const stale = await waitForCaller(
      this.cache?.getStale?.<RelatedMediaResponse>(cacheKey),
      options.signal,
    );
    const inFlight = this.inFlightRequests.forCaller(options);
    const pending = inFlight.run(`related:${cacheKey}`, async (operationSignal) => {
      const timeoutBudget = this.createProviderTimeoutBudget();
      const providers = this.registry.selectRelatedMediaProviders(normalizedQuery);
      const requested = providers.map((provider) => provider.name);
      const successful: string[] = [];
      const failed: ProviderFailure[] = [];
      const warnings: EngineWarning[] = [];
      const providerTimings: ProviderTimingMeta[] = [];
      const providerResults: ProviderRelatedMediaResult[] = [];

      const outcomes = await Promise.all(
        providers.map((provider) =>
          callTimedProviderRelatedMedia(provider, normalizedQuery, {
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
          if (outcome.result) providerResults.push(outcome.result);
        }
      }

      if (providers.length > 0 && successful.length === 0 && failed.length > 0) {
        throw new MediaEngineError({
          code: "PROVIDER_ERROR",
          message: "All related media providers failed.",
          cause: { failed },
        });
      }

      const response: RelatedMediaResponse = {
        query: normalizedQuery,
        relations: mergeRelatedMediaResults(providerResults, normalizedQuery),
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
    const initialQuery = normalizeStreamQuery(query);
    validateStreamQuery(initialQuery);
    const identity = await this.resolveStreamQueryIdentity(initialQuery, options.signal);
    const normalizedQuery = identity.query;
    const playbackUserAgent = normalizePlaybackUserAgent(options.playbackUserAgent);
    const providers = selectStreamingProviders(this.streamingProviders, normalizedQuery);
    const cachePlaybackUserAgent = providers.some(
      (provider) => provider.availabilityDependsOnPlaybackUserAgent,
    )
      ? playbackUserAgent
      : undefined;

    const cacheKey = createAvailabilityCacheKey(normalizedQuery, cachePlaybackUserAgent);
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
            playbackUserAgent,
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
      availability.state = createMediaAvailabilityState(availability, {
        identityDegraded: identity.degraded,
        providerDegraded: failed.length > 0,
      });
      availability.meta = createResponseMeta({
        requested,
        successful,
        failed,
        warnings: createAvailabilityWarnings(identity.degraded, hasUnknownValidation),
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
        timings: providerTimings,
      });

      throwIfAborted(operationSignal);

      if (availability.state.status !== "degraded") {
        await this.cache?.set(
          cacheKey,
          structuredClone(availability),
          createAvailabilityCacheOptions(availability),
        );
      }

      return availability;
    });
  }

  // Publishes merged availability as providers and their individual sources resolve.
  // Публикует объединённую доступность по мере готовности провайдеров и их источников.
  async *getAvailabilityProgressively(
    query: StreamQuery,
    options: MediaEngineOperationOptions = {},
  ): AsyncGenerator<MediaAvailabilityProgressSnapshot> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const initialQuery = normalizeStreamQuery(query);
    validateStreamQuery(initialQuery);
    const identity = await this.resolveStreamQueryIdentity(initialQuery, options.signal);
    const normalizedQuery = identity.query;
    const playbackUserAgent = normalizePlaybackUserAgent(options.playbackUserAgent);
    const providers = selectStreamingProviders(this.streamingProviders, normalizedQuery);
    const cachePlaybackUserAgent = providers.some(
      (provider) => provider.availabilityDependsOnPlaybackUserAgent,
    )
      ? playbackUserAgent
      : undefined;
    const cacheKey = createAvailabilityCacheKey(normalizedQuery, cachePlaybackUserAgent);
    const cached = await waitForCaller(
      this.cache?.get<MediaAvailability>(cacheKey),
      options.signal,
    );

    if (cached) {
      const availability = structuredClone(cached);
      availability.query = normalizedQuery;
      if (availability.meta) {
        availability.meta = {
          ...availability.meta,
          cached: true,
          tookMs: elapsedSince(startedAt),
        };
      }
      yield { availability, state: "complete", pendingProviders: [] };
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timeoutBudget = this.createProviderTimeoutBudget();
    const requested = providers.map((provider) => provider.name);
    const successful = new Set<string>();
    const failed: ProviderFailure[] = [];
    const providerTimings: ProviderTimingMeta[] = [];
    const providerResults = new Map<string, MediaAvailability>();
    const completedProviders = new Set<string>();
    const events = new AvailabilityProgressEventQueue();
    const tasks = providers.map(async (provider) => {
      try {
        const outcome = await callTimedProviderAvailabilityProgressively(
          provider,
          normalizedQuery,
          {
            debug: this.debug,
            language: normalizedQuery.language,
            playbackUserAgent,
            signal: controller.signal,
            timeoutMs: timeoutBudget.getRemainingMs(provider.name),
            circuitBreaker: this.circuitBreaker,
            concurrencyLimiter: this.concurrencyLimiter,
          },
          (snapshot) => events.push({ kind: "snapshot", provider: provider.name, snapshot }),
        );
        events.push({ kind: "complete", outcome });
      } catch (error) {
        events.push({ kind: "error", error });
      }
    });

    try {
      if (providers.length === 0) {
        const availability = mergeAvailabilityResults(normalizedQuery, []);
        availability.state = createMediaAvailabilityState(availability, {
          identityDegraded: identity.degraded,
          providerDegraded: false,
        });
        availability.meta = createResponseMeta({
          requested,
          successful: [],
          failed,
          warnings: createAvailabilityWarnings(identity.degraded, false),
          cached: false,
          tookMs: elapsedSince(startedAt),
          debug: this.debug,
          timings: providerTimings,
        });
        yield { availability, state: "complete", pendingProviders: [] };
        return;
      }

      while (completedProviders.size < providers.length) {
        const event = await events.next();
        throwIfAborted(options.signal);

        if (event.kind === "error") throw event.error;

        if (event.kind === "snapshot") {
          if (event.snapshot.availability) {
            providerResults.set(event.provider, event.snapshot.availability);
            successful.add(event.provider);
          }

          if (event.snapshot.state === "pending" && event.snapshot.availability) {
            yield createEngineAvailabilityProgressSnapshot({
              query: normalizedQuery,
              providers,
              providerResults,
              requested,
              successful,
              failed,
              providerTimings,
              completedProviders,
              startedAt,
              debug: this.debug,
              identityDegraded: identity.degraded,
              state: "pending",
            });
          }
          continue;
        }

        const { outcome } = event;
        completedProviders.add(outcome.provider);
        providerTimings.push(outcome.timing);

        if (outcome.failure) {
          failed.push(outcome.failure);
        } else {
          successful.add(outcome.provider);
          if (outcome.result) providerResults.set(outcome.provider, outcome.result);
        }

        if (completedProviders.size < providers.length) {
          if (providerResults.size > 0) {
            yield createEngineAvailabilityProgressSnapshot({
              query: normalizedQuery,
              providers,
              providerResults,
              requested,
              successful,
              failed,
              providerTimings,
              completedProviders,
              startedAt,
              debug: this.debug,
              identityDegraded: identity.degraded,
              state: "pending",
            });
          }
          continue;
        }

        if (failed.length === providers.length) {
          const orderedFailures = requested.flatMap((provider) => {
            const failure = failed.find((candidate) => candidate.provider === provider);
            return failure ? [failure] : [];
          });
          throw new MediaEngineError({
            code: "PROVIDER_ERROR",
            message: "All streaming providers failed.",
            cause: { failed: orderedFailures },
          });
        }

        const finalSnapshot = createEngineAvailabilityProgressSnapshot({
          query: normalizedQuery,
          providers,
          providerResults,
          requested,
          successful,
          failed,
          providerTimings,
          completedProviders,
          startedAt,
          debug: this.debug,
          identityDegraded: identity.degraded,
          state: "complete",
        });
        const finalAvailability = finalSnapshot.availability!;

        throwIfAborted(controller.signal);
        if (finalAvailability.state?.status !== "degraded") {
          await this.cache?.set(
            cacheKey,
            structuredClone(finalAvailability),
            createAvailabilityCacheOptions(finalAvailability),
          );
        }

        yield finalSnapshot;
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (!controller.signal.aborted) {
        controller.abort(new OperationCancelledError());
      }
      await Promise.allSettled(tasks);
    }
  }

  private async resolveStreamQueryIdentity(
    query: StreamQuery,
    signal: AbortSignal | undefined,
  ): Promise<{ query: StreamQuery; degraded: boolean }> {
    const initialMissing = getMissingStreamingIdentitySources(this.streamingProviders, query);
    const validateAnimeEpisode = needsAnimeEpisodeIdentityValidation(
      this.streamingProviders,
      query,
    );
    const validation = validateAnimeEpisode
      ? await verifyAnimeEpisodeIdentity(query, this.identityResolver, signal)
      : { query, degraded: false };
    if (validateAnimeEpisode) {
      return {
        query: validation.query,
        degraded:
          validation.degraded ||
          getMissingStreamingIdentitySources(this.streamingProviders, validation.query).length > 0,
      };
    }
    const safeQuery =
      initialMissing.length > 0
        ? await resolveQueryIdentity(query, this.identityResolver, signal)
        : query;
    const missingSources = getMissingStreamingIdentitySources(this.streamingProviders, safeQuery);
    const identityDegraded = validation.degraded || missingSources.length > 0;

    if (missingSources.length === 0) return { query: safeQuery, degraded: identityDegraded };
    if (!safeQuery.title) return { query: safeQuery, degraded: true };

    try {
      const response = await this.search(
        {
          title: safeQuery.title,
          type: safeQuery.type,
          year: safeQuery.year,
          ids: safeQuery.ids,
          limit: 10,
          language: safeQuery.language,
        },
        { signal },
      );

      const enriched = enrichStreamQueryIdentity(safeQuery, response, missingSources);
      return {
        query: enriched,
        degraded:
          identityDegraded ||
          getMissingStreamingIdentitySources(this.streamingProviders, enriched).length > 0,
      };
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof MediaEngineError && error.code === "PROVIDER_ERROR") {
        return { query: safeQuery, degraded: true };
      }
      throw error;
    }
  }

  // Discovers normalized torrent handoff candidates through torrent providers.
  // Находит нормализованные torrent handoff кандидаты через torrent-провайдеры.
  async discoverTorrents(
    query: TorrentDiscoveryQuery,
    options: MediaEngineOperationOptions = {},
  ): Promise<TorrentDiscoveryResponse> {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    const normalizedQuery = normalizeTorrentQuery(query);
    validateTorrentQuery(normalizedQuery);
    const needsIdentity = this.torrentProviders.some(
      (provider) =>
        (!normalizedQuery.providers || normalizedQuery.providers.includes(provider.name)) &&
        provider.capabilities.mediaTypes.includes(normalizedQuery.type) &&
        !(normalizedQuery.title && provider.capabilities.lookup.byTitle) &&
        !provider.capabilities.lookup.byExternalIds.some((source) => normalizedQuery.ids?.[source]),
    );
    const resolvedQuery = needsIdentity
      ? await resolveQueryIdentity(normalizedQuery, this.identityResolver, options.signal)
      : normalizedQuery;

    return executeTorrentDiscovery({
      query: resolvedQuery,
      options,
      startedAt,
      providers: this.torrentProviders,
      cache: this.cache,
      debug: this.debug,
      circuitBreaker: this.circuitBreaker,
      concurrencyLimiter: this.concurrencyLimiter,
      inFlightRequests: this.inFlightRequests,
      getProviderTimeoutMs: (providerName) => this.getProviderTimeoutMs(providerName),
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

  private async loadDetailsSnapshot(
    query: DetailsQuery,
    cacheKey: string,
    signal: AbortSignal,
    startedAt: number,
    identityResolutionFailed: boolean,
  ): Promise<DetailsResponse> {
    const allProviders = this.registry.selectDetailsProviders(query);
    if (!allProviders.some((provider) => provider.capabilities.metadataRoute === "primary")) {
      return this.loadLegacyDetailsSnapshot(
        query,
        cacheKey,
        signal,
        startedAt,
        identityResolutionFailed,
        allProviders,
      );
    }

    const timeoutBudget = this.createProviderTimeoutBudget();
    const primaryProviders = this.registry.selectDetailsProviders(query, {
      metadataRoute: "primary",
    });
    const fallbackProviders = this.registry.selectDetailsProviders(query, {
      metadataRoute: "fallback",
    });
    const requested: string[] = [];
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const warnings: EngineWarning[] = [];
    const timings: ProviderTimingMeta[] = [];
    const operationDeadline = Date.now() + 6_000;
    const primaryDeadline = Math.min(operationDeadline, Date.now() + 2_000);
    let selected: ProviderDetailsResult | undefined;
    let route: "primary" | "fallback" = "primary";

    const primaryOutcomes = await Promise.all(
      primaryProviders.map((provider) =>
        this.callDetailsProvider(
          provider,
          query,
          signal,
          timeoutBudget,
          primaryDeadline,
          "primary",
        ),
      ),
    );
    const finalPrimaryOutcomes: ProviderDetailsCallOutcome[] = [];
    for (let index = 0; index < primaryOutcomes.length; index += 1) {
      const provider = primaryProviders[index]!;
      const first = primaryOutcomes[index]!;
      requested.push(provider.name);
      recordDetailsOutcome(first, successful, failed, timings, "primary");

      if (first.failure?.retryable && Date.now() < primaryDeadline) {
        const retried = await this.callDetailsProvider(
          provider,
          query,
          signal,
          timeoutBudget,
          primaryDeadline,
          "retry",
        );
        recordDetailsOutcome(retried, successful, failed, timings, "retry");
        finalPrimaryOutcomes.push(retried);
      } else {
        finalPrimaryOutcomes.push(first);
      }
    }

    for (const outcome of finalPrimaryOutcomes) {
      if (!outcome.result) continue;
      const invalidReason = getInvalidMetadataSnapshotReason(outcome.result.details, query, true);
      if (!invalidReason) {
        selected = outcome.result;
        break;
      }
      failed.push(createInvalidMetadataFailure(outcome.provider, invalidReason, "primary"));
    }

    const fallbackResults: ProviderDetailsResult[] = [];
    if (!selected) {
      route = "fallback";
      const fallbackDeadline = Math.min(operationDeadline, Date.now() + 3_500);
      for (const provider of fallbackProviders) {
        throwIfAborted(signal);
        if (Date.now() >= fallbackDeadline) break;
        requested.push(provider.name);
        const outcome = await this.callDetailsProvider(
          provider,
          query,
          signal,
          timeoutBudget,
          fallbackDeadline,
          "fallback",
        );
        recordDetailsOutcome(outcome, successful, failed, timings, "fallback");
        if (!outcome.result) continue;

        const invalidReason = getInvalidMetadataSnapshotReason(
          outcome.result.details,
          query,
          false,
          outcome.provider,
        );
        if (!invalidReason) {
          selected = outcome.result;
          break;
        }
        if (isIdentityCompatible(outcome.result.details, query)) {
          fallbackResults.push(outcome.result);
        } else {
          failed.push(createInvalidMetadataFailure(outcome.provider, invalidReason, "fallback"));
        }
      }

      if (
        !selected &&
        fallbackResults.length > 1 &&
        haveCompatibleIdentities(fallbackResults) &&
        hasLocalizedTextAnchor(fallbackResults, query)
      ) {
        const compositeWarnings: EngineWarning[] = [];
        const composite = this.mergeStrategy.mergeDetails(fallbackResults, {
          query,
          language: query.language ?? "ru",
          debug: this.debug,
          warnings: compositeWarnings,
        });
        const hasConflict = compositeWarnings.some((warning) =>
          ["EXTERNAL_ID_CONFLICT", "MEDIA_TYPE_CONFLICT"].includes(warning.code),
        );
        if (
          composite &&
          !hasConflict &&
          !getInvalidMetadataSnapshotReason(composite, query, false)
        ) {
          selected = {
            provider: fallbackResults.map((result) => result.provider).join("+"),
            details: composite,
          };
          warnings.push(...compositeWarnings);
        }
      }
    }

    if (!selected && successful.length === 0 && failed.length > 0) {
      throw new MediaEngineError({
        code: "PROVIDER_ERROR",
        message: "All details providers failed.",
        cause: { failed },
      });
    }

    const resolvedDetails =
      selected && route === "fallback"
        ? await resolveItemIdentity(selected.details, this.identityResolver, signal, warnings)
        : (selected?.details ?? null);
    const providers = selected
      ? (resolvedDetails?.sourceProviders?.map((source) => source.provider) ?? [selected.provider])
      : [];
    if (selected && route === "fallback") {
      warnings.push({
        code: "METADATA_FALLBACK_USED",
        message: "Returned a verified metadata snapshot from fallback providers.",
      });
    }
    const fetchedAt = new Date().toISOString();
    const response: DetailsResponse = {
      query,
      details: resolvedDetails,
      meta: createResponseMeta({
        requested: [...new Set(requested)],
        successful: [...new Set(successful)],
        failed,
        warnings,
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
        timings,
        ...(selected ? { metadata: { route, freshness: "fresh", providers, fetchedAt } } : {}),
      }),
    };

    throwIfAborted(signal);
    if (
      selected &&
      !identityResolutionFailed &&
      !hasIdentitySourceFailure(warnings) &&
      !getInvalidMetadataSnapshotReason(resolvedDetails!, query, route === "primary")
    ) {
      await this.cache?.set(cacheKey, structuredClone(response), {
        ttlMs: 5 * 60_000,
        staleTtlMs: 30 * 60_000,
      });
    }

    return response;
  }

  private callDetailsProvider(
    provider: MediaProvider,
    query: DetailsQuery,
    signal: AbortSignal,
    timeoutBudget: ProviderTimeoutBudget,
    deadline: number,
    phase: ProviderTimingMeta["phase"],
  ): Promise<ProviderDetailsCallOutcome> {
    return callTimedProviderDetails(provider, query, {
      debug: this.debug,
      language: query.language ?? "ru",
      signal,
      timeoutMs: timeoutBudget.getRemainingMs(provider.name, Math.max(0, deadline - Date.now())),
      circuitBreaker: this.circuitBreaker,
      concurrencyLimiter: this.concurrencyLimiter,
    }).then((outcome) => ({ ...outcome, timing: { ...outcome.timing, phase } }));
  }

  private async loadLegacyDetailsSnapshot(
    query: DetailsQuery,
    cacheKey: string,
    signal: AbortSignal,
    startedAt: number,
    identityResolutionFailed: boolean,
    providers: MediaProvider[],
  ): Promise<DetailsResponse> {
    const timeoutBudget = this.createProviderTimeoutBudget();
    const requested = providers.map((provider) => provider.name);
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const warnings: EngineWarning[] = [];
    const providerResults: ProviderDetailsResult[] = [];
    const timings: ProviderTimingMeta[] = [];
    const outcomes = await Promise.all(
      providers.map((provider) =>
        callTimedProviderDetails(provider, query, {
          debug: this.debug,
          language: query.language,
          signal,
          timeoutMs: timeoutBudget.getRemainingMs(provider.name),
          circuitBreaker: this.circuitBreaker,
          concurrencyLimiter: this.concurrencyLimiter,
        }),
      ),
    );

    for (const outcome of outcomes) {
      timings.push(outcome.timing);
      if (outcome.failure) failed.push(outcome.failure);
      else {
        successful.push(outcome.provider);
        if (outcome.result) providerResults.push(outcome.result);
      }
    }

    if (query.type === "anime" && query.language?.startsWith("ru")) {
      const myAnimeList = providerResults.find((result) => result.details.type === "anime")?.details
        .ids?.myAnimeList;
      if (myAnimeList && !query.ids?.myAnimeList) {
        const linkedQuery = { ...query, ids: { ...query.ids, myAnimeList } };
        const linkedProviders = this.registry
          .selectDetailsProviders(linkedQuery)
          .filter((provider) => !requested.includes(provider.name));
        requested.push(...linkedProviders.map((provider) => provider.name));
        const linkedOutcomes = await Promise.all(
          linkedProviders.map((provider) =>
            callTimedProviderDetails(provider, linkedQuery, {
              debug: this.debug,
              language: query.language,
              signal,
              timeoutMs: timeoutBudget.getRemainingMs(provider.name),
              circuitBreaker: this.circuitBreaker,
              concurrencyLimiter: this.concurrencyLimiter,
            }),
          ),
        );
        for (const outcome of linkedOutcomes) {
          timings.push(outcome.timing);
          if (outcome.failure) failed.push(outcome.failure);
          else {
            successful.push(outcome.provider);
            if (outcome.result?.details.ids?.myAnimeList === myAnimeList) {
              providerResults.push(outcome.result);
            }
          }
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
      query,
      language: query.language,
      debug: this.debug,
      warnings,
    });
    const resolvedDetails = details
      ? await resolveItemIdentity(details, this.identityResolver, signal, warnings)
      : null;
    const response: DetailsResponse = {
      query,
      details: resolvedDetails,
      meta: createResponseMeta({
        requested,
        successful,
        failed,
        warnings,
        cached: false,
        tookMs: elapsedSince(startedAt),
        debug: this.debug,
        timings,
      }),
    };

    throwIfAborted(signal);
    if (
      !identityResolutionFailed &&
      !hasRetryableProviderFailure(failed) &&
      !hasIdentitySourceFailure(warnings)
    ) {
      await this.cache?.set(cacheKey, structuredClone(response));
    }
    return response;
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
    configured?: boolean,
  ): ProviderHealthStatus {
    if (!this.circuitBreaker) {
      return {
        provider,
        kind,
        ...(configured !== undefined ? { configured } : {}),
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
      ...(configured !== undefined ? { configured } : {}),
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

function needsAnimeEpisodeIdentityValidation(
  providers: readonly StreamingProvider[],
  query: StreamQuery,
): boolean {
  if (
    query.type !== "anime" ||
    query.animeKind !== "tv" ||
    query.seasonNumber === undefined ||
    query.episodeNumber === undefined ||
    query.absoluteEpisodeNumber === undefined
  ) {
    return false;
  }

  return providers.some(
    (provider) =>
      (!query.providers || query.providers.includes(provider.name)) &&
      provider.capabilities.mediaTypes.includes("anime") &&
      provider.capabilities.animeKinds?.includes("tv") === true &&
      provider.capabilities.lookup.byEpisode &&
      provider.capabilities.lookup.byExternalIds.some((source) =>
        ["imdb", "tmdb", "kinopoisk"].includes(source),
      ),
  );
}

function removeCinemaIdentity(query: StreamQuery): StreamQuery {
  const ids = { ...query.ids };
  delete ids.imdb;
  delete ids.tmdb;
  delete ids.kinopoisk;
  return { ...query, ids };
}

async function verifyAnimeEpisodeIdentity(
  query: StreamQuery,
  resolver: IdentityResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<{ query: StreamQuery; degraded: boolean }> {
  if (!resolver || !query.ids) return { query: removeCinemaIdentity(query), degraded: true };

  const resolution = await resolver.resolve("anime", { ...query.ids }, signal);
  const ids = { ...query.ids, ...resolution.ids };
  const verifiedCinemaIds = new Set(
    resolution.provenance
      .filter(
        ({ namespace, source }) =>
          source !== "initial" && ["imdb", "tmdb", "kinopoisk"].includes(namespace),
      )
      .map(({ namespace, value }) => `${namespace}:${value}`),
  );
  let removed = false;

  for (const namespace of ["imdb", "tmdb", "kinopoisk"] as const) {
    const value = ids[namespace];
    if (value && !verifiedCinemaIds.has(`${namespace}:${value}`)) {
      delete ids[namespace];
      removed = true;
    }
  }

  return {
    query: { ...query, ids },
    degraded:
      removed ||
      resolution.diagnostics.some(({ code }) =>
        [
          "EXTERNAL_ID_CONFLICT",
          "AMBIGUOUS_ID",
          "SOURCE_ERROR",
          "SOURCE_TIMEOUT",
          "BUDGET_EXHAUSTED",
        ].includes(code),
      ),
  };
}

type AvailabilityProgressEvent =
  | {
      kind: "snapshot";
      provider: string;
      snapshot: MediaAvailabilityProgressSnapshot;
    }
  | { kind: "complete"; outcome: ProviderAvailabilityCallOutcome }
  | { kind: "error"; error: unknown };

class AvailabilityProgressEventQueue {
  private readonly events: AvailabilityProgressEvent[] = [];
  private waiter?: (event: AvailabilityProgressEvent) => void;

  push(event: AvailabilityProgressEvent): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(event);
      return;
    }

    this.events.push(event);
  }

  next(): Promise<AvailabilityProgressEvent> {
    const event = this.events.shift();
    return event
      ? Promise.resolve(event)
      : new Promise((resolve) => {
          this.waiter = resolve;
        });
  }
}

interface EngineAvailabilityProgressSnapshotContext {
  query: StreamQuery;
  providers: StreamingProvider[];
  providerResults: ReadonlyMap<string, MediaAvailability>;
  requested: string[];
  successful: ReadonlySet<string>;
  failed: ProviderFailure[];
  providerTimings: ProviderTimingMeta[];
  completedProviders: ReadonlySet<string>;
  startedAt: number;
  debug: boolean;
  identityDegraded: boolean;
  state: MediaAvailabilityProgressSnapshot["state"];
}

function createEngineAvailabilityProgressSnapshot(
  context: EngineAvailabilityProgressSnapshotContext,
): MediaAvailabilityProgressSnapshot {
  const results = context.providers.flatMap((provider) => {
    const result = context.providerResults.get(provider.name);
    return result ? [result] : [];
  });
  const availability = mergeAvailabilityResults(context.query, results);
  const hasUnknownValidation = hasUnknownStreamValidation(availability);
  const failed = context.requested.flatMap((provider) => {
    const failure = context.failed.find((candidate) => candidate.provider === provider);
    return failure ? [failure] : [];
  });
  const timings = context.requested.flatMap((provider) => {
    const timing = context.providerTimings.find((candidate) => candidate.provider === provider);
    return timing ? [timing] : [];
  });
  if (context.state === "complete") {
    availability.state = createMediaAvailabilityState(availability, {
      identityDegraded: context.identityDegraded,
      providerDegraded: failed.length > 0,
    });
  }
  availability.meta = createResponseMeta({
    requested: context.requested,
    successful: context.requested.filter((provider) => context.successful.has(provider)),
    failed,
    warnings: createAvailabilityWarnings(context.identityDegraded, hasUnknownValidation),
    cached: false,
    tookMs: elapsedSince(context.startedAt),
    debug: context.debug,
    timings,
  });

  return {
    availability,
    state: context.state,
    pendingProviders: context.providers
      .filter((provider) => !context.completedProviders.has(provider.name))
      .map((provider) => provider.name),
  };
}

function createAvailabilityWarnings(
  identityDegraded: boolean,
  validationDegraded: boolean,
): EngineWarning[] {
  const warnings: EngineWarning[] = [];
  if (identityDegraded) {
    warnings.push({
      code: "STREAM_IDENTITY_DEGRADED",
      message:
        "One or more compatible streaming providers could not be queried without a confirmed identity mapping.",
    });
  }
  if (validationDegraded) {
    warnings.push({
      code: "STREAM_VALIDATION_DEGRADED",
      message: "One or more discovered player options could not be validated reliably.",
    });
  }
  return warnings;
}

function hasRetryableProviderFailure(failures: ProviderFailure[]): boolean {
  return failures.some((failure) => failure.retryable);
}

function appendDetailsWarnings(
  response: DetailsResponse,
  additions: readonly EngineWarning[],
): DetailsResponse {
  if (additions.length === 0) return response;
  const warnings = [...(response.meta.warnings ?? [])];
  for (const warning of additions) {
    if (
      warnings.some(
        (known) =>
          known.code === warning.code &&
          known.provider === warning.provider &&
          known.message === warning.message,
      )
    )
      continue;
    warnings.push(warning);
  }
  return { ...response, meta: { ...response.meta, warnings } };
}

function createStaleDetailsResponse(response: DetailsResponse, startedAt: number): DetailsResponse {
  const stale = structuredClone(response);
  return {
    ...stale,
    meta: {
      ...stale.meta,
      cached: true,
      stale: true,
      tookMs: elapsedSince(startedAt),
      metadata: stale.meta.metadata ? { ...stale.meta.metadata, freshness: "stale" } : undefined,
      warnings: [
        ...(stale.meta.warnings ?? []),
        {
          code: "STALE_CACHE_FALLBACK",
          message: "Returned a verified stale metadata snapshot while it refreshes.",
        },
      ],
    },
  };
}

function createStaleSearchResponse(
  response: SearchResponse,
  query: SearchQuery,
  startedAt: number,
): SearchResponse {
  const stale = structuredClone(response);
  return {
    ...stale,
    query,
    meta: {
      ...stale.meta,
      cached: true,
      stale: true,
      tookMs: elapsedSince(startedAt),
      warnings: [
        ...(stale.meta.warnings ?? []),
        {
          code: "STALE_CACHE_FALLBACK",
          message: "Returned a verified stale metadata snapshot while it refreshes.",
        },
      ],
    },
  };
}

function recordDetailsOutcome(
  outcome: ProviderDetailsCallOutcome,
  successful: string[],
  failed: ProviderFailure[],
  timings: ProviderTimingMeta[],
  phase: ProviderTimingMeta["phase"],
): void {
  timings.push({ ...outcome.timing, phase });
  if (outcome.failure) {
    failed.push({
      ...outcome.failure,
      message: safeProviderFailureMessage(outcome.failure),
      phase,
    });
  } else {
    successful.push(outcome.provider);
  }
}

function safeProviderFailureMessage(failure: ProviderFailure): string {
  switch (failure.code) {
    case "PROVIDER_TIMEOUT":
      return `Provider "${failure.provider}" timed out.`;
    case "PROVIDER_RATE_LIMITED":
      return `Provider "${failure.provider}" is rate limited.`;
    case "PROVIDER_UNAUTHORIZED":
      return `Provider "${failure.provider}" is not configured or authorized.`;
    case "PROVIDER_INVALID_RESPONSE":
    case "PROVIDER_RESPONSE_TOO_LARGE":
      return `Provider "${failure.provider}" returned an invalid response.`;
    case "PROVIDER_UNAVAILABLE":
      return `Provider "${failure.provider}" is unavailable.`;
    default:
      return `Provider "${failure.provider}" failed.`;
  }
}

function getInvalidMetadataSnapshotReason(
  details: MediaDetails,
  query: DetailsQuery,
  primary: boolean,
  provider?: string,
): string | undefined {
  if (query.type && details.type !== query.type) return "media type mismatch";
  if (!details.title.trim()) return "missing localized title";
  if (!details.description?.trim()) return "missing localized description";
  if (!details.year) return "missing release year";
  if (!isHttpsImage(details.poster?.url)) return "missing safe poster";
  if (!isHttpsImage(details.backdrop?.url)) return "missing safe backdrop";
  if (!isIdentityCompatible(details, query)) return "identity mismatch";
  if (!details.sourceProviders?.length) return "missing provider provenance";
  if ((query.language ?? "ru").startsWith("ru") && provider === "anilist") {
    return "provider cannot independently satisfy Russian text requirements";
  }

  if (details.type === "anime") {
    if (!details.ids?.shikimori || !details.ids.myAnimeList) return "missing stable anime identity";
    if (!details.animeKind || details.animeKind === "unknown") return "missing anime release kind";
  } else if (primary && !details.ids?.tmdb) {
    return "missing stable TMDB identity";
  }
  return undefined;
}

function hasLocalizedTextAnchor(
  results: readonly ProviderDetailsResult[],
  query: DetailsQuery,
): boolean {
  if (!(query.language ?? "ru").startsWith("ru")) return true;
  return results.some(
    ({ provider, details }) =>
      provider !== "anilist" &&
      Boolean(details.title.trim()) &&
      Boolean(details.description?.trim()) &&
      Boolean(details.year) &&
      isIdentityCompatible(details, query),
  );
}

function isIdentityCompatible(details: MediaDetails, query: DetailsQuery): boolean {
  if (query.type && details.type !== query.type) return false;
  const expected = query.ids ?? {};
  const actual = details.ids ?? {};
  let shared = false;
  for (const key of Object.keys(expected) as Array<keyof ExternalIds>) {
    const expectedValue = expected[key];
    const actualValue = actual[key];
    if (!expectedValue || !actualValue) continue;
    if (expectedValue !== actualValue) return false;
    shared = true;
  }
  return shared;
}

function haveCompatibleIdentities(results: readonly ProviderDetailsResult[]): boolean {
  for (let index = 0; index < results.length; index += 1) {
    const left = results[index]!.details;
    for (let otherIndex = index + 1; otherIndex < results.length; otherIndex += 1) {
      const right = results[otherIndex]!.details;
      if (left.type !== right.type || haveConflictingIds(left.ids, right.ids)) return false;
    }
  }
  return true;
}

function haveConflictingIds(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  for (const key of Object.keys(left ?? {}) as Array<keyof ExternalIds>) {
    if (left?.[key] && right?.[key] && left[key] !== right[key]) return true;
  }
  return false;
}

function createInvalidMetadataFailure(
  provider: string,
  reason: string,
  phase: ProviderFailure["phase"],
): ProviderFailure {
  return {
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: false,
    message: `Provider "${provider}" returned an incomplete or conflicting metadata snapshot (${reason}).`,
    phase,
  };
}

function isHttpsImage(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizePlaybackUserAgent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : undefined;
}
