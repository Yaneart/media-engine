import type { Cache, CacheSetOptions } from "./types.js";

// Options used to construct a memory cache instance.
// Опции для создания экземпляра memory cache.
export interface MemoryCacheOptions {
  now?: () => number;
  defaultTtlMs?: number;
  maxEntries?: number;
}

// Internal memory cache entry with optional expiration timestamp.
// Внутренняя запись memory cache с опциональным временем истечения.
interface MemoryCacheEntry<T> {
  value: T;
  expiresAt?: number;
}

// Simple synchronous in-memory cache with optional TTL support.
// Простой синхронный in-memory cache с опциональной поддержкой TTL.
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, MemoryCacheEntry<unknown>>();
  private readonly now: () => number;
  private readonly defaultTtlMs?: number;
  private readonly maxEntries?: number;

  constructor(options: MemoryCacheOptions = {}) {
    if (
      options.maxEntries !== undefined &&
      (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0)
    ) {
      throw new TypeError("MemoryCache maxEntries must be a positive integer.");
    }

    this.now = options.now ?? Date.now;
    this.defaultTtlMs = options.defaultTtlMs;
    this.maxEntries = options.maxEntries;
  }

  // Reads a cached value and removes it when it has expired.
  // Читает значение из cache и удаляет его, если срок истек.
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    if (this.maxEntries !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }

    return entry.value as T;
  }

  // Stores a value with an optional TTL in milliseconds.
  // Сохраняет значение с опциональным TTL в миллисекундах.
  set<T>(key: string, value: T, options: CacheSetOptions = {}): void {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const expiresAt = ttlMs === undefined || ttlMs < 0 ? undefined : this.now() + ttlMs;

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    this.evictOverflow();
  }

  // Removes one cache entry by key.
  // Удаляет одну запись cache по ключу.
  delete(key: string): void {
    this.entries.delete(key);
  }

  // Removes all cache entries.
  // Удаляет все записи cache.
  clear(): void {
    this.entries.clear();
  }

  // Checks whether one cache entry is expired at the current time.
  // Проверяет, истекла ли одна запись cache к текущему времени.
  private isExpired(entry: MemoryCacheEntry<unknown>): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.now();
  }

  // Evicts expired entries first, then least-recently-used entries until the bound is met.
  // Сначала удаляет истекшие записи, затем давно не использованные до соблюдения лимита.
  private evictOverflow(): void {
    if (this.maxEntries === undefined || this.entries.size <= this.maxEntries) {
      return;
    }

    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;

      if (oldestKey === undefined) {
        break;
      }

      this.entries.delete(oldestKey);
    }
  }
}
