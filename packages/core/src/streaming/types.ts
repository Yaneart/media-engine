import type { ExternalIds, MediaType } from "../media/index.js";
import type { ExternalIdSource, ProviderContext } from "../providers/index.js";

// Query that identifies one media item or episode for streaming lookup.
// Запрос, который определяет медиа или эпизод для поиска streaming-вариантов.
export interface StreamQuery {
  type: MediaType;
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  title?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  providers?: string[];
  language?: string;
}

// Compact media identity included in streaming responses.
// Компактная идентификация медиа в streaming-ответах.
export interface StreamMediaItem {
  type: MediaType;
  title?: string;
  originalTitle?: string;
  year?: number;
  ids?: ExternalIds;
}

// Episode identity used when a stream belongs to one series or anime episode.
// Идентификация эпизода, если stream относится к серии сериала или аниме.
export interface StreamEpisodeRef {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
}

// Episode-level availability block for providers that return episode maps.
// Блок доступности эпизода для провайдеров, которые возвращают карту эпизодов.
export interface StreamEpisodeAvailability extends StreamEpisodeRef {
  title?: string;
  options: StreamOption[];
}

// Type of player target the application can render or open.
// Тип player-цели, которую приложение может отрисовать или открыть.
export type PlayerSourceKind = "embed" | "hls" | "mp4" | "external";

// Player label and provider-specific player identity for UI selection.
// Название player и провайдерская идентификация для выбора в UI.
export interface PlayerSource {
  kind: PlayerSourceKind;
  label: string;
  providerPlayerId?: string;
}

// Playable access target returned only when it is safe to expose.
// Цель доступа к проигрыванию, возвращаемая только когда ее безопасно раскрывать.
export interface StreamAccess {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  referer?: string;
}

// Normalized translation or voice/subtitle variant.
// Нормализованный вариант перевода, озвучки или субтитров.
export interface TranslationInfo {
  id?: string;
  title: string;
  type: "dub" | "voiceover" | "subtitles" | "original" | "unknown";
  language?: string;
  team?: string;
}

// Normalized quality metadata used for filtering and labels.
// Нормализованные данные качества для фильтрации и подписей.
export interface QualityInfo {
  label: string;
  height?: number;
  width?: number;
  bitrateKbps?: number;
  codec?: string;
}

// Subtitle file format exposed by a streaming provider.
// Формат файла субтитров, который возвращает streaming-провайдер.
export type SubtitleFormat = "vtt" | "srt" | "ass" | "unknown";

// Optional subtitle track attached to one stream option.
// Опциональная дорожка субтитров, привязанная к одному stream-варианту.
export interface SubtitleTrack {
  language?: string;
  label?: string;
  format?: SubtitleFormat;
  url?: string;
}

// Optional audio track metadata attached to one stream option.
// Опциональные метаданные аудиодорожки для одного stream-варианта.
export interface AudioTrack {
  language?: string;
  label?: string;
  codec?: string;
}

// Availability state reported for one stream option.
// Статус доступности одного stream-варианта.
export type StreamAvailabilityStatus =
  "available" | "region_locked" | "temporarily_unavailable" | "requires_account" | "unknown";

// One selectable player or stream candidate returned by a provider.
// Один выбираемый player или stream-кандидат от провайдера.
export interface StreamOption {
  id: string;
  provider: string;
  player: PlayerSource;
  translation?: TranslationInfo;
  quality?: QualityInfo;
  subtitles?: SubtitleTrack[];
  audio?: AudioTrack[];
  episode?: StreamEpisodeRef;
  access: StreamAccess;
  availability: StreamAvailabilityStatus;
  expiresAt?: string;
  sourceUrl?: string;
}

// Source attribution for streaming availability data.
// Атрибуция источника для данных streaming-доступности.
export interface StreamingProviderSource {
  provider: string;
  url?: string;
  ids?: ExternalIds;
}

// Top-level normalized availability result for one streaming lookup.
// Верхнеуровневый нормализованный результат доступности для streaming-запроса.
export interface MediaAvailability {
  query: StreamQuery;
  item?: StreamMediaItem;
  episodes?: StreamEpisodeAvailability[];
  options: StreamOption[];
  sourceProviders: StreamingProviderSource[];
  checkedAt: string;
}

// Streaming provider features used by UI and engine selection.
// Возможности streaming-провайдера для UI и выбора движком.
export type StreamingProviderFeature =
  | "embed"
  | "hls"
  | "mp4"
  | "external"
  | "translations"
  | "subtitles"
  | "qualities"
  | "episode_mapping"
  | "headers";

// Capabilities used to select streaming providers for a stream query.
// Возможности, по которым выбираются streaming-провайдеры для stream-запроса.
export interface StreamingProviderCapabilities {
  mediaTypes: MediaType[];
  lookup: {
    byTitle: boolean;
    byExternalIds: ExternalIdSource[];
    byEpisode: boolean;
  };
  features?: StreamingProviderFeature[];
}

// Safe streaming provider metadata exposed by public APIs.
// Безопасные метаданные streaming-провайдера для публичных API.
export interface StreamingProviderInfo {
  name: string;
  version?: string;
  kind: "streaming";
  capabilities: StreamingProviderCapabilities;
}

// Streaming provider contract implemented outside of core.
// Контракт streaming-провайдера, реализуемый вне core.
export interface StreamingProvider {
  name: string;
  version?: string;
  kind: "streaming";
  capabilities: StreamingProviderCapabilities;

  getAvailability(query: StreamQuery, context: ProviderContext): Promise<MediaAvailability | null>;
}
