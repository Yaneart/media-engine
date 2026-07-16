import { MediaEngineError } from "../errors/index.js";
import type { ProviderFailure, ResponseMeta } from "../response/index.js";

interface ResponseWithMeta {
  meta: ResponseMeta;
}

export interface StaleFallbackInput<T extends ResponseWithMeta> {
  stale: T | undefined;
  pending: Promise<T>;
  tookMs: () => number;
}

// Returns stale metadata only when every current provider failure is retryable.
// Возвращает устаревшие метаданные только при retryable-сбое всех текущих провайдеров.
export async function loadWithStaleFallback<T extends ResponseWithMeta>(
  input: StaleFallbackInput<T>,
): Promise<T> {
  try {
    return await input.pending;
  } catch (error) {
    const failed = getRetryableProviderFailures(error);

    if (!input.stale || !failed) {
      throw error;
    }

    const response = structuredClone(input.stale);
    response.meta = {
      providers: {
        requested: failed.map((failure) => failure.provider),
        successful: [],
        failed,
      },
      cached: true,
      stale: true,
      tookMs: input.tookMs(),
      warnings: [
        {
          code: "STALE_CACHE_FALLBACK",
          message: "Returned stale cached data because all selected providers failed retryably.",
        },
      ],
      debug: response.meta.debug
        ? {
            providers: failed.map((failure) => failure.provider),
            timings: [],
          }
        : undefined,
    };

    return response;
  }
}

function getRetryableProviderFailures(error: unknown): ProviderFailure[] | undefined {
  if (!(error instanceof MediaEngineError) || error.code !== "PROVIDER_ERROR") {
    return undefined;
  }

  const cause = error.cause as { failed?: unknown } | undefined;
  const failed = cause?.failed;

  if (!Array.isArray(failed) || failed.length === 0 || !failed.every(isRetryableProviderFailure)) {
    return undefined;
  }

  return failed;
}

function isRetryableProviderFailure(value: unknown): value is ProviderFailure {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const failure = value as Partial<ProviderFailure>;
  return (
    typeof failure.provider === "string" &&
    typeof failure.code === "string" &&
    failure.retryable === true &&
    typeof failure.message === "string"
  );
}
