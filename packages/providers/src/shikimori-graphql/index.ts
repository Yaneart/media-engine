import {
  ProviderError,
  type AnimeDetails,
  type AnimeKind,
  type ExternalIds,
  type MediaProvider,
  type ProviderContext,
  type ProviderDetailsQuery,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from "@media-engine/core";
import { fetchJson, ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";

const NAME = "shikimori-graphql";
const DEFAULT_ENDPOINT = "https://shikimori.io/api/graphql";
const SEARCH_PAGE_SIZE = 50;
const ANIME_FIELDS = `
  id malId name russian english japanese synonyms description kind episodes episodesAired score status
  airedOn { date year } releasedOn { date }
  poster { originalUrl mainUrl }
  screenshots { originalUrl x332Url }
  genres { id name russian }
`;

export interface ShikimoriGraphqlProviderOptions {
  endpoint?: string;
  fetch?: ProviderFetch;
  userAgent?: string;
  version?: string;
}

interface GraphqlResponse {
  data?: {
    animes?: ShikimoriAnime[] | null;
    genres?: ShikimoriGenre[] | null;
  };
  errors?: Array<{ message?: string }>;
}

interface ShikimoriGenre {
  id?: string;
  name?: string;
  russian?: string;
}

interface ShikimoriAnime {
  id?: string;
  malId?: string | null;
  name?: string;
  russian?: string;
  english?: string | null;
  japanese?: string | null;
  synonyms?: string[] | null;
  description?: string | null;
  kind?: string | null;
  episodes?: number | null;
  episodesAired?: number | null;
  score?: number | null;
  status?: string | null;
  airedOn?: { date?: string | null; year?: number | null } | null;
  releasedOn?: { date?: string | null } | null;
  poster?: { originalUrl?: string | null; mainUrl?: string | null } | null;
  screenshots?: Array<{ originalUrl?: string | null; x332Url?: string | null }> | null;
  genres?: Array<{ id?: string; name?: string; russian?: string }> | null;
}

export function shikimoriGraphqlProvider(
  options: ShikimoriGraphqlProviderOptions = {},
): MediaProvider {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const userAgent = options.userAgent?.trim();
  const gate = new ProviderRateLimitGate();
  let genreCatalog: ShikimoriGenre[] | undefined;

  async function request<T>(
    query: string,
    variables: Record<string, string | number>,
    context: ProviderContext,
    field: "animes" | "genres",
  ): Promise<T[]> {
    if (!userAgent) {
      throw new ProviderError({
        provider: NAME,
        code: "PROVIDER_UNAUTHORIZED",
        message: `Provider "${NAME}" is not configured.`,
      });
    }

    const response = await fetchJson<GraphqlResponse>({
      provider: NAME,
      url: new URL(endpoint),
      context,
      fetch: options.fetch,
      rateLimitGate: gate,
      maxRetries: 0,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent },
        body: JSON.stringify({ query, variables }),
      },
    });

    const records = response.data?.[field];
    if (response.errors?.length || !Array.isArray(records)) {
      throw new ProviderError({
        provider: NAME,
        code: "PROVIDER_INVALID_RESPONSE",
        message: `Provider "${NAME}" returned an invalid GraphQL response.`,
      });
    }
    return records as T[];
  }

  async function loadGenreCatalog(context: ProviderContext): Promise<ShikimoriGenre[]> {
    if (genreCatalog) return genreCatalog;
    genreCatalog = await request<ShikimoriGenre>(
      "query { genres(entryType: Anime) { id name russian } }",
      {},
      context,
      "genres",
    );
    return genreCatalog;
  }

  async function loadDetails(
    query: ProviderDetailsQuery,
    context: ProviderContext,
  ): Promise<AnimeDetails | null> {
    if (query.type && query.type !== "anime") return null;
    const requestedId = query.ids?.shikimori ?? query.ids?.myAnimeList;
    if (!requestedId || !/^\d+$/u.test(requestedId)) return null;
    const records = await request<ShikimoriAnime>(
      `query ($ids: String!) { animes(ids: $ids, limit: 2) { ${ANIME_FIELDS} } }`,
      { ids: requestedId },
      context,
      "animes",
    );
    const matches = records
      .map((record) => mapAnime(record))
      .filter((item): item is AnimeDetails => Boolean(item));
    const exact = matches.filter((item) => matchesIds(query.ids, item.ids));
    return exact.length === 1 ? exact[0]! : null;
  }

  async function search(
    query: ProviderSearchQuery,
    context: ProviderContext,
  ): Promise<ProviderSearchResult[]> {
    if (query.type && query.type !== "anime") return [];
    if (query.ids?.shikimori || query.ids?.myAnimeList) {
      const details = await loadDetails({ ...query, type: "anime" }, context);
      return details ? [toSearchResult(details)] : [];
    }
    let records: ShikimoriAnime[];
    if (query.title) {
      records = await request<ShikimoriAnime>(
        `query ($search: String!, $limit: Int!) { animes(search: $search, limit: $limit) { ${ANIME_FIELDS} } }`,
        { search: query.title, limit: Math.min(query.limit ?? 20, SEARCH_PAGE_SIZE) },
        context,
        "animes",
      );
    } else {
      const genreId = query.genre
        ? resolveGenreId(await loadGenreCatalog(context), query.genre)
        : undefined;
      if (query.genre && !genreId) return [];

      const target = query.limit ?? 20;
      const pages = await Promise.all(
        Array.from({ length: Math.ceil(target / SEARCH_PAGE_SIZE) }, (_, index) =>
          request<ShikimoriAnime>(
            `query ($page: Int!, $limit: Int!, $season: SeasonString, $genre: String, $score: Int) {
              animes(page: $page, limit: $limit, order: ranked, season: $season, genre: $genre, score: $score) {
                ${ANIME_FIELDS}
              }
            }`,
            {
              page: index + 1,
              limit: Math.min(SEARCH_PAGE_SIZE, target - index * SEARCH_PAGE_SIZE),
              ...(query.year !== undefined ? { season: String(query.year) } : {}),
              ...(genreId ? { genre: genreId } : {}),
              ...(query.minimumRating !== undefined
                ? { score: Math.floor(query.minimumRating) }
                : {}),
            },
            context,
            "animes",
          ),
        ),
      );
      records = pages.flat().slice(0, target);
    }
    return records
      .map((record) => mapAnime(record, query.title ? undefined : query.genre))
      .filter((item): item is AnimeDetails => Boolean(item))
      .filter((item) => query.year === undefined || item.year === query.year)
      .filter((item) =>
        Boolean(item.year && item.poster?.url && item.ids?.shikimori && item.ids.myAnimeList),
      )
      .map(toSearchResult);
  }

  return {
    name: NAME,
    version: options.version,
    kind: "metadata",
    configured: Boolean(userAgent),
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["anime"],
      metadataRoute: "primary",
      search: {
        byTitle: true,
        byExternalIds: ["shikimori", "myAnimeList"],
        filterDiscovery: ["year", "genre", "minimumRating"],
      },
      details: { byExternalIds: ["shikimori", "myAnimeList"] },
      features: ["posters", "backdrops", "ratings", "genres", "episodes", "alternative_titles"],
    },
    search,
    getDetails: async (query, context) => {
      const details = await loadDetails(query, context);
      return details ? { provider: NAME, details, source: details.sourceProviders?.[0] } : null;
    },
  };
}

