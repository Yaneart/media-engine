import type { ExternalIds, MediaType } from "../media/index.js";
import type { ExternalIdSource, ProviderContext } from "../providers/index.js";
import type { ResponseMeta } from "../response/index.js";

// Query that identifies one media item or episode for torrent discovery.
// Запрос, который определяет медиа или эпизод для поиска torrent-кандидатов.
export interface TorrentDiscoveryQuery {
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
  limit?: number;
}

// Compact media identity included in torrent discovery responses.
// Компактная идентификация медиа в torrent discovery ответах.
export interface TorrentMediaItem {
  type: MediaType;
  title?: string;
  originalTitle?: string;
  year?: number;
  ids?: ExternalIds;
}

// Episode identity associated with an exact or multi-episode torrent candidate.
// Идентификация эпизода, связанная с точным или многоэпизодным torrent-кандидатом.
export interface TorrentEpisodeRef {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  episodeNumberEnd?: number;
  absoluteEpisodeNumberEnd?: number;
}

// One file advertised by a torrent source without reading torrent payloads in core.
// Один файл, объявленный torrent-источником без чтения torrent payload в core.
export interface TorrentFile {
  index?: number;
  path: string;
  sizeBytes?: number;
  mediaType?: "video" | "audio" | "subtitle" | "other";
}

// Normalized release characteristics used for filtering and presentation.
// Нормализованные характеристики релиза для фильтрации и отображения.
export interface TorrentReleaseInfo {
  source?: "bluray" | "web" | "hdtv" | "dvd" | "cam" | "unknown";
  resolution?: string;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  hdr?: string[];
  audioLanguages?: string[];
  subtitleLanguages?: string[];
}

// Best-effort peer counts observed by a discovery source.
// Best-effort счетчики пиров, наблюдаемые discovery-источником.
export interface TorrentPeerInfo {
  seeders?: number;
  leechers?: number;
  checkedAt?: string;
}

// Handoff kind understood by a consuming torrent runtime or browser.
// Тип handoff, понятный torrent runtime потребителя или браузеру.
export type TorrentHandoffKind = "magnet" | "torrent_file" | "external";

// Opaque handoff data returned to the consumer; core never opens or downloads it.
// Непрозрачные handoff-данные для потребителя; core их не открывает и не загружает.
export interface TorrentHandoff {
  kind: TorrentHandoffKind;
  uri: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  referer?: string;
}

// Availability confidence reported by a torrent discovery source.
// Уверенность в доступности, сообщаемая torrent discovery источником.
export type TorrentAvailabilityStatus = "available" | "unseeded" | "unknown";

// One normalized torrent candidate returned by a provider.
// Один нормализованный torrent-кандидат, возвращаемый провайдером.
export interface TorrentCandidate {
  id: string;
  provider: string;
  title: string;
  infoHash?: string;
  sizeBytes?: number;
  publishedAt?: string;
  episode?: TorrentEpisodeRef;
  files?: TorrentFile[];
  release?: TorrentReleaseInfo;
  peers?: TorrentPeerInfo;
  handoff: TorrentHandoff;
  availability: TorrentAvailabilityStatus;
  expiresAt?: string;
  sourceUrl?: string;
}

// Source attribution for torrent discovery data.
// Атрибуция источника torrent discovery данных.
export interface TorrentProviderSource {
  provider: string;
  url?: string;
  ids?: ExternalIds;
}

// Top-level normalized result for one torrent discovery operation.
// Верхнеуровневый нормализованный результат одной torrent discovery операции.
export interface TorrentDiscoveryResponse {
  query: TorrentDiscoveryQuery;
  item?: TorrentMediaItem;
  candidates: TorrentCandidate[];
  sourceProviders: TorrentProviderSource[];
  checkedAt: string;
  meta?: ResponseMeta;
}

// Torrent provider features used by consumers and engine selection.
// Возможности torrent-провайдера для потребителей и выбора движком.
export type TorrentProviderFeature =
  "magnet" | "torrent_file" | "external" | "file_list" | "peer_stats" | "release_metadata";

// Capabilities used to select torrent providers for a discovery query.
// Возможности, по которым выбираются torrent-провайдеры для discovery-запроса.
export interface TorrentProviderCapabilities {
  mediaTypes: MediaType[];
  lookup: {
    byTitle: boolean;
    byExternalIds: ExternalIdSource[];
    byEpisode: boolean;
  };
  features?: TorrentProviderFeature[];
}

// Safe torrent provider metadata exposed by public APIs.
// Безопасные метаданные torrent-провайдера для публичных API.
export interface TorrentProviderInfo {
  name: string;
  version?: string;
  kind: "torrent";
  capabilities: TorrentProviderCapabilities;
}

// Torrent discovery provider contract implemented outside of core.
// Контракт torrent discovery провайдера, реализуемый вне core.
export interface TorrentProvider {
  name: string;
  version?: string;
  kind: "torrent";
  capabilities: TorrentProviderCapabilities;

  discoverTorrents(
    query: TorrentDiscoveryQuery,
    context: ProviderContext,
  ): Promise<TorrentDiscoveryResponse | null>;
}
