import type { MediaType } from "../media/index.js";
import type { MergeContext } from "./types.js";

// Default provider priority for movies and series.
// Приоритет провайдеров по умолчанию для фильмов и сериалов.
const DEFAULT_PRIORITY = ["tmdb", "kinobd", "cinemeta", "imdb", "wikidata", "kinopoisk"];

// Default provider priority for anime results.
// Приоритет провайдеров по умолчанию для аниме.
const ANIME_PRIORITY = [
  "shikimori",
  "anilist",
  "tmdb",
  "kinobd",
  "cinemeta",
  "imdb",
  "wikidata",
  "kinopoisk",
];

// Search-level tie-break priority used when results from different media types have equal scores.
// Search-level priority для tie-break, когда результаты разных media types имеют одинаковый score.
export const SEARCH_RESULT_PRIORITY = [
  "tmdb",
  "kinobd",
  "cinemeta",
  "imdb",
  "wikidata",
  "kinopoisk",
  "shikimori",
  "anilist",
];

// Sorts entries by explicit provider priority and then original input order.
// Сортирует entries по заданному приоритету провайдеров и исходному порядку.
export function sortEntriesByPriority<T extends { result: { provider: string } }>(
  entries: T[],
  context: MergeContext,
  mediaType?: MediaType,
): T[] {
  const priority = context.providerPriority ?? defaultPriority(mediaType);

  return [...entries].sort((left, right) => {
    const priorityDiff =
      providerRank(left.result.provider, priority) - providerRank(right.result.provider, priority);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return getEntryIndex(left) - getEntryIndex(right);
  });
}

// Calculates provider priority rank for deterministic sorting.
// Вычисляет ранг провайдера для детерминированной сортировки.
export function providerRank(provider: string, priority: string[]): number {
  const index = priority.indexOf(provider);

  return index === -1 ? priority.length : index;
}

// Returns the default provider priority for a media type.
// Возвращает приоритет провайдеров по умолчанию для типа медиа.
function defaultPriority(mediaType?: MediaType): string[] {
  return mediaType === "anime" ? ANIME_PRIORITY : DEFAULT_PRIORITY;
}

// Reads an entry index from generic sorted objects.
// Читает index из обобщенных объектов для сортировки.
function getEntryIndex(entry: unknown): number {
  return typeof entry === "object" &&
    entry !== null &&
    "index" in entry &&
    typeof entry.index === "number"
    ? entry.index
    : 0;
}
