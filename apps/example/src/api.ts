import { MediaEngineClient } from "@media-engine/sdk";
import type {
  MediaEngineAvailabilityResponse,
  MediaEngineDetailsResponse,
  MediaEngineSearchResponse,
} from "@media-engine/sdk";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

// EN: Query shape accepted by the example app search form.
// RU: Форма query, которую принимает search form в example app.
export interface SearchFormQuery {
  title: string;
  type: "" | "movie" | "series" | "anime";
}

export type SearchResponse = MediaEngineSearchResponse;
export type DetailsResponse = MediaEngineDetailsResponse;
export type AvailabilityResponse = MediaEngineAvailabilityResponse;
export type SearchResult = SearchResponse["results"][number];
export type MediaSummary = SearchResult["item"];
export type MediaDetails = NonNullable<DetailsResponse["details"]>;
export type ExternalIds = NonNullable<MediaSummary["ids"]>;

// EN: Shared SDK client used by the example app browser requests.
// RU: Общий SDK client для browser requests в example app.
const mediaEngineClient = new MediaEngineClient({
  baseUrl: getApiBaseUrl(),
});

// EN: Search media through the public SDK instead of hand-written fetch helpers.
// RU: Ищет media через публичный SDK вместо вручную написанных fetch helpers.
export function searchMedia(query: SearchFormQuery, signal?: AbortSignal): Promise<SearchResponse> {
  return mediaEngineClient.search(
    {
      title: query.title,
      type: query.type || undefined,
      limit: 10,
    },
    { signal },
  );
}

// EN: Load details for the selected result through the public SDK.
// RU: Загружает детали выбранного результата через публичный SDK.
export function getMediaDetails(
  item: MediaSummary,
  signal?: AbortSignal,
): Promise<DetailsResponse> {
  return mediaEngineClient.getDetails(
    {
      type: item.type,
      ids: item.ids,
    },
    { signal },
  );
}

// EN: Load player availability for the selected result through the public SDK.
// RU: Загружает доступность плееров выбранного результата через публичный SDK.
export function getMediaAvailability(
  item: MediaSummary,
  signal?: AbortSignal,
): Promise<AvailabilityResponse> {
  return mediaEngineClient.getAvailability(
    {
      type: item.type,
      title: item.title,
      year: item.year,
      ids: item.ids,
    },
    { signal },
  );
}

function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_MEDIA_ENGINE_API_URL;

  return configuredUrl?.trim() || DEFAULT_API_URL;
}
