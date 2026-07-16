export interface RetryDelayOptions {
  baseDelayMs: number;
  attempt: number;
  maxDelayMs: number;
  jitterRatio: number;
  randomValue: number;
  retryAfterMs?: number;
}

// Parses the HTTP Retry-After header as delta-seconds or an HTTP date.
// Парсит HTTP-заголовок Retry-After как секунды или HTTP-дату.
export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const milliseconds = Number(normalized) * 1_000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : undefined;
}

// Calculates exponential backoff with bounded jitter and an optional server hint.
// Считает экспоненциальный backoff с ограниченным jitter и подсказкой сервера.
export function calculateRetryDelayMs(options: RetryDelayOptions): number {
  const baseDelayMs = Math.max(0, options.baseDelayMs);
  const maxDelayMs = Math.max(0, options.maxDelayMs);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio));
  const randomValue = Math.min(1, Math.max(0, options.randomValue));
  const exponentialDelay = baseDelayMs * 2 ** Math.max(0, options.attempt);
  const jitterFactor = 1 + (randomValue * 2 - 1) * jitterRatio;
  const adaptiveDelay = exponentialDelay * jitterFactor;
  const requestedDelay = Math.max(adaptiveDelay, options.retryAfterMs ?? 0);

  return Math.round(Math.min(maxDelayMs, requestedDelay));
}
