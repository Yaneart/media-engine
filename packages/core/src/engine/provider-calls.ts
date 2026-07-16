import { ProviderError, toProviderFailure } from "../errors/index.js";
import type { MediaProvider, ProviderDetailsQuery } from "../providers/index.js";
import type {
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
} from "../providers/index.js";
import type { ProviderFailure, ProviderTimingMeta } from "../response/index.js";
import type { MediaAvailability, StreamQuery, StreamingProvider } from "../streaming/index.js";
import type { ProviderCircuitBreaker } from "./circuit-breaker.js";
import { createProviderSearchQuery } from "./query.js";
import { elapsedSince } from "./response-meta.js";

// Context passed to a single provider call.
// Контекст, передаваемый в один вызов провайдера.
export interface ProviderCallContext {
  debug: boolean;
  language?: string;
  timeoutMs?: number;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
}

export interface SearchRetryContext {
  debug: boolean;
  language?: string;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  getTimeoutMs(providerName: string): number | undefined;
}

// Result of one provider search call after timing and failure normalization.
// Результат одного search-вызова провайдера после замера времени и нормализации ошибок.
export interface ProviderSearchCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  results: ProviderSearchResult[];
  failure?: ProviderFailure;
}

// Result of one provider details call after timing and failure normalization.
// Результат одного details-вызова провайдера после замера времени и нормализации ошибок.
export interface ProviderDetailsCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  result: ProviderDetailsResult | null;
  failure?: ProviderFailure;
}

// Result of one streaming provider call after timing and failure normalization.
// Результат одного streaming-вызова провайдера после замера времени и нормализации ошибок.
export interface ProviderAvailabilityCallOutcome {
  provider: string;
  timing: ProviderTimingMeta;
  result: MediaAvailability | null;
  failure?: ProviderFailure;
}

// Retries only transient failures when every selected search provider failed together.
// Повторяет только временные ошибки, когда одновременно упали все выбранные search-провайдеры.
export async function retryFailedSearchProviders(
  providers: MediaProvider[],
  outcomes: ProviderSearchCallOutcome[],
  query: ProviderSearchQuery,
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
        circuitBreaker: context.circuitBreaker,
      });
    }),
  );
}

// Calls one search provider and returns normalized timing/failure metadata.
// Вызывает один search-провайдер и возвращает нормализованные timing/failure метаданные.
export async function callTimedProviderSearch(
  provider: MediaProvider,
  query: ProviderSearchQuery,
  context: ProviderCallContext,
): Promise<ProviderSearchCallOutcome> {
  const startedAt = Date.now();

  try {
    const results = await runWithCircuitBreaker(
      context,
      `metadata:${provider.name}`,
      provider.name,
      () => callProviderSearch(provider, query, context),
    );

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
export async function callTimedProviderDetails(
  provider: MediaProvider,
  query: ProviderDetailsQuery,
  context: ProviderCallContext,
): Promise<ProviderDetailsCallOutcome> {
  const startedAt = Date.now();

  try {
    const result = await runWithCircuitBreaker(
      context,
      `metadata:${provider.name}`,
      provider.name,
      () => callProviderDetails(provider, query, context),
    );

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
export async function callTimedProviderAvailability(
  provider: StreamingProvider,
  query: StreamQuery,
  context: ProviderCallContext,
): Promise<ProviderAvailabilityCallOutcome> {
  const startedAt = Date.now();

  try {
    const result = await runWithCircuitBreaker(
      context,
      `streaming:${provider.name}`,
      provider.name,
      () => callProviderAvailability(provider, query, context),
    );

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

function runWithCircuitBreaker<T>(
  context: ProviderCallContext,
  key: string,
  provider: string,
  operation: () => Promise<T>,
): Promise<T> {
  return context.circuitBreaker
    ? context.circuitBreaker.run(key, provider, operation)
    : operation();
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
    const timeoutError = new ProviderError({
      provider: providerName,
      code: "PROVIDER_TIMEOUT",
      message: `Provider "${providerName}" timed out.`,
      retryable: true,
    });

    if (context.timeoutMs !== undefined && context.timeoutMs <= 0) {
      controller.abort(timeoutError);
      throw timeoutError;
    }

    const providerPromise = run(controller);

    if (context.timeoutMs === undefined) {
      return await providerPromise;
    }

    const timeoutPromise = new Promise<T>((_, reject) => {
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
