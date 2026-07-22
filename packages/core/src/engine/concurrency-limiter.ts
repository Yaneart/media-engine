import { ProviderError } from "../errors/index.js";
import type { ProviderConcurrencyOptions } from "./types.js";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUE_SIZE = 100;
const MAX_CONCURRENT_BOUND = 100;
const MAX_QUEUE_SIZE_BOUND = 10_000;

interface QueueEntry<T> {
  provider: string;
  operation: () => Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface ProviderQueue {
  active: number;
  waiting: QueueEntry<unknown>[];
}

// Bounds concurrent work independently for every metadata, streaming, or torrent provider.
// Ограничивает параллельную работу отдельно для metadata, streaming и torrent-провайдеров.
export class ProviderConcurrencyLimiter {
  private readonly defaultMaxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly providerLimits: ReadonlyMap<string, number>;
  private readonly queues = new Map<string, ProviderQueue>();

  constructor(options: ProviderConcurrencyOptions = {}) {
    this.defaultMaxConcurrent = validateBoundedInteger(
      options.defaultMaxConcurrent,
      DEFAULT_MAX_CONCURRENT,
      1,
      MAX_CONCURRENT_BOUND,
      "defaultMaxConcurrent",
    );
    this.maxQueueSize = validateBoundedInteger(
      options.maxQueueSize,
      DEFAULT_MAX_QUEUE_SIZE,
      0,
      MAX_QUEUE_SIZE_BOUND,
      "maxQueueSize",
    );
    this.providerLimits = new Map(
      Object.entries(options.providerLimits ?? {}).map(([provider, limit]) => [
        validateProviderName(provider),
        validateBoundedInteger(
          limit,
          this.defaultMaxConcurrent,
          1,
          MAX_CONCURRENT_BOUND,
          `providerLimits.${provider}`,
        ),
      ]),
    );
  }

  run<T>(
    key: string,
    provider: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    const queue = this.getQueue(key);
    const limit = this.providerLimits.get(provider) ?? this.defaultMaxConcurrent;

    if (queue.active < limit) {
      return this.execute(key, queue, provider, operation);
    }

    if (queue.waiting.length >= this.maxQueueSize) {
      return Promise.reject(createSaturatedError(provider));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { provider, operation, resolve, reject, signal };

      if (signal) {
        entry.onAbort = () => {
          const index = queue.waiting.indexOf(entry as QueueEntry<unknown>);

          if (index !== -1) {
            queue.waiting.splice(index, 1);
            reject(signal.reason);
            this.deleteIdleQueue(key, queue);
          }
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }

      queue.waiting.push(entry as QueueEntry<unknown>);
    });
  }

  private getQueue(key: string): ProviderQueue {
    const existing = this.queues.get(key);

    if (existing) {
      return existing;
    }

    const queue: ProviderQueue = { active: 0, waiting: [] };
    this.queues.set(key, queue);
    return queue;
  }

  private async execute<T>(
    key: string,
    queue: ProviderQueue,
    provider: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    queue.active += 1;

    try {
      return await operation();
    } finally {
      queue.active -= 1;
      this.drain(key, queue, provider);
    }
  }

  private drain(key: string, queue: ProviderQueue, provider: string): void {
    const limit = this.providerLimits.get(provider) ?? this.defaultMaxConcurrent;

    while (queue.active < limit) {
      const next = queue.waiting.shift();

      if (!next) {
        break;
      }

      if (next.onAbort && next.signal) {
        next.signal.removeEventListener("abort", next.onAbort);
      }

      void this.execute(key, queue, next.provider, next.operation).then(next.resolve, next.reject);
    }

    this.deleteIdleQueue(key, queue);
  }

  private deleteIdleQueue(key: string, queue: ProviderQueue): void {
    if (queue.active === 0 && queue.waiting.length === 0) {
      this.queues.delete(key);
    }
  }
}

function createSaturatedError(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_UNAVAILABLE",
    message: `Provider "${provider}" concurrency queue is full.`,
    retryable: true,
  });
}

function validateProviderName(provider: string): string {
  if (!provider || provider.trim() !== provider) {
    throw new TypeError("Provider concurrency override names must be non-empty and unpadded.");
  }

  return provider;
}

function validateBoundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const normalized = value ?? fallback;

  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new TypeError(
      `Provider concurrency ${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return normalized;
}