function mapAnime(record: ShikimoriAnime, requestedGenre?: string): AnimeDetails | null {
  const id = numericId(record.id);
  const malId = numericId(record.malId ?? undefined);
  const title = record.russian?.trim() || record.name?.trim();
  const posterUrl = httpsUrl(record.poster?.originalUrl) ?? httpsUrl(record.poster?.mainUrl);
  const backdropUrl = record.screenshots?.map((item) => httpsUrl(item.originalUrl)).find(Boolean);
  if (!id || !malId || !title) return null;

  const ids: ExternalIds = { shikimori: id, myAnimeList: malId };
  const episodesCount = Math.max(record.episodes ?? 0, record.episodesAired ?? 0) || undefined;
  const description = normalizeDescription(record.description);
  const alternativeTitles = [
    record.name,
    record.english,
    record.japanese,
    ...(record.synonyms ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value !== title));

  const genres: NonNullable<AnimeDetails["genres"]> =
    record.genres?.flatMap((genre) => {
      const name = genre.russian?.trim() || genre.name?.trim();
      return name ? [{ id: numericId(genre.id), name, source: NAME }] : [];
    }) ?? [];
  if (
    requestedGenre &&
    !genres?.some((genre) => normalizeGenre(genre.name) === normalizeGenre(requestedGenre))
  ) {
    genres.push({ name: requestedGenre, source: NAME });
  }

  return {
    id: `${NAME}-anime-${id}`,
    type: "anime",
    animeKind: mapKind(record.kind),
    title,
    originalTitle: record.name?.trim() || undefined,
    alternativeTitles: [...new Set(alternativeTitles)],
    year: record.airedOn?.year ?? parseYear(record.airedOn?.date),
    releaseDate: validDate(record.airedOn?.date),
    airedOn: validDate(record.airedOn?.date),
    releasedOn: validDate(record.releasedOn?.date),
    description,
    poster: posterUrl ? { url: posterUrl, type: "poster", source: NAME } : undefined,
    backdrop: backdropUrl ? { url: backdropUrl, type: "backdrop", source: NAME } : undefined,
    images: record.screenshots?.flatMap((item) => {
      const url = httpsUrl(item.originalUrl) ?? httpsUrl(item.x332Url);
      return url ? [{ url, type: "backdrop" as const, source: NAME }] : [];
    }),
    genres,
    ratings:
      typeof record.score === "number" && record.score > 0
        ? [{ source: "shikimori", value: record.score, max: 10 }]
        : undefined,
    episodesCount,
    episodes: episodesCount
      ? Array.from({ length: episodesCount }, (_, index) => ({
          id: `${id}-episode-${index + 1}`,
          episodeNumber: index + 1,
          absoluteNumber: index + 1,
        }))
      : undefined,
    status: mapStatus(record.status),
    ids,
    sourceProviders: [{ provider: NAME, ids, url: `https://shikimori.io/animes/${id}` }],
  };
}

