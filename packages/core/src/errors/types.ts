// Known provider error codes used for failure normalization.
// Известные коды ошибок провайдера для нормализации сбоев.
export type ProviderErrorCode =
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAUTHORIZED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE"
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
