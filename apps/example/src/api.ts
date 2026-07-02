const DEFAULT_API_URL = "http://127.0.0.1:3000";

// EN: Query shape accepted by the example app search form.
// RU: Форма query, которую принимает search form в example app.
export interface SearchFormQuery {
  title: string;
  type: "" | "movie" | "series" | "anime";
}

// EN: Minimal response shape consumed by the search UI before the details task.
// RU: Минимальная форма ответа, которую использует search UI до задачи с details.
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
  item: {
    id: string;
    type: "movie" | "series" | "anime";
    title: string;
    year?: number;
  };
  score: number;
  sources: Array<{
    provider: string;
  }>;
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
