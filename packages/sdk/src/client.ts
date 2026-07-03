import type { DetailsResponse } from "@media-engine/core";
import type { ProviderInfo } from "@media-engine/core";
import type { SearchResponse } from "@media-engine/core";

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

// EN: Placeholder response type for the future health-check method.
// RU: Placeholder тип ответа для будущего health-check метода.
export interface MediaEngineHealthResponse {
  status: string;
}

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

  // EN: Expose request construction for upcoming typed SDK methods.
  // RU: Открываем сборку request для будущих typed SDK методов.
  protected createUrl(path: string): URL {
    return new URL(path, `${this.baseUrl}/`);
  }

  // EN: Expose fetch execution for upcoming search/details/providers/health calls.
  // RU: Открываем выполнение fetch для будущих search/details/providers/health вызовов.
  protected request(input: URL, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(input, {
      ...init,
      headers: {
        Accept: "application/json",
        ...this.headers,
        ...init?.headers,
      },
    });
  }
}

export type MediaEngineSearchResponse = SearchResponse;
export type MediaEngineDetailsResponse = DetailsResponse;
export type MediaEngineProviderInfo = ProviderInfo;
