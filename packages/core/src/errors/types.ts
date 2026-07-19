import type { ProviderFailure } from "../response/types.js";

// Known engine error codes used for predictable public failures.
// Известные коды ошибок движка для предсказуемых публичных сбоев.
export type ErrorCode = "INVALID_QUERY" | "PROVIDER_ERROR" | "UNKNOWN_ERROR";

// Known provider error codes used for failure normalization.
// Известные коды ошибок провайдера для нормализации сбоев.
export type ProviderErrorCode =
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAUTHORIZED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_NOT_SUPPORTED";

// Options used to construct a provider error.
// Параметры для создания ошибки провайдера.
export interface ProviderErrorOptions {
  provider: string;
  code: ProviderErrorCode;
  message: string;
  retryable?: boolean;
  cause?: unknown;
}

// Options used to construct an engine error.
// Параметры для создания ошибки движка.
export interface MediaEngineErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: unknown;
}

// Error thrown by the engine for predictable core-level failures.
// Ошибка движка для предсказуемых сбоев на уровне core.
export class MediaEngineError extends Error {
  readonly code: ErrorCode;

  constructor(options: MediaEngineErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = "MediaEngineError";
    this.code = options.code;
  }
}

// Error thrown by metadata providers before the engine maps it to response metadata.
// Ошибка metadata-провайдера до преобразования движком в метаданные ответа.
export class ProviderError extends Error {
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(options: ProviderErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = "ProviderError";
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

// Converts unknown thrown values into a predictable engine error.
// Преобразует неизвестные выброшенные значения в предсказуемую ошибку движка.
export function toMediaEngineError(error: unknown): MediaEngineError {
  if (error instanceof MediaEngineError) {
    return error;
  }

  if (error instanceof ProviderError) {
    return new MediaEngineError({
      code: "PROVIDER_ERROR",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new MediaEngineError({
      code: "UNKNOWN_ERROR",
      message: error.message,
      cause: error,
    });
  }

  return new MediaEngineError({
    code: "UNKNOWN_ERROR",
    message: "Unknown error",
    cause: error,
  });
}

// Converts unknown provider failures into public response metadata.
// Преобразует неизвестные сбои провайдера в публичные метаданные ответа.
export function toProviderFailure(provider: string, error: unknown): ProviderFailure {
  if (error instanceof ProviderError) {
    return {
      provider: error.provider,
      code: error.code,
      retryable: error.retryable,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      provider,
      code: "PROVIDER_ERROR",
      retryable: false,
      message: error.message,
    };
  }

  return {
    provider,
    code: "PROVIDER_ERROR",
    retryable: false,
    message: "Unknown provider error",
  };
}
