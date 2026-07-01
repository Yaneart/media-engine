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
}

// Reads JSON through fetch and maps failures to ProviderError.
// Читает JSON через fetch и преобразует сбои в ProviderError.
export async function fetchJson<T>(options: FetchJsonOptions): Promise<T> {
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
  } catch (error) {
    throw mapProviderHttpError(options.provider, error);
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
  if (!externalSignal) {
    return timeoutSignal;
  }

  const controller = new AbortController();

  forwardAbort(externalSignal, controller);
  forwardAbort(timeoutSignal, controller);

  return controller.signal;
}

// Forwards one abort signal into another controller.
// Передает отмену одного signal в другой controller.
function forwardAbort(signal: AbortSignal, controller: AbortController): void {
  if (signal.aborted) {
    controller.abort(signal.reason);
    return;
  }

  signal.addEventListener(
    "abort",
    () => {
      controller.abort(signal.reason);
    },
    { once: true },
  );
}

// Checks whether an unknown error is an abort-style error.
// Проверяет, является ли неизвестная ошибка abort-style ошибкой.
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
