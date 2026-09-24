import {
  normalizeIdentityId,
  type IdentityClaim,
  type IdentityIds,
  type IdentityResolverSource,
  type MediaType,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";

export interface AnimeIdentitySourceOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

function baseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new TypeError("Anime identity baseUrl must be credential-free HTTPS.");
  return url;
}

function graphQlId(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647 ? number : undefined;
}

export function aniListIdentitySource(
  options: AnimeIdentitySourceOptions = {},
): IdentityResolverSource {
  const url = baseUrl(options.baseUrl ?? "https://graphql.anilist.co");
  return {
    name: "anilist-identity",
    canResolve: (ids, type) => type === "anime" && !!(ids.aniList || ids.myAnimeList),
    async resolve(
      ids: Readonly<IdentityIds>,
      type: MediaType,
      signal: AbortSignal,
    ): Promise<IdentityClaim[]> {
      if (type !== "anime") return [];
      const anchor = ids.aniList ? "aniList" : "myAnimeList";
      const value = ids[anchor];
      const id = value && graphQlId(value);
      if (!value || !id) return [];
      const payload = await fetchJson<{
        data?: { Media?: { id?: unknown; idMal?: unknown } | null };
        errors?: unknown[];
      }>({
        provider: "anilist-identity",
        url,
        fetch: options.fetch,
        context: { signal },
        init: {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            query:
              "query ($id: Int, $idMal: Int) { Media(id: $id, idMal: $idMal, type: ANIME) { id idMal } }",
            variables: anchor === "aniList" ? { id } : { idMal: id },
          }),
        },
        maxRetries: 0,
        maxResponseBytes: 64 * 1024,
      });
      if (payload.errors?.length) throw new Error("AniList identity query failed");
      const media = payload.data?.Media;
      if (!media) return [];
      const found = {
        aniList: normalizeIdentityId("aniList", media.id),
        myAnimeList: normalizeIdentityId("myAnimeList", media.idMal),
      };
      if (found[anchor] !== value) return [];
      return [
        { source: "anilist-identity", type, matched: { namespace: anchor, value }, ids: found },
      ];
    },
  };
}

export function shikimoriIdentitySource(
  options: AnimeIdentitySourceOptions = {},
): IdentityResolverSource {
  const base = baseUrl(options.baseUrl ?? "https://shikimori.one");
  return {
    name: "shikimori-identity",
    canResolve: (ids, type) => type === "anime" && !!(ids.shikimori || ids.myAnimeList),
    async resolve(
      ids: Readonly<IdentityIds>,
      type: MediaType,
      signal: AbortSignal,
    ): Promise<IdentityClaim[]> {
      if (type !== "anime") return [];
      const anchor = ids.shikimori ? "shikimori" : "myAnimeList";
      const value = ids[anchor];
      if (!value) return [];
      const url = new URL(`/api/animes/${encodeURIComponent(value)}`, base);
      const media = await fetchJson<{ id?: unknown; myanimelist_id?: unknown }>({
        provider: "shikimori-identity",
        url,
        fetch: options.fetch,
        context: { signal },
        init: {
          headers: { accept: "application/json", "user-agent": MEDIA_ENGINE_DEFAULT_USER_AGENT },
        },
        maxRetries: 0,
        maxResponseBytes: 256 * 1024,
      });
      const found = {
        shikimori: normalizeIdentityId("shikimori", media.id),
        myAnimeList: normalizeIdentityId("myAnimeList", media.myanimelist_id),
      };
      if (found[anchor] !== value) return [];
      return [
        { source: "shikimori-identity", type, matched: { namespace: anchor, value }, ids: found },
      ];
    },
  };
}
