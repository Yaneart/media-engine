import type { DetailsResponse } from "@media-engine/core";
import type { DetailsQuery } from "@media-engine/core";
import type { MediaAvailability } from "@media-engine/core";
import type { ProviderInfo } from "@media-engine/core";
import type { ProviderHealthStatus } from "@media-engine/core";
import type { SearchResponse } from "@media-engine/core";
import type { SearchQuery } from "@media-engine/core";
import type { StreamQuery } from "@media-engine/core";
import type { StreamingProviderInfo } from "@media-engine/core";
import type { TorrentDiscoveryQuery } from "@media-engine/core";
import type { TorrentDiscoveryResponse } from "@media-engine/core";
import type { TorrentProviderInfo } from "@media-engine/core";

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

export interface MediaEngineLivenessResponse {
  status: "ok";
  service: "media-engine-api";
}

// Provider-aware readiness returned by /health, including partial-service degradation.
// Provider-aware readiness из /health, включая деградацию частично доступного сервиса.
export interface MediaEngineHealthResponse {
  status: "ok" | "degraded";
  service: "media-engine-api";
  providers: ProviderHealthStatus[];
}

export type MediaEngineReadinessResponse = MediaEngineHealthResponse;

// EN: Error thrown by the SDK for failed API responses or invalid payloads.
// RU: Ошибка, которую SDK бросает для неуспешных API responses или неверных payload.
export class MediaEngineApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  // EN: Preserve HTTP status and parsed response body for application-level handling.
  // RU: Сохраняем HTTP status и распарсенное тело ответа для обработки на уровне приложения.
  constructor(message: string, options: { status: number; body?: unknown }) {
    super(message);
    this.name = "MediaEngineApiError";
    this.status = options.status;
    this.body = options.body;
  }
}

const EXTERNAL_ID_KEYS = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
] as const;

const NESTED_EXTERNAL_ID_KEYS = [...EXTERNAL_ID_KEYS, "worldArt"] as const;

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

  // EN: Load merged media details through GET /media/details using namespaced external IDs.
  // RU: Загружает объединенные media details через GET /media/details по внешним ID с namespace.
  getDetails(query: DetailsQuery, options?: MediaEngineRequestOptions): Promise<DetailsResponse> {
    return this.requestJson<DetailsResponse>("/media/details", query, options);
  }

  // EN: Load normalized player and stream availability through GET /media/availability.
  // RU: Загружает нормализованную доступность player и stream через GET /media/availability.
  getAvailability(
    query: StreamQuery,
    options?: MediaEngineRequestOptions,
  ): Promise<MediaAvailability> {
    return this.requestJson<MediaAvailability>("/media/availability", query, options);
  }

  // EN: Discover normalized torrent handoff candidates through GET /media/torrents.
  // RU: Ищет нормализованные torrent handoff кандидаты через GET /media/torrents.
  discoverTorrents(
    query: TorrentDiscoveryQuery,
    options?: MediaEngineRequestOptions,
  ): Promise<TorrentDiscoveryResponse> {
    return this.requestJson<TorrentDiscoveryResponse>("/media/torrents", query, options);
  }

  // EN: List safe provider metadata through GET /providers.
  // RU: Получает безопасные provider metadata через GET /providers.
  getProviders(options?: MediaEngineRequestOptions): Promise<ProviderInfo[]> {
    return this.requestJson<ProviderInfo[]>("/providers", undefined, options);
  }

  // EN: List safe streaming provider metadata through GET /providers/streaming.
  // RU: Получает безопасные metadata streaming-провайдеров через GET /providers/streaming.
  getStreamingProviders(options?: MediaEngineRequestOptions): Promise<StreamingProviderInfo[]> {
    return this.requestJson<StreamingProviderInfo[]>("/providers/streaming", undefined, options);
  }

  // EN: List safe torrent provider metadata through GET /providers/torrent.
  // RU: Получает безопасные metadata torrent-провайдеров через GET /providers/torrent.
  getTorrentProviders(options?: MediaEngineRequestOptions): Promise<TorrentProviderInfo[]> {
    return this.requestJson<TorrentProviderInfo[]>("/providers/torrent", undefined, options);
  }

  // EN: Check API readiness through GET /health.
  // RU: Проверяет готовность API через GET /health.
  getHealth(options?: MediaEngineRequestOptions): Promise<MediaEngineHealthResponse> {
    return this.requestJson<MediaEngineHealthResponse>("/health", undefined, options);
  }

  // EN: Check whether the API process is alive through GET /health/live.
  // RU: Проверяет, жив ли процесс API, через GET /health/live.
  getLiveness(options?: MediaEngineRequestOptions): Promise<MediaEngineLivenessResponse> {
    return this.requestJson<MediaEngineLivenessResponse>("/health/live", undefined, options);
  }

  // EN: Check provider-aware readiness through GET /health/ready.
  // RU: Проверяет provider-aware готовность через GET /health/ready.
  getReadiness(options?: MediaEngineRequestOptions): Promise<MediaEngineReadinessResponse> {
    return this.requestJson<MediaEngineReadinessResponse>("/health/ready", undefined, options);
  }

  // EN: Build an absolute API URL from a relative endpoint path.
  // RU: Собирает абсолютный API URL из относительного endpoint path.
  protected createUrl(path: string): URL {
    return new URL(path.replace(/^\/+/, ""), `${this.baseUrl}/`);
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
    query?: SearchQuery | DetailsQuery | StreamQuery | TorrentDiscoveryQuery,
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

    return parseJsonResponse<T>(response);
  }
}

