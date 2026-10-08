import {
  ProviderError,
  type ExternalIds,
  type MediaDetails,
  type MediaItem,
  type MediaProvider,
  type ProviderContext,
  type ProviderDetailsQuery,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from "@media-engine/core";
import {
  fetchJson,
  getProviderHttpStatus,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";

const NAME = "tmdb-official";
const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/original";
const MAX_SEARCH_RESULTS_PER_TYPE = 10;

export interface TmdbOfficialProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
}

interface TmdbGenre {
  id?: number;
  name?: string;
}

interface TmdbSeason {
  id?: number;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  season_number?: number;
  episode_count?: number;
  air_date?: string | null;
}

interface TmdbRecord {
  id?: number;
  imdb_id?: string | null;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  status?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: TmdbGenre[];
  vote_average?: number;
  vote_count?: number;
  number_of_episodes?: number;
  number_of_seasons?: number;
  seasons?: TmdbSeason[];
  external_ids?: { imdb_id?: string | null };
  alternative_titles?: { results?: Array<{ title?: string }> };
}

interface TmdbSearchResponse {
  results?: TmdbRecord[];
}

interface TmdbFindResponse {
  movie_results?: TmdbRecord[];
  tv_results?: TmdbRecord[];
}

export function tmdbOfficialProvider(options: TmdbOfficialProviderOptions = {}): MediaProvider {
  const apiKey = options.apiKey?.trim();
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const gate = new ProviderRateLimitGate();

  async function request<T>(
    path: string,
    parameters: Record<string, string | number | undefined>,
    context: ProviderContext,
  ): Promise<T> {
    if (!apiKey) {
      throw new ProviderError({
        provider: NAME,
        code: "PROVIDER_UNAUTHORIZED",
        message: `Provider "${NAME}" is not configured.`,
      });
    }

    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set("api_key", apiKey);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return fetchJson<T>({
      provider: NAME,
      url,
      context,
      fetch: options.fetch,
      rateLimitGate: gate,
      maxRetries: 0,
    });
  }

  async function loadDetails(
    query: ProviderDetailsQuery,
    context: ProviderContext,
  ): Promise<MediaDetails | null> {
    if (query.type === undefined) {
      const candidates = await Promise.all(
        (["movie", "series"] as const).map((type) => loadDetails({ ...query, type }, context)),
      );
      const matches = candidates.filter((item): item is MediaDetails => Boolean(item));
      return matches.length === 1 ? matches[0]! : null;
    }
    if (query.type !== "movie" && query.type !== "series") return null;
    const type = query.type;
    let tmdbId = query.ids?.tmdb;

    if (!tmdbId && query.ids?.imdb) {
      const found = await request<TmdbFindResponse>(
        `/find/${encodeURIComponent(query.ids.imdb)}`,
        { external_source: "imdb_id", language: locale(query.language) },
        context,
      );
      const candidates = type === "movie" ? found.movie_results : found.tv_results;
      if (candidates?.length !== 1 || !candidates[0]?.id) return null;
      tmdbId = String(candidates[0].id);
    }

    if (!tmdbId || !/^\d+$/u.test(tmdbId)) return null;

    let record: TmdbRecord;
    try {
      record = await request<TmdbRecord>(
        `/${type === "movie" ? "movie" : "tv"}/${tmdbId}`,
        {
          language: locale(query.language),
          append_to_response: "external_ids,alternative_titles",
        },
        context,
      );
    } catch (error) {
      if (getProviderHttpStatus(error) === 404) return null;
      throw error;
    }

    const details = mapDetails(record, type);
    if (!details || !matchesIds(query.ids, details.ids)) return null;
    return details;
  }

  async function search(
    query: ProviderSearchQuery,
    context: ProviderContext,
  ): Promise<ProviderSearchResult[]> {
    if (query.type === "anime") return [];
    const types = query.type ? [query.type] : (["movie", "series"] as const);

    if (query.ids?.tmdb || query.ids?.imdb) {
      const details = await Promise.all(
        types.map((type) => loadDetails({ ...query, type }, context)),
      );
      return details
        .filter((item): item is MediaDetails => item !== null)
        .filter(isCompleteSearchItem)
        .map(toSearchResult);
    }

    if (!query.title) return [];
    const limit = Math.min(query.limit ?? MAX_SEARCH_RESULTS_PER_TYPE, MAX_SEARCH_RESULTS_PER_TYPE);
    const discovered = (
      await Promise.all(
        types.map(async (type) => {
          const response = await request<TmdbSearchResponse>(
            `/search/${type === "movie" ? "movie" : "tv"}`,
            {
              query: query.title,
              language: locale(query.language),
              year: type === "series" ? query.year : undefined,
              primary_release_year: type === "movie" ? query.year : undefined,
              page: 1,
              include_adult: "false",
            },
            context,
          );
          return (response.results ?? []).flatMap((item) =>
            item.id ? [{ type, id: String(item.id) }] : [],
          );
        }),
      )
    ).flatMap((items) => items.slice(0, limit));

    const details = await Promise.all(
      discovered.map(({ type, id }) => loadDetails({ type, ids: { tmdb: id } }, context)),
    );
    return details
      .filter((item): item is MediaDetails => item !== null)
      .filter(isCompleteSearchItem)
      .map(toSearchResult);
  }

  return {
    name: NAME,
    version: options.version,
    kind: "metadata",
    configured: Boolean(apiKey),
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["movie", "series"],
      metadataRoute: "primary",
      search: { byTitle: true, byExternalIds: ["imdb", "tmdb"] },
      details: { byExternalIds: ["imdb", "tmdb"] },
      features: ["posters", "backdrops", "ratings", "genres", "seasons"],
    },
    search,
    getDetails: async (query, context) => {
      const details = await loadDetails(query, context);
      return details ? { provider: NAME, details, source: details.sourceProviders?.[0] } : null;
    },
  };
}

