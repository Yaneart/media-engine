import type { StreamQuery } from "@media-engine/core";

export interface AnimeEpisodeSelection {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
}

export interface SeasonalEpisodeCoordinate {
  seasonNumber?: number;
  episodeNumber?: number;
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

// Proves the caller's absolute number against a complete, gap-free seasonal
// prefix from the direct provider catalog. Partial or inconsistent catalogs
// are not safe enough to bridge independently numbered anime episodes.
export function verifyAnimeEpisodeSelection(
  query: StreamQuery,
  catalog: readonly SeasonalEpisodeCoordinate[],
): AnimeEpisodeSelection | undefined {
  const selection = resolveAnimeEpisodeSelection(query);
  if (!selection) return undefined;

  const episodesBySeason = new Map<number, Set<number>>();
  for (const episode of catalog) {
    if (!isPositiveInteger(episode.seasonNumber) || !isPositiveInteger(episode.episodeNumber)) {
      continue;
    }
    const episodes = episodesBySeason.get(episode.seasonNumber) ?? new Set<number>();
    episodes.add(episode.episodeNumber);
    episodesBySeason.set(episode.seasonNumber, episodes);
  }

  let absoluteEpisodeNumber = 0;
  for (let seasonNumber = 1; seasonNumber <= selection.seasonNumber; seasonNumber += 1) {
    const episodes = episodesBySeason.get(seasonNumber);
    if (!episodes) return undefined;
    const lastEpisode =
      seasonNumber === selection.seasonNumber ? selection.episodeNumber : Math.max(...episodes);
    for (let episodeNumber = 1; episodeNumber <= lastEpisode; episodeNumber += 1) {
      if (!episodes.has(episodeNumber)) return undefined;
      absoluteEpisodeNumber += 1;
    }
  }

  return absoluteEpisodeNumber === selection.absoluteEpisodeNumber ? selection : undefined;
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
