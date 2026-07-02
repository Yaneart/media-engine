const DEFAULT_API_URL = "http://127.0.0.1:3000";

// EN: Query shape accepted by the example app search form.
// RU: Форма query, которую принимает search form в example app.
export interface SearchFormQuery {
  title: string;
  type: "" | "movie" | "series" | "anime";
}

export type MediaType = "movie" | "series" | "anime";

export interface ExternalIds {
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  worldArt?: string;
}

export interface ImageInfo {
  url: string;
  type?: string;
  width?: number;
  height?: number;
  language?: string;
  source?: string;
}

export interface GenreInfo {
  id?: string;
  name: string;
  source?: string;
}

export interface RatingInfo {
  source: string;
  value: number;
  max: number;
  votes?: number;
}

export interface ProviderSourceInfo {
  provider: string;
  ids?: ExternalIds;
  url?: string;
}

export interface MediaSummary {
  id: string;
  type: MediaType;
  title: string;
  originalTitle?: string;
  alternativeTitles?: string[];
  year?: number;
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
  poster?: ImageInfo;
  backdrop?: ImageInfo;
  genres?: GenreInfo[];
  ratings?: RatingInfo[];
  ids?: ExternalIds;
}

export interface MediaDetails extends MediaSummary {
  status?: string;
  runtimeMinutes?: number;
  countries?: string[];
  languages?: string[];
  images?: ImageInfo[];
  persons?: Array<{
    roles: string[];
    characterName?: string;
    person: {
      name: string;
      originalName?: string;
      photo?: ImageInfo;
    };
  }>;
  sourceProviders?: ProviderSourceInfo[];
  seasonsCount?: number;
  episodesCount?: number;
  animeKind?: string;
  airedOn?: string;
  releasedOn?: string;
  ageRating?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  meta: {
    cached?: boolean;
    tookMs: number;
    providers: {
      requested: string[];
      successful: string[];
      failed: ProviderFailure[];
    };
  };
}

export interface SearchResult {
  item: MediaSummary;
  score: number;
  sources: ProviderSourceInfo[];
}

export interface DetailsResponse {
  details: MediaDetails | null;
  meta: SearchResponse["meta"];
}

export interface ProviderFailure {
  provider: string;
  code: string;
  message: string;
  retryable?: boolean;
}

// EN: Calls the NestJS API search endpoint used by the example app.
// RU: Вызывает search endpoint NestJS API, который использует example app.
export async function searchMedia(
  query: SearchFormQuery,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const url = new URL("/media/search", getApiBaseUrl());

  url.searchParams.set("title", query.title);
  url.searchParams.set("limit", "10");

  if (query.type) {
    url.searchParams.set("type", query.type);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as SearchResponse;
}

// EN: Calls the NestJS API details endpoint for the selected search result.
// RU: Вызывает details endpoint NestJS API для выбранного результата поиска.
export async function getMediaDetails(
  item: MediaSummary,
  signal?: AbortSignal,
): Promise<DetailsResponse> {
  const url = new URL("/media/details", getApiBaseUrl());

  url.searchParams.set("type", item.type);

  if (item.ids) {
    for (const [key, value] of Object.entries(item.ids)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  } else {
    url.searchParams.set("id", item.id);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as DetailsResponse;
}

function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_MEDIA_ENGINE_API_URL;

  return configuredUrl?.trim() || DEFAULT_API_URL;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Search request failed with HTTP ${response.status}.`;

  try {
    const body: unknown = await response.json();

    if (isErrorResponse(body)) {
      return body.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function isErrorResponse(value: unknown): value is { message: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Record<string, unknown>;

  return typeof response.message === "string";
}
