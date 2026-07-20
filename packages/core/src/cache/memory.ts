import type { Cache, CacheSetOptions } from "./types.js";

// Options used to construct a memory cache instance.
// Опции для создания экземпляра memory cache.
export interface MemoryCacheOptions {
  now?: () => number;
  // Omit to keep entries without a normal expiration unless set() supplies ttlMs.
  // Не задавайте для записей без обычного срока истечения, если set() не передает ttlMs.
  defaultTtlMs?: number;
  defaultStaleTtlMs?: number;
  maxEntries?: number;
}

// Internal memory cache entry with optional expiration timestamp.
// Внутренняя запись memory cache с опциональным временем истечения.
interface MemoryCacheEntry<T> {
  value: T;
  expiresAt?: number;
  staleUntil?: number;
}

// Simple synchronous in-memory cache with optional TTL support.
// Простой синхронный in-memory cache с опциональной поддержкой TTL.
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, MemoryCacheEntry<unknown>>();
  private readonly now: () => number;
  private readonly defaultTtlMs?: number;
  private readonly defaultStaleTtlMs?: number;
  private readonly maxEntries?: number;

  constructor(options: MemoryCacheOptions = {}) {
    if (
      options.maxEntries !== undefined &&
      (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0)
    ) {
      throw new TypeError("MemoryCache maxEntries must be a positive integer.");
    }

    validateTtl("defaultTtlMs", options.defaultTtlMs);
    validateTtl("defaultStaleTtlMs", options.defaultStaleTtlMs);

    this.now = options.now ?? Date.now;
    this.defaultTtlMs = options.defaultTtlMs;
    this.defaultStaleTtlMs = options.defaultStaleTtlMs;
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
      this.deleteIfBeyondStaleWindow(key, entry);
      return undefined;
    }

    if (this.maxEntries !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }

    return cloneCacheValue(entry.value as T);
  }

  // Reads a value only after normal TTL expiration and before its stale window closes.
  // Читает значение только после обычного TTL и до завершения stale-окна.
  getStale<T>(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry || !this.isExpired(entry)) {
      return undefined;
    }

    if (this.isBeyondStaleWindow(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    if (this.maxEntries !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }

    return cloneCacheValue(entry.value as T);
  }

  // Stores a value with an optional TTL in milliseconds.
  // Сохраняет значение с опциональным TTL в миллисекундах.
  set<T>(key: string, value: T, options: CacheSetOptions = {}): void {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const staleTtlMs = options.staleTtlMs ?? this.defaultStaleTtlMs;

    validateTtl("ttlMs", ttlMs);
    validateTtl("staleTtlMs", staleTtlMs);

    const expiresAt = ttlMs === undefined ? undefined : this.now() + ttlMs;
    const staleUntil =
      expiresAt === undefined || staleTtlMs === undefined || staleTtlMs <= 0
        ? undefined
        : expiresAt + staleTtlMs;

    this.entries.delete(key);
    this.entries.set(key, { value: cloneCacheValue(value), expiresAt, staleUntil });
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

  private isBeyondStaleWindow(entry: MemoryCacheEntry<unknown>): boolean {
    return entry.staleUntil === undefined || entry.staleUntil <= this.now();
  }

  private deleteIfBeyondStaleWindow(key: string, entry: MemoryCacheEntry<unknown>): void {
    if (this.isBeyondStaleWindow(entry)) {
      this.entries.delete(key);
    }
  }

  // Evicts expired entries first, then least-recently-used entries until the bound is met.
  // Сначала удаляет истекшие записи, затем давно не использованные до соблюдения лимита.
  private evictOverflow(): void {
    if (this.maxEntries === undefined || this.entries.size <= this.maxEntries) {
      return;
    }

    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry) && this.isBeyondStaleWindow(entry)) {
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

// Keeps callers from mutating values stored by the shared in-memory cache.
// Не позволяет вызывающему коду изменять значения внутри общего memory cache.
function cloneCacheValue<T>(value: T): T {
  return structuredClone(value);
}

function validateTtl(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`MemoryCache ${name} must be a non-negative safe integer.`);
  }
}
