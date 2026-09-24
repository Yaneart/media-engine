import {
  normalizeIdentityId,
  type IdentityClaim,
  type IdentityIds,
  type IdentityResolverSource,
  type MediaType,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

export interface AderomIdentitySourceOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

interface AderomRecord {
  error?: unknown;
  category?: unknown;
  kinopoisk_id?: unknown;
  imdb_id?: unknown;
  myanimelist_id?: unknown;
  worldart_id?: unknown;
}

export function aderomIdentitySource(
  options: AderomIdentitySourceOptions = {},
): IdentityResolverSource {
  const base = new URL(options.baseUrl ?? "https://aderom.net");
  if (base.protocol !== "https:" || base.username || base.password)
    throw new TypeError("Aderom identity baseUrl must be credential-free HTTPS.");
  return {
    name: "aderom-identity",
    canResolve: (ids, type) => type !== "movie" && !!ids.kinopoisk,
    async resolve(
      ids: Readonly<IdentityIds>,
      type: MediaType,
      signal: AbortSignal,
    ): Promise<IdentityClaim[]> {
      const value = ids.kinopoisk;
      if (!value || type === "movie") return [];
      const record = await fetchJson<AderomRecord>({
        provider: "aderom-identity",
        url: new URL(`/api/${encodeURIComponent(value)}`, base),
        fetch: options.fetch,
        context: { signal },
        init: { headers: { accept: "application/json" } },
        maxRetries: 0,
        maxResponseBytes: 64 * 1024,
      });
      if (record.error === "not found") return [];
      if (
        normalizeIdentityId("kinopoisk", record.kinopoisk_id) !== value ||
        typeof record.category !== "string"
      )
        return [];
      const category = record.category.toLowerCase();
      if (
        type === "anime"
          ? !category.includes("аниме")
          : !category.includes("сериал") || category.includes("аниме")
      )
        return [];
      const found: Record<string, unknown> = { kinopoisk: value };
      for (const [namespace, raw] of [
        ["imdb", record.imdb_id],
        ["myAnimeList", record.myanimelist_id],
        ["worldArt", record.worldart_id],
      ] as const) {
        const id = normalizeIdentityId(namespace, raw);
        if (id) found[namespace] = id;
      }
      return [
        { source: "aderom-identity", type, matched: { namespace: "kinopoisk", value }, ids: found },
      ];
    },
  };
}