export type MediaEngineSearchResponse = SearchResponse;
export type MediaEngineDetailsResponse = DetailsResponse;
export type MediaEngineAvailabilityResponse = MediaAvailability;
export type MediaEngineTorrentDiscoveryResponse = TorrentDiscoveryResponse;
export type MediaEngineProviderInfo = ProviderInfo;
export type MediaEngineStreamingProviderInfo = StreamingProviderInfo;
export type MediaEngineTorrentProviderInfo = TorrentProviderInfo;

// EN: Append core search/details/streaming query fields to API URL search params.
// RU: Добавляет поля core search/details/streaming query в API URL search params.
function appendQuery(
  url: URL,
  query: SearchQuery | DetailsQuery | StreamQuery | TorrentDiscoveryQuery,
): void {
  appendParam(url, "title", "title" in query ? query.title : undefined);
  appendParam(url, "type", query.type);
  appendParam(url, "year", "year" in query ? query.year : undefined);
  appendParam(url, "limit", "limit" in query ? query.limit : undefined);
  appendParam(url, "language", query.language);
  appendParam(url, "id", "id" in query ? query.id : undefined);
  appendParam(url, "seasonNumber", "seasonNumber" in query ? query.seasonNumber : undefined);
  appendParam(url, "episodeNumber", "episodeNumber" in query ? query.episodeNumber : undefined);
  appendParam(
    url,
    "absoluteEpisodeNumber",
    "absoluteEpisodeNumber" in query ? query.absoluteEpisodeNumber : undefined,
  );
  appendArrayParam(url, "providers", "providers" in query ? query.providers : undefined);

  for (const key of EXTERNAL_ID_KEYS) {
    appendParam(url, key, query[key]);
  }

  for (const key of NESTED_EXTERNAL_ID_KEYS) {
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

// EN: Append repeated query parameters for list values.
// RU: Добавляет повторяющиеся query параметры для списочных значений.
function appendArrayParam(url: URL, key: string, values: readonly string[] | undefined): void {
  if (!values) {
    return;
  }

  for (const value of values) {
    const serialized = value.trim();

    if (serialized.length > 0) {
      url.searchParams.append(key, serialized);
    }
  }
}

// EN: Parse JSON responses and normalize HTTP or payload failures into typed SDK errors.
// RU: Парсит JSON responses и нормализует HTTP или payload failures в typed SDK errors.
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const { body, invalidJson } = await readResponseBody(response);

  if (!response.ok) {
    throw new MediaEngineApiError(readErrorMessage(response, body), {
      status: response.status,
      body,
    });
  }

  if (invalidJson) {
    throw new MediaEngineApiError("Media Engine API returned invalid JSON.", {
      status: response.status,
      body,
    });
  }

  if (body === undefined) {
    throw new MediaEngineApiError("Media Engine API returned an empty response body.", {
      status: response.status,
    });
  }

  return body as T;
}

// EN: Read JSON when possible without hiding malformed payloads.
// RU: Читает JSON когда возможно, не скрывая поврежденные payload.
async function readResponseBody(
  response: Response,
): Promise<{ body: unknown; invalidJson: boolean }> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return { body: undefined, invalidJson: false };
  }

  try {
    return { body: JSON.parse(text) as unknown, invalidJson: false };
  } catch {
    return { body: text, invalidJson: true };
  }
}

// EN: Prefer structured API error messages when the server provides them.
// RU: Предпочитаем структурированные API error messages, если server их возвращает.
function readErrorMessage(response: Response, body: unknown): string {
  if (isErrorBody(body)) {
    return body.message;
  }

  return `Media Engine API request failed with HTTP ${response.status}.`;
}

// EN: Detect the common NestJS error response shape.
// RU: Определяет распространенную форму NestJS error response.
function isErrorBody(body: unknown): body is { message: string } {
  if (!body || typeof body !== "object") {
    return false;
  }

  const value = body as Record<string, unknown>;

  return typeof value.message === "string";
}
