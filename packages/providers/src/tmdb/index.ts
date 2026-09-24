import type {
  MediaDetails,
  MediaItem,
  MediaProvider,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderSearchQuery,
  ProviderSearchResult,
} from "@media-engine/core";
import {
  fetchJson,
  getProviderHttpStatus,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import { createProviderImage } from "../shared/mapping.js";

const NAME = "tmdb";
const DEFAULT_BASE_URL = "https://tmdb.stremio.ru";
const PAGE_SIZE = 20;
const MAX_PAGES = 13;
const GENRE_ALIASES: Record<string, string> = {
  war: "военный",
  военные: "военный",
  военный: "военный",
  action: "боевик",
  adventure: "приключения",
  animation: "мультфильм",
  comedy: "комедия",
  crime: "криминал",
  documentary: "документальный",
  drama: "драма",
  family: "семейный",
  fantasy: "фэнтези",
  history: "история",
  horror: "ужасы",
  mystery: "детектив",
  romance: "мелодрама",
  "science fiction": "фантастика",
  thriller: "триллер",
};

interface AddonMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  description?: string;
  genre?: string[];
  genres?: string[];
  poster?: string;
  background?: string;
  releaseInfo?: string;
  released?: string;
  year?: number | string;
  imdbRating?: string;
}
interface AddonCatalog {
  metas?: AddonMeta[];
}
interface AddonDetails {
  meta?: AddonMeta;
}

export interface TmdbProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

// Reads localized public Stremio TMDB addon routes without user credentials.
export function tmdbProvider(options: TmdbProviderOptions = {}): MediaProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const gate = new ProviderRateLimitGate();

  async function request<T>(path: string, context: ProviderContext): Promise<T> {
    return fetchJson<T>({
      provider: NAME,
      url: new URL(`${baseUrl}${path}`),
      context,
      fetch: options.fetch,
      rateLimitGate: gate,
    });
  }

  async function loadDetails(
    query: ProviderDetailsQuery,
    context: ProviderContext,
  ): Promise<MediaDetails | null> {
    if (query.type !== "movie" && query.type !== "series") return null;
    const id = query.ids?.imdb ?? (query.ids?.tmdb ? `tmdb:${query.ids.tmdb}` : undefined);
    if (!id || !/^(?:tt\d{7,12}|tmdb:\d+)$/u.test(id)) return null;
    const language = locale(context.language ?? query.language);
    const path = `/meta/${query.type}/${encodeURIComponent(id)}.json`;
    let response: AddonDetails;
    try {
      response = await request<AddonDetails>(`/${language}${path}`, context);
    } catch (error) {
      if (getProviderHttpStatus(error) === 404) return null;
      throw error;
    }
    const localized = response.meta;
    if (!localized || localized.type !== query.type) return null;
    const item = mapItem(localized, query.type);
    if (
      !item ||
      (query.ids?.tmdb && query.ids.tmdb !== item.ids?.tmdb) ||
      (query.ids?.imdb && query.ids.imdb !== localized.imdb_id)
    )
      return null;

    if (language !== "en-US" && (!item.description || !item.genres?.length)) {
      try {
        const fallback = (await request<AddonDetails>(`/en-US${path}`, context)).meta;
        if (fallback && fallback.id === localized.id && fallback.type === localized.type) {
          item.description ||= fallback.description?.trim() || undefined;
          item.genres ||= mapGenres(fallback);
        }
      } catch (error) {
        if (context.signal?.aborted) throw error;
      }
    }
    item.ids = { ...item.ids, imdb: query.ids?.imdb ?? localized.imdb_id };
    return { ...item, type: query.type, sourceProviders: [source(item)] } as MediaDetails;
  }

  async function search(
    query: ProviderSearchQuery,
    context: ProviderContext,
  ): Promise<ProviderSearchResult[]> {
    if (query.type === "anime") return [];
    if (query.ids?.imdb || query.ids?.tmdb) {
      const types = query.type ? [query.type] : (["movie", "series"] as const);
      const found = await Promise.all(
        types.map((type) => loadDetails({ ...query, type }, context)),
      );
      const matches = found.filter((item): item is MediaDetails => Boolean(item));
      return matches.length === 1 ? [result(matches[0]!)] : [];
    }
    const language = locale(context.language ?? query.language);
    const types = query.type ? [query.type] : (["movie", "series"] as const);
    const target = Math.min(query.limit ?? PAGE_SIZE, MAX_PAGES * PAGE_SIZE);
    const results: ProviderSearchResult[] = [];
    for (const type of types) {
      let typeResults = 0;
      const catalog = query.title
        ? "tmdb.search"
        : query.year && !query.genre
          ? "tmdb.year"
          : "tmdb.top";
      const extra = query.title
        ? `search=${encodeURIComponent(query.title)}`
        : query.genre
          ? `genre=${encodeURIComponent(localizeGenre(query.genre, language))}`
          : catalog === "tmdb.year"
            ? `genre=${query.year}`
            : undefined;
      for (let page = 0; page < MAX_PAGES && typeResults < target; page++) {
        const params = [extra, page ? `skip=${page * PAGE_SIZE}` : undefined]
          .filter(Boolean)
          .join("&");
        const suffix = params ? `/${params}` : "";
        const response = await request<AddonCatalog>(
          `/${language}/catalog/${type}/${catalog}${suffix}.json`,
          context,
        );
        const metas = response.metas ?? [];
        for (const meta of metas) {
          if (typeResults >= target) break;
          const item = mapItem(meta, type);
          if (
            !item ||
            (query.year !== undefined && item.year !== query.year) ||
            (query.genre &&
              !item.genres?.some(
                (genre) => genreIdentity(genre.name) === genreIdentity(query.genre!),
              )) ||
            (query.minimumRating !== undefined &&
              !item.ratings?.some((rating) => rating.value >= query.minimumRating!))
          )
            continue;
          results.push(result(item));
          typeResults += 1;
        }
        if (metas.length < PAGE_SIZE) break;
      }
    }
    return results;
  }

  return {
    name: NAME,
    kind: "metadata",
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["movie", "series"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb", "tmdb"],
        filterDiscovery: ["year", "genre", "minimumRating"],
      },
      details: { byExternalIds: ["imdb", "tmdb"] },
      features: ["posters", "backdrops", "ratings", "genres"],
    },
    search,
    getDetails: async (query, context) => {
      const details = await loadDetails(query, context);
      return details ? { provider: NAME, details, source: source(details) } : null;
    },
  };
}

