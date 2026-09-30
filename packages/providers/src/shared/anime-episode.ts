import type { StreamQuery } from "@media-engine/core";

export interface AnimeEpisodeSelection {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
}

// Direct series catalogs need an explicit bridge from a canonical anime episode
// to the provider's season/episode coordinates. An absolute number alone is
// ambiguous when one cinema ID covers several independently catalogued anime seasons.
export function resolveAnimeEpisodeSelection(
  query: StreamQuery,
): AnimeEpisodeSelection | undefined {
  if (query.type !== "anime" || query.animeKind !== "tv" || !hasAnimeIdentity(query)) {
    return undefined;
  }

  if (
    !isPositiveInteger(query.seasonNumber) ||
    !isPositiveInteger(query.episodeNumber) ||
    !isPositiveInteger(query.absoluteEpisodeNumber)
  ) {
    return undefined;
  }

  return {
    seasonNumber: query.seasonNumber,
    episodeNumber: query.episodeNumber,
    absoluteEpisodeNumber: query.absoluteEpisodeNumber,
  };
}

function hasAnimeIdentity(query: StreamQuery): boolean {
  return Boolean(
    query.ids?.aniList ??
    query.aniList ??
    query.ids?.myAnimeList ??
    query.myAnimeList ??
    query.ids?.shikimori ??
    query.shikimori,
  );
}

function isPositiveInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && (value ?? 0) > 0;
}
