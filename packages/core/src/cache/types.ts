// Options used when writing a value into cache.
// Опции, используемые при записи значения в cache.
export interface CacheSetOptions {
  ttlMs?: number;
  staleTtlMs?: number;
}

// Optional cache contract used by the engine and custom integrations.
// Опциональный cache-контракт для движка и пользовательских интеграций.
export interface Cache {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  getStale?<T>(key: string): Promise<T | undefined> | T | undefined;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}
