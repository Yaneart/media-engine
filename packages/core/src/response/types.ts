// Public provider failure summary included in response metadata.
export interface ProviderFailure {
  provider: string;
  code: string;
  message: string;
}

// Provider execution summary for one engine request.
export interface ProviderExecutionMeta {
  requested: string[];
  successful: string[];
  failed: ProviderFailure[];
}

// Non-fatal engine warning returned with a response.
export interface EngineWarning {
  code: string;
  message: string;
  provider?: string;
}

// Shared metadata returned with search and details responses.
export interface ResponseMeta {
  providers: ProviderExecutionMeta;
  cached: boolean;
  tookMs: number;
  warnings?: EngineWarning[];
  debug?: unknown;
}
