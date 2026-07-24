import { MediaEngineClient } from "@media-engine/sdk";
import type {
  MediaEngineAvailabilityResponse,
  MediaEngineDetailsResponse,
  MediaEngineSearchResponse,
  MediaEngineTorrentDiscoveryResponse,
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
export type TorrentResponse = MediaEngineTorrentDiscoveryResponse;
export type SearchResult = SearchResponse["results"][number];
export type MediaSummary = SearchResult["item"];
export type MediaDetails = NonNullable<DetailsResponse["details"]>;
export type TorrentCandidate = TorrentResponse["candidates"][number];
export type AvailabilityMediaInput = Pick<
  MediaSummary,
  "type" | "title" | "originalTitle" | "year" | "ids"
> & {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
};
export type TorrentMediaInput = AvailabilityMediaInput;
export type ExternalIds = NonNullable<MediaSummary["ids"]>;

// EN: Shared SDK client used by the example app browser requests.
// RU: Общий SDK client для browser requests в example app.
const mediaEngineClient = new MediaEngineClient({
  baseUrl: getApiBaseUrl(),
});

// EN: Search media through the public SDK instead of hand-written fetch helpers.
// RU: Ищет media через публичный SDK вместо вручную написанных fetch helpers.
export function searchMedia(query: SearchFormQuery, signal?: AbortSignal): Promise<SearchResponse> {
  const language = inferTitleLanguage(query.title);

  return mediaEngineClient.search(
    {
      title: query.title,
      type: query.type || undefined,
      limit: 10,
      language,
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
  const language = inferTitleLanguage(item.title);

  return mediaEngineClient.getDetails(
    {
      type: item.type,
      ids: item.ids,
      language,
    },
    { signal },
  );
}

// EN: Load player availability for the selected result through the public SDK.
// RU: Загружает доступность плееров выбранного результата через публичный SDK.
export function getMediaAvailability(
  item: AvailabilityMediaInput,
  signal?: AbortSignal,
): Promise<AvailabilityResponse> {
  const language = inferTitleLanguage(item.title);

  return mediaEngineClient.getAvailability(
    {
      type: item.type,
      title: item.originalTitle?.trim() || item.title,
      year: item.year,
      ids: item.ids,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      absoluteEpisodeNumber: item.absoluteEpisodeNumber,
      language,
    },
    { signal },
  );
}

// EN: Discover torrent handoff candidates only after an explicit user action.
// RU: Ищет torrent handoff кандидаты только после явного действия пользователя.
export function discoverMediaTorrents(
  item: TorrentMediaInput,
  signal?: AbortSignal,
): Promise<TorrentResponse> {
  const language = inferTitleLanguage(item.title);

  return mediaEngineClient.discoverTorrents(
    {
      type: item.type,
      title: item.originalTitle?.trim() || item.title,
      year: item.year,
      ids: item.ids,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      absoluteEpisodeNumber: item.absoluteEpisodeNumber,
      language,
      limit: 50,
    },
    { signal },
  );
}

// Keeps display metadata in the same language as the title entered or selected by the user.
export function inferTitleLanguage(title: string): "ru" | "ja" | "en" {
  if (/[а-яё]/iu.test(title)) return "ru";
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(title)) return "ja";
  return "en";
}

function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_MEDIA_ENGINE_API_URL;

  return configuredUrl?.trim() || DEFAULT_API_URL;
}
