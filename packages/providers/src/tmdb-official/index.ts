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
const DISCOVER_PAGE_SIZE = 20;
const TMDB_GENRES = {
  movie: new Map([
    [12, "Adventure"],
    [14, "Fantasy"],
    [16, "Animation"],
    [18, "Drama"],
    [27, "Horror"],
    [28, "Action"],
    [35, "Comedy"],
    [36, "History"],
    [37, "Western"],
    [53, "Thriller"],
    [80, "Crime"],
    [99, "Documentary"],
    [878, "Science Fiction"],
    [9648, "Mystery"],
    [10402, "Music"],
    [10749, "Romance"],
    [10751, "Family"],
    [10752, "War"],
  ]),
  series: new Map([
    [16, "Animation"],
    [18, "Drama"],
    [35, "Comedy"],
    [37, "Western"],
    [80, "Crime"],
    [99, "Documentary"],
    [9648, "Mystery"],
    [10751, "Family"],
    [10759, "Action & Adventure"],
    [10762, "Kids"],
    [10763, "News"],
    [10764, "Reality"],
    [10765, "Sci-Fi & Fantasy"],
    [10766, "Soap"],
    [10767, "Talk"],
    [10768, "War & Politics"],
  ]),
} as const;

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
  genre_ids?: number[];
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

  async function discover(
    query: ProviderSearchQuery,
    context: ProviderContext,
  ): Promise<ProviderSearchResult[]> {
    if (query.type === "anime") return [];
    const types = query.type ? [query.type] : (["movie", "series"] as const);
    const target = query.limit ?? DISCOVER_PAGE_SIZE;
    const results = await Promise.all(
      types.map(async (type) => {
        const genreId = query.genre ? discoverGenreId(type, query.genre) : undefined;
        if (query.genre && genreId === undefined) return [];

        const pageCount = Math.ceil(target / DISCOVER_PAGE_SIZE);
        const pages = await Promise.all(
          Array.from({ length: pageCount }, (_, index) =>
            request<TmdbSearchResponse>(
              `/discover/${type === "movie" ? "movie" : "tv"}`,
              {
                language: locale(query.language),
                page: index + 1,
                sort_by: "popularity.desc",
                include_adult: "false",
                with_genres: genreId,
                primary_release_year: type === "movie" ? query.year : undefined,
                first_air_date_year: type === "series" ? query.year : undefined,
                "vote_average.gte": query.minimumRating,
              },
              context,
            ),
          ),
        );

        return pages
          .flatMap((page) => page.results ?? [])
          .slice(0, target)
          .map((record) => mapDiscoveryItem(record, type, query.genre))
          .filter((item): item is MediaItem => Boolean(item))
          .map((item) => toSearchResult(item));
      }),
    );
    return results.flat();
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
      search: {
        byTitle: true,
        byExternalIds: ["imdb", "tmdb"],
        filterDiscovery: ["year", "genre", "minimumRating"],
      },
      details: { byExternalIds: ["imdb", "tmdb"] },
      features: ["posters", "backdrops", "ratings", "genres", "seasons"],
    },
    search: (query, context) =>
      !query.title && !query.ids?.tmdb && !query.ids?.imdb
        ? discover(query, context)
        : search(query, context),
    getDetails: async (query, context) => {
      const details = await loadDetails(query, context);
      return details ? { provider: NAME, details, source: details.sourceProviders?.[0] } : null;
    },
  };
}

function mapDiscoveryItem(
  record: TmdbRecord,
  type: "movie" | "series",
  requestedGenre: string | undefined,
): MediaDetails | null {
  const id = positiveInteger(record.id);
  const title = (type === "movie" ? record.title : record.name)?.trim();
  const date = type === "movie" ? record.release_date : record.first_air_date;
  const poster = image(record.poster_path, "poster");
  const year = parseYear(date);
  if (!id || !title || !poster || !year) return null;

  const genreNames = (record.genre_ids ?? []).flatMap((genreId) => {
    const name = TMDB_GENRES[type].get(genreId);
    return name ? [name] : [];
  });
  if (requestedGenre && !genreNames.includes(requestedGenre)) genreNames.push(requestedGenre);
  const ids: ExternalIds = { tmdb: id };

  return {
    id: `${NAME}-${type}-${id}`,
    type,
    title,
    originalTitle:
      (type === "movie" ? record.original_title : record.original_name)?.trim() || undefined,
    year,
    releaseDate: validDate(date),
    description: record.overview?.trim() || undefined,
    poster,
    backdrop: image(record.backdrop_path, "backdrop"),
    genres: genreNames.map((name) => ({ name, source: NAME })),
    ratings:
      typeof record.vote_average === "number" && record.vote_average > 0
        ? [{ source: "tmdb", value: record.vote_average, max: 10, votes: record.vote_count }]
        : undefined,
    ids,
    sourceProviders: [
      {
        provider: NAME,
        ids,
        url: `https://www.themoviedb.org/${type === "movie" ? "movie" : "tv"}/${id}`,
      },
    ],
  };
}

function discoverGenreId(type: "movie" | "series", genre: string): number | undefined {
  const normalized = genre
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]+/gu, " ");
  const aliases: Record<string, string[]> =
    type === "movie"
      ? { "sci fi": ["science fiction"] }
      : {
          action: ["action & adventure"],
          adventure: ["action & adventure"],
          fantasy: ["sci-fi & fantasy"],
          "sci fi": ["sci-fi & fantasy"],
          "reality tv": ["reality"],
          "talk show": ["talk"],
          war: ["war & politics"],
        };
  const accepted = new Set([normalized, ...(aliases[normalized] ?? [])]);
  for (const [id, name] of TMDB_GENRES[type]) {
    if (accepted.has(name.toLocaleLowerCase())) return id;
  }
  return undefined;
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
