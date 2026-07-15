import type { MediaItem } from "../media/index.js";

// Returns all useful titles that may match the query.
// Возвращает все полезные названия, которые могут совпасть с запросом.
export function titleCandidates(item: MediaItem): string[] {
  return [item.title, item.originalTitle, ...(item.alternativeTitles ?? [])].filter(
    (title): title is string => Boolean(title?.trim()),
  );
}

// Normalizes titles for safe exact automatic grouping.
// Нормализует названия для безопасной автоматической группировки.
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Builds a less aggressive key for exact title comparison.
// Создает менее агрессивный ключ для точного сравнения title.
export function exactTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}
