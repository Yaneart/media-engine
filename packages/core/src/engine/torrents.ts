import type { Cache, CacheSetOptions } from "../cache/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { ExternalIds } from "../media/index.js";
import type { ProviderFailure, ProviderTimingMeta } from "../response/index.js";
import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentProvider,
  TorrentProviderSource,
} from "../torrent/index.js";
import { createTorrentDiscoveryCacheKey, sortObject } from "./query.js";
import type { MediaEngineOperationOptions } from "./types.js";
import type { ProviderCircuitBreaker } from "./circuit-breaker.js";
import type { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import type { InFlightRequestCoalescer } from "./in-flight.js";
import { throwIfAborted, waitForCaller } from "./operation.js";
import { callTimedTorrentProvider } from "./provider-calls.js";
import { createResponseMeta, elapsedSince } from "./response-meta.js";
import { ProviderTimeoutBudget } from "./timeout-budget.js";

const EXPIRING_TORRENT_CACHE_SAFETY_MS = 1_000;

export interface TorrentDiscoveryOperationContext {
  query: TorrentDiscoveryQuery;
  options: MediaEngineOperationOptions;
  startedAt: number;
  providers: TorrentProvider[];
  cache?: Cache;
  debug: boolean;
  circuitBreaker?: ProviderCircuitBreaker;
  concurrencyLimiter?: ProviderConcurrencyLimiter;
  inFlightRequests: InFlightRequestCoalescer;
  getProviderTimeoutMs(providerName: string): number | undefined;
}

// Executes the complete cache/coalescing/provider lifecycle for torrent discovery.
// Выполняет полный cache/coalescing/provider lifecycle для torrent discovery.
export async function executeTorrentDiscovery(
  context: TorrentDiscoveryOperationContext,
): Promise<TorrentDiscoveryResponse> {
  const { query, options, startedAt } = context;

  if (query.limit === 0) {
    const response = mergeTorrentDiscoveryResults(query, []);
    response.meta = createResponseMeta({
      requested: [],
      successful: [],
      failed: [],
      warnings: [],
      cached: false,
      tookMs: elapsedSince(startedAt),
      debug: context.debug,
      timings: [],
    });
    return response;
  }

  const cacheKey = createTorrentDiscoveryCacheKey(query);
  const cached = await waitForCaller(
    context.cache?.get<TorrentDiscoveryResponse>(cacheKey),
    options.signal,
  );

  if (cached) {
    const response = structuredClone(cached);

    return {
      ...response,
      query,
      meta: response.meta
        ? {
            ...response.meta,
            cached: true,
            tookMs: elapsedSince(startedAt),
          }
        : undefined,
    };
  }

  const inFlight = context.inFlightRequests.forCaller(options);
  return inFlight.run(`torrents:${cacheKey}`, async (operationSignal) => {
    const timeoutBudget = new ProviderTimeoutBudget(context.getProviderTimeoutMs);
    const providers = selectTorrentProviders(context.providers, query);
    const requested = providers.map((provider) => provider.name);
    const successful: string[] = [];
    const failed: ProviderFailure[] = [];
    const providerResults: TorrentDiscoveryResponse[] = [];
    const providerTimings: ProviderTimingMeta[] = [];

    const outcomes = await Promise.all(
      providers.map((provider) =>
        callTimedTorrentProvider(provider, query, {
          debug: context.debug,
          language: query.language,
          signal: operationSignal,
          timeoutMs: timeoutBudget.getRemainingMs(provider.name),
          circuitBreaker: context.circuitBreaker,
          concurrencyLimiter: context.concurrencyLimiter,
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
        message: "All torrent providers failed.",
        cause: { failed },
      });
    }

    const response = mergeTorrentDiscoveryResults(query, providerResults);
    response.meta = createResponseMeta({
      requested,
      successful,
      failed,
      warnings: [],
      cached: false,
      tookMs: elapsedSince(startedAt),
      debug: context.debug,
      timings: providerTimings,
    });

    throwIfAborted(operationSignal);

    if (!failed.some((failure) => failure.retryable)) {
      await context.cache?.set(
        cacheKey,
        structuredClone(response),
        createTorrentCacheOptions(response),
      );
    }

    return response;
  });
}

// Selects torrent providers that can answer the normalized discovery query.
// Выбирает torrent-провайдеры, способные ответить на нормализованный discovery-запрос.
export function selectTorrentProviders(
  providers: TorrentProvider[],
  query: TorrentDiscoveryQuery,
): TorrentProvider[] {
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

// Merges torrent discovery results without hiding provider attribution.
// Объединяет torrent discovery результаты, не скрывая атрибуцию провайдеров.
export function mergeTorrentDiscoveryResults(
  query: TorrentDiscoveryQuery,
  results: TorrentDiscoveryResponse[],
): TorrentDiscoveryResponse {
  const candidates = interleaveUniqueCandidates(results);

  return {
    query,
    item: results.find((result) => result.item)?.item,
    candidates: query.limit === undefined ? candidates : candidates.slice(0, query.limit),
    sourceProviders: uniqueBy(
      results.flatMap((result) => result.sourceProviders),
      (source) => createTorrentSourceKey(source),
    ),
    checkedAt: new Date().toISOString(),
  };
}

// Interleaves configured provider results so a global limit preserves source diversity.
// Чередует результаты провайдеров, чтобы глобальный limit сохранял разнообразие источников.
function interleaveUniqueCandidates(results: TorrentDiscoveryResponse[]): TorrentCandidate[] {
  const candidates: TorrentCandidate[] = [];
  const seen = new Set<string>();
  const maximumLength = Math.max(0, ...results.map((result) => result.candidates.length));

  for (let index = 0; index < maximumLength; index += 1) {
    for (const result of results) {
      const candidate = result.candidates[index];

      if (!candidate) {
        continue;
      }

      const key = createTorrentCandidateKey(candidate);

      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

// Keeps cached handoff data from outliving its earliest advertised expiration.
// Не позволяет кешированным handoff-данным пережить ближайший заявленный срок действия.
export function createTorrentCacheOptions(
  response: TorrentDiscoveryResponse,
): CacheSetOptions | undefined {
  const expirations = response.candidates
    .map((candidate) => candidate.expiresAt)
    .filter((value): value is string => value !== undefined)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  if (expirations.length === 0) {
    return { staleTtlMs: 0 };
  }

  return {
    ttlMs: Math.max(0, Math.min(...expirations) - Date.now() - EXPIRING_TORRENT_CACHE_SAFETY_MS),
    staleTtlMs: 0,
  };
}

function hasSupportedExternalId(
  ids: ExternalIds | undefined,
  supportedSources: readonly string[],
): boolean {
  return Boolean(
    ids && supportedSources.some((source) => Boolean(ids[source as keyof ExternalIds])),
  );
}

function hasEpisodeQuery(query: TorrentDiscoveryQuery): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}

function createTorrentCandidateKey(candidate: TorrentCandidate): string {
  return `${candidate.provider}:${candidate.id}`;
}

function createTorrentSourceKey(source: TorrentProviderSource): string {
  return `${source.provider}:${source.url ?? ""}:${JSON.stringify(sortObject(source.ids ?? {}))}`;
}

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
