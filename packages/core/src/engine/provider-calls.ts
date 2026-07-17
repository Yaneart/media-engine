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
import type { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import { createProviderSearchQuery } from "./query.js";
import { elapsedSince } from "./response-meta.js";

// Context passed to a single provider call.
// Контекст, передаваемый в один вызов провайдера.
export interface ProviderCallContext {
  debug: boolean;
  language?: string;
  timeoutMs?: number;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  concurrencyLimiter?: ProviderConcurrencyLimiter | undefined;
}

export interface SearchRetryContext {
  debug: boolean;
  language?: string;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  concurrencyLimiter?: ProviderConcurrencyLimiter | undefined;
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
        concurrencyLimiter: context.concurrencyLimiter,
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
    const results = await runProviderOperation(
      context,
      `metadata:${provider.name}`,
      provider.name,
      (signal) =>
        provider.search(query, {
          signal,
          timeoutMs: context.timeoutMs,
          debug: context.debug,
          language: context.language,
        }),
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
    const result = await runProviderOperation(
      context,
      `metadata:${provider.name}`,
      provider.name,
      (signal) =>
        provider.getDetails
          ? provider.getDetails(query, {
              signal,
              timeoutMs: context.timeoutMs,
              debug: context.debug,
              language: context.language,
            })
          : Promise.resolve(null),
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
    const result = await runProviderOperation(
      context,
      `streaming:${provider.name}`,
      provider.name,
      (signal) =>
        provider.getAvailability(query, {
          signal,
          timeoutMs: context.timeoutMs,
          debug: context.debug,
          language: context.language,
        }),
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

function runProviderOperation<T>(
  context: ProviderCallContext,
  key: string,
  provider: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return withProviderTimeout(provider, context, (controller) => {
    const start = () => {
      let providerPromise: Promise<T> | undefined;
      const observe = () => {
        const running = Promise.resolve().then(() => operation(controller.signal));
        providerPromise = running;
        return runUntilAborted(controller.signal, () => running);
      };
      const resultPromise = context.circuitBreaker
        ? context.circuitBreaker.run(key, provider, observe)
        : observe();

      return { providerPromise, resultPromise };
    };

    if (!context.concurrencyLimiter) {
      return start().resultPromise;
    }

    return context.concurrencyLimiter.run(key, provider, controller.signal, () => {
      const started = start();
      return started.providerPromise
        ? holdProviderSlotUntilSettled(started.providerPromise, started.resultPromise)
        : started.resultPromise;
    });
  });
}

// Keeps the concurrency slot while aborted provider code finishes unwinding.
// Удерживает concurrency-слот, пока отмененный provider завершает фактическую работу.
async function holdProviderSlotUntilSettled<T>(
  providerPromise: Promise<T>,
  resultPromise: Promise<T>,
): Promise<T> {
  try {
    const result = await resultPromise;
    await providerPromise.catch(() => undefined);
    return result;
  } catch (error) {
    await providerPromise.catch(() => undefined);
    throw error;
  }
}

// Makes caller timeout visible to the circuit breaker even if provider code ignores abort.
// Делает timeout вызывающей стороны видимым circuit breaker, даже если провайдер игнорирует abort.
function runUntilAborted<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
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
