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
  debug?: boolean;
}
