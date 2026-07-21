import { MemoryCache } from "@media-engine/core";

const ENTITY_KEY_PREFIX = "entity";
const IMDB_KEY_PREFIX = "imdb";

// Internal bounded cache for expensive Wikidata entity payloads and exact IMDb mappings.
// Внутренний bounded cache для тяжелых Wikidata entities и точных IMDb mappings.
export class WikidataCache<TEntity> {
  readonly #cache: MemoryCache;
  readonly #ttlMs: number;

  constructor(options: { maxEntries: number; ttlMs: number }) {
    this.#cache = new MemoryCache({ maxEntries: options.maxEntries });
    this.#ttlMs = options.ttlMs;
  }

  getEntity(languageKey: string, entityId: string): TEntity | null | undefined {
    return this.#cache.get<TEntity | null>(
      `${ENTITY_KEY_PREFIX}:${languageKey}:${entityId.toUpperCase()}`,
    );
  }

  setEntity(languageKey: string, entityId: string, entity: TEntity | null): void {
    this.#cache.set(`${ENTITY_KEY_PREFIX}:${languageKey}:${entityId.toUpperCase()}`, entity, {
      ttlMs: this.#ttlMs,
    });
  }

  getImdbEntityId(imdbId: string): string | null | undefined {
    return this.#cache.get<string | null>(`${IMDB_KEY_PREFIX}:${imdbId.toLowerCase()}`);
  }

  setImdbEntityId(imdbId: string, entityId: string | null): void {
    this.#cache.set(`${IMDB_KEY_PREFIX}:${imdbId.toLowerCase()}`, entityId, {
      ttlMs: this.#ttlMs,
    });
  }
}
