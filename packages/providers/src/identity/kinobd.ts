import {
  normalizeIdentityId,
  type IdentityClaim,
  type IdentityIds,
  type IdentityResolverSource,
  type MediaType,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";
import { mapKinoBdMediaType } from "../shared/mapping.js";

export interface KinoBdIdentitySourceOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

interface RecordResponse {
  data?: {
    type?: string;
    imdb_id?: unknown;
    tmdb_id?: unknown;
    kinopoisk_id?: unknown;
  }[];
}

export function kinobdIdentitySource(
  options: KinoBdIdentitySourceOptions = {},
): IdentityResolverSource {
  const base = new URL(options.baseUrl ?? "https://kinobd.net");
  if (base.protocol !== "https:" || base.username || base.password)
    throw new TypeError("KinoBD identity baseUrl must be credential-free HTTPS.");

  return {
    name: "kinobd-identity",
    canResolve: (ids, type) => type !== "anime" && !!(ids.imdb || ids.kinopoisk),
    async resolve(
      ids: Readonly<IdentityIds>,
      type: MediaType,
      signal: AbortSignal,
    ): Promise<IdentityClaim[]> {
      if (type === "anime") return [];
      const anchor = ids.imdb ? "imdb" : "kinopoisk";
      const value = ids[anchor];
      if (!value) return [];
      const url = new URL(`/api/films/search/${anchor === "imdb" ? "imdb_id" : "kp_id"}`, base);
      url.searchParams.set("q", value);
      url.searchParams.set("page", "1");
      const payload = await fetchJson<RecordResponse>({
        provider: "kinobd-identity",
        url,
        fetch: options.fetch,
        context: { signal },
        init: { headers: { accept: "application/json" } },
        maxRetries: 0,
        maxResponseBytes: 256 * 1024,
      });
      if (!Array.isArray(payload.data))
        throw new Error("KinoBD identity response has no data array");
      const matches = payload.data.filter(
        (record) =>
          mapKinoBdMediaType(record.type) === type &&
          normalizeIdentityId(anchor, record[anchor === "imdb" ? "imdb_id" : "kinopoisk_id"]) ===
            value,
      );
      if (matches.length !== 1) return [];
      const record = matches[0]!;
      const found: Record<string, unknown> = {};
      for (const [namespace, raw] of [
        ["imdb", record.imdb_id],
        ["tmdb", record.tmdb_id],
        ["kinopoisk", record.kinopoisk_id],
      ] as const) {
        const id = normalizeIdentityId(namespace, raw);
        if (id) found[namespace] = id;
      }
      return [
        { source: "kinobd-identity", type, matched: { namespace: anchor, value }, ids: found },
      ];
    },
  };
}
