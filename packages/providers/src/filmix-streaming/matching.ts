import type { MediaAvailability } from "@media-engine/core";
import { normalizeProviderSearchText } from "../shared/mapping.js";
import type { FilmixPost, FilmixPostSummary } from "./client.js";

export function selectFilmixPost(
  posts: FilmixPostSummary[],
  query: MediaAvailability["query"],
): FilmixPostSummary | undefined {
  const title = query.title?.trim();
  if (!title || !Number.isInteger(query.year)) return undefined;

  const normalizedTitle = normalizeProviderSearchText(title);
  if (!normalizedTitle) return undefined;

  const sameIdentity = uniqueById(
    posts.filter((post) => post.year === query.year && post.type === query.type),
  );
  const exact = sameIdentity.filter((post) => hasExactTitle(post, normalizedTitle));

  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  // Filmix search can return a localized title that differs from the catalog title.
  // A fallback is safe only when search itself yields one year/type identity.
  return sameIdentity.length === 1 ? sameIdentity[0] : undefined;
}

export function matchesSelectedFilmixPost(post: FilmixPost, selected: FilmixPostSummary): boolean {
  if (
    post.id !== selected.id ||
    post.year !== selected.year ||
    post.section !== selected.section ||
    post.type !== selected.type
  ) {
    return false;
  }

  const selectedTitles = normalizedTitles(selected);
  return normalizedTitles(post).some((title) => selectedTitles.includes(title));
}

function hasExactTitle(post: FilmixPostSummary, normalizedTitle: string): boolean {
  return normalizedTitles(post).includes(normalizedTitle);
}

function normalizedTitles(post: FilmixPostSummary): string[] {
  return [post.title, post.originalTitle]
    .filter((title): title is string => Boolean(title))
    .map(normalizeProviderSearchText)
    .filter(Boolean);
}

function uniqueById(posts: FilmixPostSummary[]): FilmixPostSummary[] {
  return [...new Map(posts.map((post) => [post.id, post])).values()];
}