function mapItem(meta: AddonMeta, type: "movie" | "series"): MediaItem | null {
  const match = /^tmdb:(\d+)$/u.exec(meta.id ?? "");
  if (!match || !meta.name?.trim() || (meta.type && meta.type !== type)) return null;
  const year = Number(String(meta.year ?? meta.releaseInfo ?? meta.released ?? "").slice(0, 4));
  const rating = Number(meta.imdbRating);
  return {
    id: `${NAME}-${type}-${match[1]}`,
    type,
    title: meta.name.trim(),
    year: Number.isInteger(year) && year > 1800 ? year : undefined,
    description: meta.description?.trim() || undefined,
    poster: createProviderImage(meta.poster, "poster", NAME),
    backdrop: createProviderImage(meta.background, "backdrop", NAME),
    genres: mapGenres(meta),
    ratings:
      Number.isFinite(rating) && rating > 0 && rating <= 10
        ? [{ source: "imdb", value: rating, max: 10 }]
        : undefined,
    ids: { tmdb: match[1], imdb: meta.imdb_id || undefined },
  };
}

function mapGenres(meta: AddonMeta) {
  return (meta.genres ?? meta.genre)
    ?.filter((name) => Boolean(name?.trim()))
    .map((name) => ({
      name: name.trim().toLocaleLowerCase() === "военный" ? "Военные" : name.trim(),
      source: NAME,
    }));
}

function source(item: MediaItem) {
  return {
    provider: NAME,
    ids: item.ids,
    url: `https://www.themoviedb.org/${item.type === "movie" ? "movie" : "tv"}/${item.ids?.tmdb}`,
  };
}

function result(item: MediaItem): ProviderSearchResult {
  return { provider: NAME, item, source: source(item) };
}

function locale(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase();
  return normalized?.startsWith("ru") ? "ru-RU" : "en-US";
}

function genreIdentity(name: string): string {
  const normalized = name.trim().toLocaleLowerCase();
  return GENRE_ALIASES[normalized] ?? normalized;
}

function localizeGenre(name: string, language: string): string {
  return language === "ru-RU" ? (GENRE_ALIASES[name.trim().toLocaleLowerCase()] ?? name) : name;
}
