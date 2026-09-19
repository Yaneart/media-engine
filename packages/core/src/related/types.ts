import type {
  AnimeKind,
  ExternalIds,
  MediaItem,
  MediaStatus,
  MediaType,
  ProviderSource,
} from "../media/index.js";
import type { ResponseMeta } from "../response/index.js";

// Provider-neutral relationship kinds exposed by metadata catalogs.
// Провайдер-независимые типы связей из metadata-каталогов.
export type MediaRelationKind =
  | "adaptation"
  | "alternative"
  | "alternative_setting"
  | "alternative_version"
  | "character"
  | "compilation"
  | "contains"
  | "full_story"
  | "other"
  | "parent_story"
  | "prequel"
  | "sequel"
  | "side_story"
  | "source"
  | "spin_off"
  | "summary";

// Compact related item with lifecycle fields needed to classify sequels safely.
// Компактный связанный item с lifecycle-полями для безопасной классификации продолжений.
export interface RelatedMediaItem extends MediaItem {
  status?: MediaStatus;
  animeKind?: AnimeKind;
  episodesCount?: number;
}

// One normalized relation with provider attribution.
// Одна нормализованная связь с атрибуцией провайдеров.
export interface MediaRelation {
  kind: MediaRelationKind;
  item: RelatedMediaItem;
  sources: ProviderSource[];
}

// Public query for direct relationships of one catalog item.
// Публичный запрос прямых связей одного элемента каталога.
export interface RelatedMediaQuery {
  ids?: ExternalIds;
  imdb?: string;
  tmdb?: string;
  kinopoisk?: string;
  shikimori?: string;
  myAnimeList?: string;
  aniList?: string;
  type?: MediaType;
  language?: string;
  limit?: number;
}

// Related-media response returned by MediaEngine.getRelatedMedia.
// Ответ связанных медиа от MediaEngine.getRelatedMedia.
export interface RelatedMediaResponse {
  query: RelatedMediaQuery;
  relations: MediaRelation[];
  meta: ResponseMeta;
}
