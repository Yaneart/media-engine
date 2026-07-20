import { ProviderError, type ProviderErrorCode } from "@media-engine/core";
import type { ProviderContext } from "@media-engine/core";
import type { ProviderRateLimitGate } from "./rate-limit.js";
import { readBoundedResponseText } from "./response-body.js";
import { calculateRetryDelayMs, parseRetryAfterMs } from "./retry.js";

const DEFAULT_MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;

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
  maxRetryDelayMs?: number;
  retryJitterRatio?: number;
  maxResponseBytes?: number;
  rateLimitGate?: ProviderRateLimitGate;
}

// Reads JSON through fetch and maps failures to ProviderError.
// Читает JSON через fetch и преобразует сбои в ProviderError.
export async function fetchJson<T>(options: FetchJsonOptions): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 150;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 2_000;
  const retryJitterRatio = options.retryJitterRatio ?? 0.2;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_JSON_RESPONSE_BYTES;

  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError("fetchJson maxResponseBytes must be a positive safe integer.");
  }

  const timeout = createProviderTimeout(options.provider, options.context);
  const signal = mergeAbortSignals(options.context?.signal, timeout.controller.signal);
  const boundedOptions: FetchJsonOptions = {
    ...options,
    maxResponseBytes,
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
        await options.rateLimitGate?.wait(signal);
        return await fetchJsonAttempt<T>(boundedOptions);
      } catch (error) {
        const providerError = mapProviderHttpError(options.provider, error);
        const retryDelay = calculateRetryDelayMs({
          baseDelayMs: retryDelayMs,
          attempt,
          maxDelayMs: maxRetryDelayMs,
          jitterRatio: retryJitterRatio,
          randomValue: Math.random(),
          retryAfterMs: getRetryAfterMs(providerError),
        });

        lastError = providerError;
        deferSharedRateLimit(options.rateLimitGate, providerError, retryDelay);

        if (!providerError.retryable || attempt >= maxRetries) {
          throw providerError;
        }

        await delay(retryDelay, signal);
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
      throw mapHttpResponseToProviderError(options.provider, response);
    }

    return await parseJsonResponse<T>(
      options.provider,
      response,
      options.maxResponseBytes ?? DEFAULT_MAX_JSON_RESPONSE_BYTES,
      signal,
    );
  } finally {
    timeout.clear();
  }
}

// Parses response JSON and maps invalid bodies to ProviderError.
// Парсит JSON ответа и преобразует невалидное тело в ProviderError.
export async function parseJsonResponse<T>(
  provider: string,
  response: Response,
  maxResponseBytes = DEFAULT_MAX_JSON_RESPONSE_BYTES,
  signal?: AbortSignal,
): Promise<T> {
  const text = await readBoundedResponseText(provider, response, maxResponseBytes, { signal });

  try {
    return JSON.parse(text) as T;
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
export function mapHttpResponseToProviderError(
  provider: string,
  response: Response,
): ProviderError {
  const status = response.status;
  const code = mapHttpStatusToProviderErrorCode(status);

  return new HttpProviderError({
    provider,
    code,
    message: `Provider "${provider}" returned HTTP ${status}.`,
    retryable: code === "PROVIDER_RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE",
    status,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  });
}

// Returns the HTTP status retained by errors created from provider responses.
// Возвращает HTTP status, сохраненный в ошибках из provider response.
export function getProviderHttpStatus(error: unknown): number | undefined {
  return error instanceof HttpProviderError ? error.status : undefined;
}

interface HttpProviderErrorOptions {
  provider: string;
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  status: number;
  retryAfterMs?: number;
}

class HttpProviderError extends ProviderError {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(options: HttpProviderErrorOptions) {
    super(options);
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function getRetryAfterMs(error: ProviderError): number | undefined {
  return error instanceof HttpProviderError ? error.retryAfterMs : undefined;
}

function deferSharedRateLimit(
  gate: ProviderRateLimitGate | undefined,
  error: ProviderError,
  fallbackDelayMs: number,
): void {
  if (!gate || !(error instanceof HttpProviderError)) {
    return;
  }

  if (error.code === "PROVIDER_RATE_LIMITED") {
    gate.defer(error.retryAfterMs ?? fallbackDelayMs);
    return;
  }

  if (error.retryAfterMs !== undefined) {
    gate.defer(error.retryAfterMs);
  }
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
