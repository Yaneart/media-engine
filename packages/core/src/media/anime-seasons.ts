export interface AnimeReleaseSeasonMapping {
  releaseIndex: number;
  canonicalSeasonNumber: number;
  canonicalSeasonEpisodeOffset: number;
  canonicalAbsoluteEpisodeOffset: number;
}

// Aligns ordered anime releases to canonical seasons only when their episode
// counts form exact contiguous partitions. Extra future canonical seasons are
// allowed, but every known release must map without crossing a season boundary.
export function mapAnimeReleasesToCanonicalSeasons(
  releaseEpisodeCounts: readonly number[],
  canonicalSeasonEpisodeCounts: readonly number[],
): AnimeReleaseSeasonMapping[] | undefined {
  if (
    releaseEpisodeCounts.length === 0 ||
    canonicalSeasonEpisodeCounts.length === 0 ||
    !releaseEpisodeCounts.every(isPositiveInteger) ||
    !canonicalSeasonEpisodeCounts.every(isPositiveInteger)
  ) {
    return undefined;
  }

  const mappings: AnimeReleaseSeasonMapping[] = [];
  let canonicalSeasonIndex = 0;
  let canonicalSeasonEpisodeOffset = 0;
  let canonicalAbsoluteEpisodeOffset = 0;

  for (let releaseIndex = 0; releaseIndex < releaseEpisodeCounts.length; releaseIndex += 1) {
    const releaseEpisodes = releaseEpisodeCounts[releaseIndex]!;
    const seasonEpisodes = canonicalSeasonEpisodeCounts[canonicalSeasonIndex];

    if (
      seasonEpisodes === undefined ||
      canonicalSeasonEpisodeOffset + releaseEpisodes > seasonEpisodes
    ) {
      return undefined;
    }

    mappings.push({
      releaseIndex,
      canonicalSeasonNumber: canonicalSeasonIndex + 1,
      canonicalSeasonEpisodeOffset,
      canonicalAbsoluteEpisodeOffset,
    });

    canonicalSeasonEpisodeOffset += releaseEpisodes;
    canonicalAbsoluteEpisodeOffset += releaseEpisodes;

    if (canonicalSeasonEpisodeOffset === seasonEpisodes) {
      canonicalSeasonIndex += 1;
      canonicalSeasonEpisodeOffset = 0;
    }
  }

  return canonicalSeasonEpisodeOffset === 0 ? mappings : undefined;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
