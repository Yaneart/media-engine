import type { Cache } from "../cache/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { MediaProvider } from "../providers/index.js";
import type { StreamingProvider } from "../streaming/index.js";

// Tuning for per-provider transient-failure isolation.
// Настройки изоляции временных сбоев отдельных провайдеров.
export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
}

// Tuning for bounded process-local concurrency per provider.
// Настройки ограниченной process-local параллельности для каждого провайдера.
export interface ProviderConcurrencyOptions {
  defaultMaxConcurrent?: number;
  maxQueueSize?: number;
  providerLimits?: Readonly<Record<string, number>>;
}

export interface ProviderHealthStatus {
  provider: string;
  kind: "metadata" | "streaming";
  circuitState: "closed" | "open" | "half-open" | "disabled";
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureCode?: string;
  failureCounts?: {
    timeout: number;
    rateLimited: number;
    unavailable: number;
    other: number;
  };
  retryAfterMs?: number;
}

// Options accepted by the MediaEngine constructor.
// Опции, которые принимает constructor MediaEngine.
export interface MediaEngineOptions {
  providers?: MediaProvider[];
  streamingProviders?: StreamingProvider[];
  cache?: Cache;
  mergeStrategy?: MergeStrategy;
  timeoutMs?: number;
  providerTimeouts?: Readonly<Record<string, number>>;
  circuitBreaker?: CircuitBreakerOptions | false;
  providerConcurrency?: ProviderConcurrencyOptions | false;
  debug?: boolean;
}
