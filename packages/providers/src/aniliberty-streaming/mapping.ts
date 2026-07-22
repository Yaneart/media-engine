import type {
  MediaAvailability,
  StreamAvailabilityStatus,
  StreamEpisodeAvailability,
  StreamOption,
} from "@media-engine/core";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import type { AniLibertyEpisode, AniLibertyRelease } from "./client.js";

const QUALITIES = [
  { field: "hls1080", height: 1080 },
  { field: "hls720", height: 720 },
  { field: "hls480", height: 480 },
] as const;

export function mapAniLibertyAvailability(
  provider: string,
  release: AniLibertyRelease,
  query: MediaAvailability["query"],
  sourceUrl: string,
): MediaAvailability | null {
  const selectedEpisodes = selectEpisodes(release.episodes, query);
  const availability = mapReleaseAvailability(release);
  const episodes = selectedEpisodes.flatMap((episode) => {
    const mapped = mapEpisode(provider, release.id, episode, sourceUrl, availability);
    return mapped.options.length > 0 ? [mapped] : [];
  });
  const options = episodes.flatMap((episode) => episode.options);

  if (options.length === 0) return null;

  return {
    query,
    item: {
      type: "anime",
      title: query.title,
      year: release.year,
    },
    episodes,
    options,
    sourceProviders: [{ provider, url: sourceUrl }],
    checkedAt: new Date().toISOString(),
  };
}

function selectEpisodes(
  episodes: AniLibertyEpisode[],
  query: MediaAvailability["query"],
): AniLibertyEpisode[] {
  if (query.absoluteEpisodeNumber === undefined) {
    return uniqueEpisodes(episodes);
  }

  const matching = uniqueEpisodes(episodes).filter(
    (episode) => episode.ordinal === query.absoluteEpisodeNumber,
  );
  return matching.length === 1 ? matching : [];
}

function uniqueEpisodes(episodes: AniLibertyEpisode[]): AniLibertyEpisode[] {
  const seen = new Set<string>();

  return episodes.filter((episode) => {
    if (seen.has(episode.id)) return false;
    seen.add(episode.id);
    return true;
  });
}

function mapEpisode(
  provider: string,
  releaseId: number,
  episode: AniLibertyEpisode,
  sourceUrl: string,
  availability: StreamAvailabilityStatus,
): StreamEpisodeAvailability {
  return {
    absoluteEpisodeNumber: episode.ordinal,
    title: episode.name,
    options: QUALITIES.flatMap(({ field, height }) => {
      const url = normalizeProviderOutputUrl(episode[field]);
      return url
        ? [createOption(provider, releaseId, episode, height, url, sourceUrl, availability)]
        : [];
    }),
  };
}

function createOption(
  provider: string,
  releaseId: number,
  episode: AniLibertyEpisode,
  height: number,
  url: string,
  sourceUrl: string,
  availability: StreamAvailabilityStatus,
): StreamOption {
  return {
    id: `${provider}:${releaseId}:${episode.id}:${height}`,
    provider,
    player: {
      kind: "hls",
      label: "AniLiberty",
      providerPlayerId: episode.id,
    },
    translation: {
      title: "AniLiberty",
      type: "voiceover",
      language: "ru",
      team: "AniLiberty",
    },
    quality: { label: `${height}p`, height },
    episode: { absoluteEpisodeNumber: episode.ordinal },
    access: { url },
    availability,
    sourceUrl,
  };
}

function mapReleaseAvailability(release: AniLibertyRelease): StreamAvailabilityStatus {
  if (release.blockedByGeo) return "region_locked";
  if (release.blockedByCopyrights) return "temporarily_unavailable";
  return "available";
}
