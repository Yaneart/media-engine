import { ProviderError, type ProviderErrorCode } from "@media-engine/core";
import type { ProviderContext } from "@media-engine/core";

// Minimal fetch function shape used by provider HTTP utilities.
// Минимальная форма fetch-функции для provider HTTP utilities.
export type ProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

// Options used for a provider JSON HTTP request.
// Опции для JSON HTTP-запроса провайдера.
export interface FetchJsonOptions {
  provider: string;
  url: string | URL;
  init?: RequestInit;
  context?: ProviderContext;
  fetch?: ProviderFetch;
  maxRetries?: number;
  retryDelayMs?: number;
}

// Reads JSON through fetch and maps failures to ProviderError.
// Читает JSON через fetch и преобразует сбои в ProviderError.
export async function fetchJson<T>(options: FetchJsonOptions): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 150;
  const timeout = createProviderTimeout(options.provider, options.context);
  const signal = mergeAbortSignals(options.context?.signal, timeout.controller.signal);
  const boundedOptions: FetchJsonOptions = {
    ...options,
    context: {
      ...options.context,
      signal,
      timeoutMs: undefined,
    },
  };
  let attempt = 0;
  let lastError: ProviderError | undefined;

  try {
    while (attempt <= maxRetries) {
      try {
        return await fetchJsonAttempt<T>(boundedOptions);
      } catch (error) {
        const providerError = mapProviderHttpError(options.provider, error);

        lastError = providerError;

        if (!providerError.retryable || attempt >= maxRetries) {
          throw providerError;
        }

        await delay(getRetryDelayMs(retryDelayMs, attempt), signal);
        attempt += 1;
      }
    }
  } finally {
    timeout.clear();
  }

  throw lastError;
}

// Runs one JSON HTTP attempt with a fresh timeout signal.
// Выполняет одну попытку JSON HTTP с новым timeout signal.
async function fetchJsonAttempt<T>(options: FetchJsonOptions): Promise<T> {
  const fetchImpl = options.fetch ?? fetch;
  const timeout = createProviderTimeout(options.provider, options.context);
  const signal = mergeAbortSignals(options.context?.signal, timeout.controller.signal);

  try {
    const response = await fetchImpl(options.url, {
      ...options.init,
      signal,
    });

    if (!response.ok) {
      throw createHttpProviderError(options.provider, response.status);
    }

    return await parseJsonResponse<T>(options.provider, response);
  } finally {
    timeout.clear();
  }
}

// Parses response JSON and maps invalid bodies to ProviderError.
// Парсит JSON ответа и преобразует невалидное тело в ProviderError.
export async function parseJsonResponse<T>(provider: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError({
      provider,
      code: "PROVIDER_INVALID_RESPONSE",
      message: `Provider "${provider}" returned invalid JSON.`,
      retryable: false,
      cause: error,
    });
  }
}

// Maps HTTP/network/abort failures into ProviderError.
// Преобразует HTTP/network/abort сбои в ProviderError.
export function mapProviderHttpError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (isAbortError(error)) {
    return new ProviderError({
      provider,
      code: "PROVIDER_TIMEOUT",
      message: `Provider "${provider}" request timed out.`,
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ProviderError({
      provider,
      code: "PROVIDER_UNAVAILABLE",
      message: error.message,
      retryable: true,
      cause: error,
    });
  }

  return new ProviderError({
    provider,
    code: "PROVIDER_ERROR",
    message: `Provider "${provider}" request failed.`,
    retryable: false,
    cause: error,
  });
}

// Maps HTTP status codes into provider error categories.
// Преобразует HTTP status code в категории provider error.
export function mapHttpStatusToProviderErrorCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) {
    return "PROVIDER_UNAUTHORIZED";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMITED";
  }

  if (status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }

  return "PROVIDER_ERROR";
}

// Creates a ProviderError from an HTTP response status.
// Создает ProviderError из HTTP status ответа.
function createHttpProviderError(provider: string, status: number): ProviderError {
  const code = mapHttpStatusToProviderErrorCode(status);

  return new ProviderError({
    provider,
    code,
    message: `Provider "${provider}" returned HTTP ${status}.`,
    retryable: code === "PROVIDER_RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE",
  });
}

// Creates a timeout controller for provider HTTP calls.
// Создает timeout controller для HTTP-вызовов провайдера.
function createProviderTimeout(
  provider: string,
  context: ProviderContext | undefined,
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutMs = context?.timeoutMs;

  if (timeoutMs === undefined) {
    return {
      controller,
      clear() {
        return;
      },
    };
  }

  const timeoutError = new ProviderError({
    provider,
    code: "PROVIDER_TIMEOUT",
    message: `Provider "${provider}" request timed out.`,
    retryable: true,
  });

  if (timeoutMs <= 0) {
    controller.abort(timeoutError);
    return {
      controller,
      clear() {
        return;
      },
    };
  }

  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  return {
    controller,
    clear() {
      clearTimeout(timeout);
    },
  };
}

// Merges external abort signal with utility timeout signal.
// Объединяет внешний abort signal с timeout signal utility.
function mergeAbortSignals(
  externalSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

// Checks whether an unknown error is an abort-style error.
// Проверяет, является ли неизвестная ошибка abort-style ошибкой.
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

// Calculates a small linear backoff for provider retries.
// Считает небольшой линейный backoff для provider retry.
function getRetryDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.max(0, baseDelayMs * (attempt + 1));
}

// Waits before the next provider retry.
// Ждет перед следующей provider retry.
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