function resolveGenreId(genres: ShikimoriGenre[], requestedGenre: string): string | undefined {
  const requested = normalizeGenre(requestedGenre);
  const aliases = new Set([requested, ...(requested === "thriller" ? ["suspense"] : [])]);
  return genres.find((genre) => {
    const names = [genre.name, genre.russian]
      .filter((name): name is string => Boolean(name))
      .map(normalizeGenre);
    return names.some((name) => aliases.has(name));
  })?.id;
}

function normalizeGenre(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]+/gu, " ");
}

function toSearchResult(details: AnimeDetails): ProviderSearchResult {
  return { provider: NAME, item: { ...details }, source: details.sourceProviders?.[0] };
}

function matchesIds(expected: ExternalIds | undefined, actual: ExternalIds | undefined): boolean {
  return ["shikimori", "myAnimeList"].every((key) => {
    const source = key as "shikimori" | "myAnimeList";
    return !expected?.[source] || expected[source] === actual?.[source];
  });
}

function normalizeDescription(value: string | null | undefined): string | undefined {
  return (
    value
      ?.replace(/\[\[(.*?)\]\]/gu, "$1")
      .replace(/\[(?:character|anime|manga)=\d+\](.*?)\[\/(?:character|anime|manga)\]/gu, "$1")
      .replace(/\[(.*?)\]/gu, "$1")
      .trim() || undefined
  );
}

function numericId(value: string | undefined): string | undefined {
  return value && /^\d+$/u.test(value) ? value : undefined;
}

function httpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function mapKind(value: string | null | undefined): AnimeKind {
  return ["tv", "movie", "ova", "ona", "special", "music"].includes(value ?? "")
    ? (value as AnimeKind)
    : "unknown";
}

function mapStatus(value: string | null | undefined) {
  switch (value) {
    case "anons":
      return "announced" as const;
    case "ongoing":
      return "ongoing" as const;
    case "released":
      return "released" as const;
    default:
      return undefined;
  }
}

function parseYear(value: string | null | undefined): number | undefined {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : undefined;
}

function validDate(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}
