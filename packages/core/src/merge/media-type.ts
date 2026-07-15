import type { MediaItem, MediaType } from "../media/index.js";
import type { SearchEntry } from "./internal.js";

// Preserves anime semantics when a generic series catalog describes the same animated title.
// Сохраняет anime-семантику, когда generic series-каталог описывает тот же анимационный тайтл.
export function selectMergedSearchType(entries: SearchEntry[]): MediaType | undefined {
  return selectMergedMediaType(entries.map((entry) => entry.result.item));
}

// Uses general-series metadata priority for mixed anime/catalog groups without losing anime type.
// Использует приоритет metadata сериалов для смешанных anime/catalog групп без потери anime-типа.
export function selectMetadataPriorityType(items: MediaItem[]): MediaType | undefined {
  const types = new Set(items.map((item) => item.type));
  return types.has("anime") && types.has("series") ? "series" : items[0]?.type;
}

export function selectMergedMediaType(items: MediaItem[]): MediaType | undefined {
  return items.some((item) => item.type === "anime") ? "anime" : items[0]?.type;
}
