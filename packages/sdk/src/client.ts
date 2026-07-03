import type { DetailsResponse } from "@media-engine/core";
import type { DetailsQuery } from "@media-engine/core";
import type { ProviderInfo } from "@media-engine/core";
import type { SearchResponse } from "@media-engine/core";
import type { SearchQuery } from "@media-engine/core";

// EN: Fetch-compatible function accepted by the SDK for browser, Node, and tests.
// RU: Fetch-compatible функция, которую SDK принимает для browser, Node и tests.
export type MediaEngineFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

// EN: Construction options for a framework-independent Media Engine HTTP client.
// RU: Опции создания framework-independent HTTP client для Media Engine.
export interface MediaEngineClientOptions {
  baseUrl: string;
  fetch?: MediaEngineFetch;
  headers?: HeadersInit;
}

// EN: Per-request options shared by all SDK methods.
// RU: Опции одного request, общие для всех методов SDK.
export interface MediaEngineRequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

// EN: Stable response returned by the API health endpoint.
// RU: Стабильный ответ, который возвращает API health endpoint.
export interface MediaEngineHealthResponse {
  status: "ok";
  service: "media-engine-api";
}

const EXTERNAL_ID_KEYS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
] as const;

// EN: Typed HTTP client entry point for applications using Media Engine API.
// RU: Типизированная точка входа HTTP client для приложений, использующих Media Engine API.
export class MediaEngineClient {
  readonly baseUrl: string;

  private readonly fetchImpl: MediaEngineFetch;
  private readonly headers?: HeadersInit;

  // EN: Store normalized client options without depending on any app framework.
  // RU: Сохраняем нормализованные опции client без зависимости от app framework.
  constructor(options: MediaEngineClientOptions) {
    const baseUrl = options.baseUrl.trim();

    if (!baseUrl) {
      throw new Error("MediaEngineClient baseUrl must not be empty.");
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers;
  }

  // EN: Search media metadata through GET /media/search.
  // RU: Ищет media metadata через GET /media/search.
  search(query: SearchQuery, options?: MediaEngineRequestOptions): Promise<SearchResponse> {
    return this.requestJson<SearchResponse>("/media/search", query, options);
  }

  // EN: Load merged media details through GET /media/details.
  // RU: Загружает объединенные media details через GET /media/details.
  getDetails(query: DetailsQuery, options?: MediaEngineRequestOptions): Promise<DetailsResponse> {
    return this.requestJson<DetailsResponse>("/media/details", query, options);
  }

  // EN: List safe provider metadata through GET /providers.
  // RU: Получает безопасные provider metadata через GET /providers.
  getProviders(options?: MediaEngineRequestOptions): Promise<ProviderInfo[]> {
    return this.requestJson<ProviderInfo[]>("/providers", undefined, options);
  }

  // EN: Check API readiness through GET /health.
  // RU: Проверяет готовность API через GET /health.
  getHealth(options?: MediaEngineRequestOptions): Promise<MediaEngineHealthResponse> {
    return this.requestJson<MediaEngineHealthResponse>("/health", undefined, options);
  }

  // EN: Build an absolute API URL from a relative endpoint path.
  // RU: Собирает абсолютный API URL из относительного endpoint path.
  protected createUrl(path: string): URL {
    return new URL(path, `${this.baseUrl}/`);
  }

  // EN: Execute fetch with JSON defaults and configured client headers.
  // RU: Выполняет fetch с JSON defaults и настроенными headers клиента.
  protected request(input: URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(this.headers);
    const initHeaders = new Headers(init?.headers);

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    return this.fetchImpl(input, {
      ...init,
      headers,
    });
  }

  // EN: Run a GET request and parse its JSON response as the expected SDK type.
  // RU: Выполняет GET request и парсит JSON response как ожидаемый SDK type.
  private async requestJson<T>(
    path: string,
    query?: SearchQuery | DetailsQuery,
    options?: MediaEngineRequestOptions,
  ): Promise<T> {
    const url = this.createUrl(path);

    if (query) {
      appendQuery(url, query);
    }

    const response = await this.request(url, {
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });

    if (!response.ok) {
      throw new Error(`Media Engine API request failed with HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  }
}

export type MediaEngineSearchResponse = SearchResponse;
export type MediaEngineDetailsResponse = DetailsResponse;
export type MediaEngineProviderInfo = ProviderInfo;

// EN: Append core search/details query fields to API URL search params.
// RU: Добавляет поля core search/details query в API URL search params.
function appendQuery(url: URL, query: SearchQuery | DetailsQuery): void {
  appendParam(url, "title", "title" in query ? query.title : undefined);
  appendParam(url, "type", query.type);
  appendParam(url, "year", "year" in query ? query.year : undefined);
  appendParam(url, "limit", "limit" in query ? query.limit : undefined);
  appendParam(url, "language", query.language);
  appendParam(url, "id", "id" in query ? query.id : undefined);

  for (const key of EXTERNAL_ID_KEYS) {
    appendParam(url, key, query[key]);
    appendParam(url, `ids.${key}`, query.ids?.[key]);
  }
}

// EN: Append one non-empty primitive query value.
// RU: Добавляет одно непустое primitive query значение.
function appendParam(url: URL, key: string, value: number | string | undefined): void {
  if (value === undefined) {
    return;
  }

  const serialized = String(value).trim();

  if (serialized.length > 0) {
    url.searchParams.set(key, serialized);
  }
}
