import type {
  AnimeDetails,
  AnimeKind,
  ExternalIds,
  Genre,
  Image,
  MediaItem,
  MediaProvider,
  MediaStatus,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "anilist";
const DEFAULT_BASE_URL = "https://graphql.anilist.co";
const DEFAULT_SEARCH_LIMIT = 10;
const MEDIA_FIELDS = `
  id idMal title { romaji english native } synonyms format status episodes duration
  startDate { year month day } endDate { year month day }
  description(asHtml: false) averageScore popularity isAdult countryOfOrigin
  coverImage { extraLarge large } genres siteUrl
`;

export interface AniListProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  searchLimit?: number;
  includeAdult?: boolean;
}

interface AniListConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  searchLimit: number;
  includeAdult: boolean;
}

interface GraphQlResponse {
  data?: { Page?: { media?: AniListMedia[] }; Media?: AniListMedia | null };
  errors?: Array<{ message?: string }>;
}

interface AniListMedia {
  id?: number;
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[];
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  startDate?: AniListDate;
  endDate?: AniListDate;
  description?: string | null;
  averageScore?: number | null;
  popularity?: number | null;
  isAdult?: boolean;
  countryOfOrigin?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null };
  genres?: string[];
  siteUrl?: string | null;
}

interface AniListDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

// Creates a public no-token AniList anime metadata provider.
// Создает публичный no-token AniList anime metadata provider.
export function aniListProvider(options: AniListProviderOptions = {}): MediaProvider {
  const config: AniListConfig = {
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetch: options.fetch,
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    includeAdult: options.includeAdult ?? false,
  };

  if (!Number.isInteger(config.searchLimit) || config.searchLimit <= 0 || config.searchLimit > 50) {
    throw new RangeError("AniList searchLimit must be an integer between 1 and 50.");
  }

  return {
    name: PROVIDER_NAME,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["anime"],
      search: { byTitle: true, byExternalIds: ["aniList", "myAnimeList"] },
      details: { byExternalIds: ["aniList", "myAnimeList"] },
      features: ["posters", "ratings", "genres"],
    },
    search: (query, context) => searchAniList(config, query, context),
    getDetails: (query, context) => getAniListDetails(config, query, context),
  };
}

async function searchAniList(
  config: AniListConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type && query.type !== "anime") return [];

  if (query.ids?.aniList || query.ids?.myAnimeList) {
    const details = await loadDetails(config, query.ids, context);
    return details ? [toSearchResult(details, context.debug)] : [];
  }

  if (!query.title?.trim()) return [];

  const response = await request(
    config,
    `query ($search: String!, $perPage: Int!, $isAdult: Boolean) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME, isAdult: $isAdult, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
      }
    }`,
    {
      search: query.title,
      perPage: Math.min(query.limit ?? config.searchLimit, 50),
      isAdult: config.includeAdult ? undefined : false,
    },
    context,
  );

  return (response.data?.Page?.media ?? [])
    .map(mapMediaItem)
    .filter((item): item is MediaItem => item !== undefined)
    .filter((item) => query.year === undefined || item.year === query.year)
    .map((item) => toSearchResult(item, context.debug));
}

async function getAniListDetails(
  config: AniListConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (query.type && query.type !== "anime") return null;
  const details = await loadDetails(config, query.ids ?? {}, context);
  return details
    ? {
        provider: PROVIDER_NAME,
        details,
        confidence: 1,
        source: createSource(details.ids),
        raw: context.debug ? details : undefined,
      }
    : null;
}

async function loadDetails(
  config: AniListConfig,
  ids: ExternalIds,
  context: ProviderContext,
): Promise<AnimeDetails | null> {
  if (!ids.aniList && !ids.myAnimeList) return null;
  const response = await request(
    config,
    `query ($id: Int, $idMal: Int) { Media(id: $id, idMal: $idMal, type: ANIME) { ${MEDIA_FIELDS} } }`,
    {
      id: ids.aniList ? Number(ids.aniList) : undefined,
      idMal: !ids.aniList && ids.myAnimeList ? Number(ids.myAnimeList) : undefined,
    },
    context,
  );
  const media = response.data?.Media;
  const item = media ? mapMediaItem(media) : undefined;
  return item && media ? mapDetails(item, media) : null;
}

