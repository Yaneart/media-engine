// Public provider failure summary included in response metadata.
// Публичное описание ошибки провайдера в метаданных ответа.
export interface ProviderFailure {
  provider: string;
  code: string;
  retryable: boolean;
  message: string;
}

// Provider execution summary for one engine request.
// Сводка выполнения провайдеров для одного запроса движка.
export interface ProviderExecutionMeta {
  requested: string[];
  successful: string[];
  failed: ProviderFailure[];
}

// Runtime timing for one provider call, exposed only in debug metadata.
// Время выполнения одного вызова провайдера, доступное только в debug-метаданных.
export interface ProviderTimingMeta {
  provider: string;
  status: "success" | "failed";
  tookMs: number;
}

// Non-fatal engine warning returned with a response.
// Некритичное предупреждение движка, возвращаемое вместе с ответом.
export interface EngineWarning {
  code: string;
  message: string;
  provider?: string;
}

// Extra diagnostics returned when the engine is created with debug enabled.
// Дополнительная диагностика, возвращаемая при включенном debug у движка.
export interface ResponseDebugMeta {
  providers: string[];
  timings: ProviderTimingMeta[];
}

// Shared metadata returned with search and details responses.
// Общие метаданные, возвращаемые с ответами поиска и деталей.
export interface ResponseMeta {
  providers: ProviderExecutionMeta;
  cached: boolean;
  tookMs: number;
  warnings?: EngineWarning[];
  debug?: ResponseDebugMeta;
}
