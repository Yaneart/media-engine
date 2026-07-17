import { ProviderError } from "../errors/index.js";
import type { CircuitBreakerOptions } from "./types.js";

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_TIMEOUT_MS = 30_000;

interface CircuitState {
  failures: number;
  openedAt?: number;
  probeInFlight: boolean;
}

interface ProviderObservation {
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastFailureCode?: string;
  failureCounts: ProviderFailureCounts;
}

interface ProviderFailureCounts {
  timeout: number;
  rateLimited: number;
  unavailable: number;
  other: number;
}

export interface CircuitBreakerSnapshot {
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastFailureCode?: string;
  failureCounts: ProviderFailureCounts;
  retryAfterMs?: number;
}

// Tracks transient provider failures and allows one recovery probe after cooldown.
// Отслеживает временные сбои провайдера и разрешает одну пробу после cooldown.
export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, CircuitState>();
  private readonly observations = new Map<string, ProviderObservation>();

  constructor(options: CircuitBreakerOptions = {}, now: () => number = Date.now) {
    this.failureThreshold = validatePositiveInteger(
      options.failureThreshold,
      DEFAULT_FAILURE_THRESHOLD,
      "failureThreshold",
    );
    this.recoveryTimeoutMs = validateNonNegativeInteger(
      options.recoveryTimeoutMs,
      DEFAULT_RECOVERY_TIMEOUT_MS,
      "recoveryTimeoutMs",
    );
    this.now = now;
  }

  async run<T>(key: string, provider: string, operation: () => Promise<T>): Promise<T> {
    this.acquire(key, provider);
    this.recordRequest(key);

    try {
      const result = await operation();
      this.states.delete(key);
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key, error);
      this.recordObservedFailure(key, error);
      throw error;
    }
  }

  getSnapshot(key: string): CircuitBreakerSnapshot {
    const now = this.now();
    const state = this.states.get(key);
    const observation = this.observations.get(key);
    const circuitState = state?.probeInFlight
      ? "half-open"
      : state?.openedAt !== undefined
        ? "open"
        : "closed";
    const retryAfterMs =
      state?.openedAt === undefined
        ? undefined
        : Math.max(0, this.recoveryTimeoutMs - (now - state.openedAt));

    return {
      state: circuitState,
      consecutiveFailures: state?.failures ?? 0,
      totalRequests: observation?.totalRequests ?? 0,
      totalSuccesses: observation?.totalSuccesses ?? 0,
      totalFailures: observation?.totalFailures ?? 0,
      lastSuccessAt: observation?.lastSuccessAt,
      lastFailureAt: observation?.lastFailureAt,
      lastFailureCode: observation?.lastFailureCode,
      failureCounts: observation?.failureCounts ?? createEmptyFailureCounts(),
      retryAfterMs,
    };
  }

  private acquire(key: string, provider: string): void {
    const state = this.states.get(key);

    if (state?.openedAt === undefined) {
      return;
    }

    if (this.now() - state.openedAt < this.recoveryTimeoutMs || state.probeInFlight) {
      throw createOpenCircuitError(provider);
    }

    state.probeInFlight = true;
  }

  private recordFailure(key: string, error: unknown): void {
    const state = this.states.get(key);

    if (!(error instanceof ProviderError) || !error.retryable) {
      this.states.delete(key);
      return;
    }

    if (state?.probeInFlight) {
      this.states.set(key, {
        failures: this.failureThreshold,
        openedAt: this.now(),
        probeInFlight: false,
      });
      return;
    }

    const failures = (state?.failures ?? 0) + 1;
    this.states.set(key, {
      failures,
      openedAt: failures >= this.failureThreshold ? this.now() : undefined,
      probeInFlight: false,
    });
  }

  private recordRequest(key: string): void {
    const observation = this.getObservation(key);
    observation.totalRequests += 1;
  }

  private recordSuccess(key: string): void {
    const observation = this.getObservation(key);
    observation.totalSuccesses += 1;
    observation.lastSuccessAt = this.now();
  }

  private recordObservedFailure(key: string, error: unknown): void {
    const observation = this.getObservation(key);
    observation.totalFailures += 1;
    observation.lastFailureAt = this.now();
    observation.lastFailureCode = error instanceof ProviderError ? error.code : "PROVIDER_ERROR";

    if (!(error instanceof ProviderError)) {
      observation.failureCounts.other += 1;
    } else if (error.code === "PROVIDER_TIMEOUT") {
      observation.failureCounts.timeout += 1;
    } else if (error.code === "PROVIDER_RATE_LIMITED") {
      observation.failureCounts.rateLimited += 1;
    } else if (error.code === "PROVIDER_UNAVAILABLE") {
      observation.failureCounts.unavailable += 1;
    } else {
      observation.failureCounts.other += 1;
    }
  }

  private getObservation(key: string): ProviderObservation {
    const existing = this.observations.get(key);

    if (existing) {
      return existing;
    }

    const observation: ProviderObservation = {
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      failureCounts: createEmptyFailureCounts(),
    };
    this.observations.set(key, observation);
    return observation;
  }
}

function createEmptyFailureCounts(): ProviderFailureCounts {
  return {
    timeout: 0,
    rateLimited: 0,
    unavailable: 0,
    other: 0,
  };
}

function createOpenCircuitError(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_UNAVAILABLE",
    message: `Provider "${provider}" circuit is open after repeated failures.`,
    retryable: true,
  });
}

function validatePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const normalized = value ?? fallback;

  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`Circuit breaker ${name} must be a positive integer.`);
  }

  return normalized;
}

function validateNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const normalized = value ?? fallback;

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`Circuit breaker ${name} must be a non-negative integer.`);
  }

  return normalized;
}
