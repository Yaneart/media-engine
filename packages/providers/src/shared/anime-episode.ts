import type { StreamQuery } from "@media-engine/core";

export interface AnimeEpisodeSelection {
  // Provider-native coordinates selected from its verified catalog.
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  // Canonical coordinates supplied by the consumer and returned publicly.
  canonicalSeasonNumber: number;
  canonicalEpisodeNumber: number;
  releaseEpisodeNumber?: number;
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
    canonicalSeasonNumber: query.seasonNumber,
    canonicalEpisodeNumber: query.episodeNumber,
    ...resolveReleaseEpisode(query),
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

  const coordinates = createGapFreeCatalog(catalog);
  if (!coordinates) return undefined;

  const release = query.animeReleaseEpisode;
  if (release) {
    const releaseEpisode = resolveReleaseEpisode(query);
    if (!releaseEpisode) return undefined;

    const releaseTotal = release.releaseEpisodeCounts.reduce((total, count) => total + count, 0);
    const selectedReleaseCount = release.releaseEpisodeCounts[release.releaseIndex]!;
    const prefixTotals = new Set<number>();
    let prefix = 0;
    for (const count of release.releaseEpisodeCounts) {
      prefix += count;
      prefixTotals.add(prefix);
    }

    const candidates: SeasonalEpisodeCoordinate[] = [];
    if (
      prefixTotals.has(coordinates.length) &&
      selection.absoluteEpisodeNumber <= coordinates.length
    ) {
      candidates.push(coordinates[selection.absoluteEpisodeNumber - 1]!);
    }
    if (coordinates.length === selectedReleaseCount) {
      candidates.push(coordinates[release.releaseEpisodeNumber - 1]!);
    }
    if (
      coordinates.length === releaseTotal &&
      selection.absoluteEpisodeNumber <= coordinates.length
    ) {
      candidates.push(coordinates[selection.absoluteEpisodeNumber - 1]!);
    }

    const unique = new Map(
      candidates.map((coordinate) => [
        `${coordinate.seasonNumber}:${coordinate.episodeNumber}`,
        coordinate,
      ]),
    );
    if (unique.size !== 1) return undefined;
    const provider = [...unique.values()][0]!;

    return {
      ...selection,
      seasonNumber: provider.seasonNumber!,
      episodeNumber: provider.episodeNumber!,
      releaseEpisodeNumber: releaseEpisode.releaseEpisodeNumber,
    };
  }

  const providerIndex = coordinates.findIndex(
    (episode) =>
      episode.seasonNumber === selection.seasonNumber &&
      episode.episodeNumber === selection.episodeNumber,
  );
  return providerIndex + 1 === selection.absoluteEpisodeNumber ? selection : undefined;
}

function resolveReleaseEpisode(query: StreamQuery): { releaseEpisodeNumber?: number } | undefined {
  const release = query.animeReleaseEpisode;
  if (!release) return {};
  if (
    !Number.isSafeInteger(release.releaseIndex) ||
    release.releaseIndex < 0 ||
    !isPositiveInteger(release.releaseEpisodeNumber) ||
    release.releaseEpisodeCounts.length === 0 ||
    release.releaseEpisodeCounts.length > 100 ||
    !release.releaseEpisodeCounts.every(isPositiveInteger) ||
    release.releaseIndex >= release.releaseEpisodeCounts.length ||
    release.releaseEpisodeNumber > release.releaseEpisodeCounts[release.releaseIndex]!
  ) {
    return undefined;
  }

  const absoluteEpisodeNumber =
    release.releaseEpisodeCounts
      .slice(0, release.releaseIndex)
      .reduce((total, count) => total + count, 0) + release.releaseEpisodeNumber;
  return absoluteEpisodeNumber === query.absoluteEpisodeNumber
    ? { releaseEpisodeNumber: release.releaseEpisodeNumber }
    : undefined;
}

function createGapFreeCatalog(
  catalog: readonly SeasonalEpisodeCoordinate[],
): SeasonalEpisodeCoordinate[] | undefined {
  const episodesBySeason = new Map<number, Set<number>>();
  for (const episode of catalog) {
    if (!isPositiveInteger(episode.seasonNumber) || !isPositiveInteger(episode.episodeNumber)) {
      continue;
    }
    const episodes = episodesBySeason.get(episode.seasonNumber) ?? new Set<number>();
    episodes.add(episode.episodeNumber);
    episodesBySeason.set(episode.seasonNumber, episodes);
  }

  if (episodesBySeason.size === 0) return undefined;
  const coordinates: SeasonalEpisodeCoordinate[] = [];
  const lastSeason = Math.max(...episodesBySeason.keys());
  for (let seasonNumber = 1; seasonNumber <= lastSeason; seasonNumber += 1) {
    const episodes = episodesBySeason.get(seasonNumber);
    if (!episodes) return undefined;
    const lastEpisode = Math.max(...episodes);
    for (let episodeNumber = 1; episodeNumber <= lastEpisode; episodeNumber += 1) {
      if (!episodes.has(episodeNumber)) return undefined;
      coordinates.push({ seasonNumber, episodeNumber });
    }
  }
  return coordinates;
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
