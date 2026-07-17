import { parseRetryAfterMs } from "./retry.js";

const DEFAULT_MAX_COOLDOWN_MS = 30_000;
const DEFAULT_RATE_LIMIT_FALLBACK_MS = 1_000;

export interface ProviderRateLimitGateOptions {
  maxCooldownMs?: number;
  now?: () => number;
}

// Shares an upstream rate-limit deadline between requests from one provider instance.
// Разделяет deadline upstream rate limit между запросами одного экземпляра provider.
export class ProviderRateLimitGate {
  readonly #maxCooldownMs: number;
  readonly #now: () => number;
  #blockedUntil = 0;

  constructor(options: ProviderRateLimitGateOptions = {}) {
    const maxCooldownMs = options.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;

    if (!Number.isFinite(maxCooldownMs) || maxCooldownMs < 0) {
      throw new RangeError("Provider rate-limit maxCooldownMs must be a non-negative number.");
    }

    this.#maxCooldownMs = maxCooldownMs;
    this.#now = options.now ?? Date.now;
  }

  // Extends the shared deadline without shortening an existing longer cooldown.
  // Продлевает общий deadline, не сокращая уже установленный более длинный cooldown.
  defer(delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs <= 0 || this.#maxCooldownMs === 0) {
      return;
    }

    const boundedDelayMs = Math.min(delayMs, this.#maxCooldownMs);
    this.#blockedUntil = Math.max(this.#blockedUntil, this.#now() + boundedDelayMs);
  }

  // Waits for the current deadline and follows extensions announced while waiting.
  // Ждет текущий deadline и учитывает продления, объявленные во время ожидания.
  async wait(signal?: AbortSignal): Promise<void> {
    while (true) {
      const remainingMs = this.#blockedUntil - this.#now();

      if (remainingMs <= 0) {
        return;
      }

      await abortableDelay(remainingMs, signal);
    }
  }
}

// Records a server rate-limit hint for raw HTTP helpers that do not use fetchJson.
// Записывает server rate-limit hint для raw HTTP helpers, не использующих fetchJson.
export function deferProviderRateLimitFromResponse(
  gate: ProviderRateLimitGate,
  response: Response,
  fallbackDelayMs = DEFAULT_RATE_LIMIT_FALLBACK_MS,
): void {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));

  if (response.status === 429) {
    gate.defer(retryAfterMs ?? fallbackDelayMs);
    return;
  }

  if (response.status >= 500 && retryAfterMs !== undefined) {
    gate.defer(retryAfterMs);
  }
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
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
