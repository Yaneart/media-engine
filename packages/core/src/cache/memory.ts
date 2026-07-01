import type { Cache, CacheSetOptions } from "./types.js";

// Options used to construct a memory cache instance.
// Опции для создания экземпляра memory cache.
export interface MemoryCacheOptions {
  now?: () => number;
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

  constructor(options: MemoryCacheOptions = {}) {
    this.now = options.now ?? Date.now;
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

    return entry.value as T;
  }

  // Stores a value with an optional TTL in milliseconds.
  // Сохраняет значение с опциональным TTL в миллисекундах.
  set<T>(key: string, value: T, options: CacheSetOptions = {}): void {
    const expiresAt =
      options.ttlMs === undefined || options.ttlMs < 0 ? undefined : this.now() + options.ttlMs;

    this.entries.set(key, { value, expiresAt });
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
}