function mapDetails(record: TmdbRecord, type: "movie" | "series"): MediaDetails | null {
  const id = positiveInteger(record.id);
  const title = (type === "movie" ? record.title : record.name)?.trim();
  const date = type === "movie" ? record.release_date : record.first_air_date;
  const imdb = record.external_ids?.imdb_id ?? record.imdb_id ?? undefined;
  if (!id || !title) return null;

  const ids: ExternalIds = { tmdb: id, ...(imdb ? { imdb } : {}) };
  const common = {
    id: `${NAME}-${type}-${id}`,
    type,
    title,
    originalTitle:
      (type === "movie" ? record.original_title : record.original_name)?.trim() || undefined,
    alternativeTitles: mapAlternativeTitles(record, title),
    year: parseYear(date),
    releaseDate: validDate(date),
    description: record.overview?.trim() || undefined,
    poster: image(record.poster_path, "poster" as const),
    backdrop: image(record.backdrop_path, "backdrop" as const),
    genres: record.genres?.flatMap((genre) =>
      genre.name?.trim()
        ? [{ id: positiveInteger(genre.id), name: genre.name.trim(), source: NAME }]
        : [],
    ),
    ratings:
      typeof record.vote_average === "number" && record.vote_average > 0
        ? [
            {
              source: "tmdb" as const,
              value: record.vote_average,
              max: 10,
              votes: record.vote_count,
            },
          ]
        : undefined,
    ids,
    status: mapStatus(record.status),
    runtimeMinutes:
      type === "movie" ? record.runtime : record.episode_run_time?.find((value) => value > 0),
    sourceProviders: [
      {
        provider: NAME,
        ids,
        url: `https://www.themoviedb.org/${type === "movie" ? "movie" : "tv"}/${id}`,
      },
    ],
  };

  if (type === "movie") return common;
  return {
    ...common,
    type: "series",
    seasonsCount: record.number_of_seasons,
    episodesCount: record.number_of_episodes,
    seasons: record.seasons?.flatMap((season) =>
      typeof season.season_number === "number"
        ? [
            {
              id: positiveInteger(season.id),
              number: season.season_number,
              title: season.name?.trim() || undefined,
              description: season.overview?.trim() || undefined,
              poster: image(season.poster_path, "poster"),
              episodesCount: season.episode_count,
              releaseDate: validDate(season.air_date),
            },
          ]
        : [],
    ),
  };
}

function toSearchResult(details: MediaDetails): ProviderSearchResult {
  const item: MediaItem = { ...details };
  return { provider: NAME, item, source: details.sourceProviders?.[0] };
}

function mapAlternativeTitles(record: TmdbRecord, title: string): string[] | undefined {
  const excluded = new Set(
    [title, record.original_title, record.original_name]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim().toLocaleLowerCase()),
  );
  const titles = new Map<string, string>();
  for (const item of record.alternative_titles?.results ?? []) {
    const value = item.title?.trim();
    const key = value?.toLocaleLowerCase();
    if (value && key && !excluded.has(key) && !titles.has(key)) titles.set(key, value);
  }
  return titles.size > 0 ? [...titles.values()] : undefined;
}

function isCompleteSearchItem(details: MediaDetails): boolean {
  return Boolean(details.title.trim() && details.year && details.poster?.url && details.ids?.tmdb);
}

function matchesIds(expected: ExternalIds | undefined, actual: ExternalIds | undefined): boolean {
  return ["tmdb", "imdb"].every((key) => {
    const source = key as "tmdb" | "imdb";
    return !expected?.[source] || expected[source] === actual?.[source];
  });
}

function image(path: string | null | undefined, type: "poster" | "backdrop") {
  return path?.startsWith("/")
    ? { url: `${IMAGE_BASE_URL}${path}`, type, source: NAME }
    : undefined;
}

function locale(language: string | undefined): string {
  return language === undefined || language.toLowerCase().startsWith("ru") ? "ru-RU" : "en-US";
}

function positiveInteger(value: number | undefined): string | undefined {
  return Number.isSafeInteger(value) && value! > 0 ? String(value) : undefined;
}

function parseYear(value: string | undefined): number | undefined {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year >= 1800 ? year : undefined;
}

function validDate(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

function mapStatus(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case "released":
      return "released" as const;
    case "returning series":
      return "ongoing" as const;
    case "ended":
      return "ended" as const;
    case "canceled":
      return "canceled" as const;
    case "in production":
      return "in_production" as const;
    default:
      return undefined;
  }
}
