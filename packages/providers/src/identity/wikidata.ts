import {
  normalizeIdentityId,
  type IdentityClaim,
  type IdentityIds,
  type IdentityNamespace,
  type IdentityResolverSource,
  type MediaType,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";

const PROPERTIES = { imdb: "P345", kinopoisk: "P2603", wikidata: "", tmdb: "" } as const;
const MOVIE_INSTANCES = new Set(["Q11424", "Q506240"]);
const SERIES_INSTANCES = new Set(["Q5398426", "Q1259759", "Q15416"]);
type Anchor = "imdb" | "tmdb" | "kinopoisk" | "wikidata";

interface Statement {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
}
interface Entity {
  id?: string;
  claims?: Record<string, Statement[]>;
}

export interface WikidataIdentitySourceOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

function propertyFor(namespace: Anchor, type: MediaType): string {
  return namespace === "tmdb" ? (type === "movie" ? "P4947" : "P4983") : PROPERTIES[namespace];
}

function values(entity: Entity, property: string, namespace: IdentityNamespace): string[] {
  const statements = entity.claims?.[property];
  if (statements !== undefined && !Array.isArray(statements)) return [];
  return [
    ...new Set(
      (statements ?? [])
        .filter((statement) => statement.rank !== "deprecated")
        .map((statement) => {
          const raw = statement.mainsnak?.datavalue?.value;
          return normalizeIdentityId(
            namespace,
            namespace === "wikidata" && typeof raw === "object" && raw !== null
              ? (raw as { id?: unknown }).id
              : raw,
          );
        })
        .filter((value): value is string => value !== undefined),
    ),
  ];
}

function exactType(entity: Entity, type: MediaType): boolean {
  const instances = values(entity, "P31", "wikidata");
  const accepted = type === "movie" ? MOVIE_INSTANCES : SERIES_INSTANCES;
  const other = type === "movie" ? SERIES_INSTANCES : MOVIE_INSTANCES;
  return instances.some((id) => accepted.has(id)) && !instances.some((id) => other.has(id));
}

function readIds(entity: Entity, type: MediaType): Record<string, unknown> {
  const ids: Record<string, unknown> = { wikidata: entity.id };
  for (const namespace of ["imdb", "tmdb", "kinopoisk"] as const) {
    const found = values(entity, propertyFor(namespace, type), namespace);
    if (found.length === 1) ids[namespace] = found[0];
  }
  return ids;
}

export function wikidataIdentitySource(
  options: WikidataIdentitySourceOptions = {},
): IdentityResolverSource {
  const base = new URL(options.baseUrl ?? "https://www.wikidata.org");
  if (base.protocol !== "https:" || base.username || base.password)
    throw new TypeError("Wikidata identity baseUrl must be credential-free HTTPS.");
  const api = new URL("/w/api.php", base);

  async function request(params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    const url = new URL(api);
    for (const [key, value] of Object.entries({ ...params, format: "json" }))
      url.searchParams.set(key, value);
    return fetchJson<unknown>({
      provider: "wikidata-identity",
      url,
      fetch: options.fetch,
      context: { signal },
      init: {
        headers: { accept: "application/json", "user-agent": MEDIA_ENGINE_DEFAULT_USER_AGENT },
      },
      maxRetries: 0,
      maxResponseBytes: 1024 * 1024,
    });
  }

  return {
    name: "wikidata-identity",
    canResolve: (ids, type) =>
      type !== "anime" && !!(ids.imdb || ids.tmdb || ids.kinopoisk || ids.wikidata),
    async resolve(
      ids: Readonly<IdentityIds>,
      type: MediaType,
      signal: AbortSignal,
    ): Promise<IdentityClaim[]> {
      if (type === "anime") return [];
      const anchor = (["imdb", "tmdb", "kinopoisk", "wikidata"] as const).find(
        (namespace) => ids[namespace],
      );
      if (!anchor) return [];
      const value = ids[anchor]!;
      let entityId = ids.wikidata;
      if (anchor !== "wikidata") {
        const response = (await request(
          {
            action: "query",
            list: "search",
            srsearch: `haswbstatement:${propertyFor(anchor, type)}=${value}`,
            srnamespace: "0",
            srlimit: "2",
            srprop: "",
          },
          signal,
        )) as { query?: { searchinfo?: { totalhits?: number }; search?: { title?: string }[] } };
        const search = response?.query?.search;
        if (
          !Array.isArray(search) ||
          response.query?.searchinfo?.totalhits !== 1 ||
          search.length !== 1
        )
          return [];
        entityId = normalizeIdentityId("wikidata", search[0]?.title);
      }
      if (!entityId) return [];
      const response = (await request(
        { action: "wbgetentities", ids: entityId, props: "claims" },
        signal,
      )) as {
        entities?: Record<string, Entity>;
      };
      const entity = response?.entities?.[entityId];
      if (!entity || entity.id !== entityId || !exactType(entity, type)) return [];
      const found = readIds(entity, type);
      if (found[anchor] !== value) return [];
      return [
        { source: "wikidata-identity", type, matched: { namespace: anchor, value }, ids: found },
      ];
    },
  };
}