function mapMediaItem(media: AniListMedia): MediaItem | undefined {
  if (!media.id || (!media.title?.romaji && !media.title?.english)) return undefined;
  const title = media.title.english?.trim() || media.title.romaji!;
  const candidates = [
    media.title.romaji,
    media.title.english,
    media.title.native,
    ...(media.synonyms ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
  const alternativeTitles = [...new Set(candidates)].filter((value) => value !== title);
  const releaseDate = formatDate(media.startDate);

  return {
    id: `${PROVIDER_NAME}-anime-${media.id}`,
    type: "anime",
    title,
    originalTitle: media.title.romaji ?? undefined,
    alternativeTitles: alternativeTitles.length ? alternativeTitles : undefined,
    year: media.startDate?.year ?? undefined,
    releaseDate,
    description: media.description?.trim() || undefined,
    poster: mapPoster(media.coverImage),
    genres: mapGenres(media.genres),
    ratings: mapRating(media),
    ids: { aniList: String(media.id), myAnimeList: media.idMal ? String(media.idMal) : undefined },
  };
}

function mapDetails(item: MediaItem, media: AniListMedia): AnimeDetails {
  return {
    ...item,
    type: "anime",
    status: mapStatus(media.status),
    runtimeMinutes: media.duration ?? undefined,
    countries: media.countryOfOrigin ? [media.countryOfOrigin] : undefined,
    languages: media.countryOfOrigin === "JP" ? ["ja"] : undefined,
    sourceProviders: [createSource(item.ids)],
    animeKind: mapKind(media.format),
    episodesCount: media.episodes ?? undefined,
    airedOn: formatDate(media.startDate),
    releasedOn: formatDate(media.endDate),
  };
}

function toSearchResult(item: MediaItem, debug: boolean | undefined): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    confidence: 1,
    source: createSource(item.ids),
    raw: debug ? item : undefined,
  };
}

function createSource(ids: ExternalIds | undefined): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: ids?.aniList ? `https://anilist.co/anime/${ids.aniList}` : undefined,
  };
}

function mapPoster(image: AniListMedia["coverImage"]): Image | undefined {
  const url = image?.extraLarge ?? image?.large;
  return url ? { url, type: "poster", source: PROVIDER_NAME } : undefined;
}

function mapGenres(values: string[] | undefined): Genre[] | undefined {
  return values?.length ? values.map((name) => ({ name, source: PROVIDER_NAME })) : undefined;
}

function mapRating(media: AniListMedia): Rating[] | undefined {
  return media.averageScore
    ? [
        {
          source: "aniList",
          value: media.averageScore,
          max: 100,
          votes: media.popularity ?? undefined,
        },
      ]
    : undefined;
}

function mapStatus(status: string | null | undefined): MediaStatus | undefined {
  if (status === "RELEASING") return "ongoing";
  if (status === "FINISHED") return "ended";
  if (status === "NOT_YET_RELEASED") return "announced";
  if (status === "CANCELLED") return "canceled";
  return undefined;
}

function mapKind(format: string | null | undefined): AnimeKind | undefined {
  if (format === "TV" || format === "TV_SHORT") return "tv";
  if (format === "MOVIE") return "movie";
  if (format === "OVA") return "ova";
  if (format === "ONA") return "ona";
  if (format === "SPECIAL") return "special";
  if (format === "MUSIC") return "music";
  return format ? "unknown" : undefined;
}

function formatDate(date: AniListDate | undefined): string | undefined {
  if (!date?.year) return undefined;
  return [date.year, date.month ?? 1, date.day ?? 1]
    .map((value, index) => (index ? String(value).padStart(2, "0") : String(value)))
    .join("-");
}

async function request(
  config: AniListConfig,
  query: string,
  variables: Record<string, unknown>,
  context: ProviderContext,
): Promise<GraphQlResponse> {
  const response = await fetchJson<GraphQlResponse>({
    provider: PROVIDER_NAME,
    url: config.baseUrl,
    context,
    fetch: config.fetch,
    init: {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
  });

  if (response.errors?.length)
    throw new Error(response.errors[0]?.message ?? "AniList GraphQL error.");
  return response;
}
