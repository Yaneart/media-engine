import { ProviderError } from "../errors/index.js";
import type { CircuitBreakerOptions } from "./types.js";

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_TIMEOUT_MS = 30_000;

interface CircuitState {
  failures: number;
  openedAt?: number;
  probeInFlight: boolean;
}

// Tracks transient provider failures and allows one recovery probe after cooldown.
// Отслеживает временные сбои провайдера и разрешает одну пробу после cooldown.
export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, CircuitState>();

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

    try {
      const result = await operation();
      this.states.delete(key);
      return result;
    } catch (error) {
      this.recordFailure(key, error);
      throw error;
    }
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
