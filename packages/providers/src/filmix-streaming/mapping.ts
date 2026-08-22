import type {
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
} from "@media-engine/core";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import {
  resolveFilmixQualityLink,
  type FilmixEpisode,
  type FilmixPost,
  type FilmixStream,
} from "./client.js";

const GUEST_QUALITY = 480;

export function mapFilmixAvailability(
  provider: string,
  post: FilmixPost,
  query: MediaAvailability["query"],
  sourceUrl: string | undefined,
  now: number,
  linkTtlMs: number,
): MediaAvailability | null {
  const expiresAt = new Date(now + linkTtlMs).toISOString();
  const options =
    post.type === "movie"
      ? mapMovieOptions(provider, post, sourceUrl, expiresAt)
      : mapEpisodeOptions(provider, post, query, sourceUrl, expiresAt);

  if (options.length === 0) return null;

  const episodes: StreamEpisodeAvailability[] | undefined =
    post.type === "series"
      ? [
          {
            seasonNumber: query.seasonNumber,
            episodeNumber: query.episodeNumber,
            options,
          },
        ]
      : undefined;

  return {
    query,
    item: {
      type: post.type,
      title: post.title,
      ...(post.originalTitle ? { originalTitle: post.originalTitle } : {}),
      year: post.year,
    },
    ...(episodes ? { episodes } : {}),
    options,
    sourceProviders: [{ provider, ...(sourceUrl ? { url: sourceUrl } : {}) }],
    checkedAt: new Date(now).toISOString(),
  };
}

function mapMovieOptions(
  provider: string,
  post: FilmixPost,
  sourceUrl: string | undefined,
  expiresAt: string,
): StreamOption[] {
  return uniqueOptions(
    post.movies.flatMap((stream, index) => {
      const option = createOption(provider, post.id, stream, index, sourceUrl, expiresAt);
      return option ? [option] : [];
    }),
  );
}

function mapEpisodeOptions(
  provider: string,
  post: FilmixPost,
  query: MediaAvailability["query"],
  sourceUrl: string | undefined,
  expiresAt: string,
): StreamOption[] {
  const season = post.seasons.filter((entry) => entry.number === query.seasonNumber);
  if (season.length !== 1) return [];

  return uniqueOptions(
    season[0]!.translations.flatMap((translation, index) => {
      const episodes = translation.episodes.filter(
        (episode) => episode.number === query.episodeNumber,
      );
      if (episodes.length !== 1) return [];
      const option = createOption(provider, post.id, episodes[0]!, index, sourceUrl, expiresAt, {
        seasonNumber: season[0]!.number,
        episodeNumber: episodes[0]!.number,
      });
      return option ? [option] : [];
    }),
  );
}

function createOption(
  provider: string,
  postId: number,
  stream: FilmixStream | FilmixEpisode,
  translationIndex: number,
  sourceUrl: string | undefined,
  expiresAt: string,
  episode?: { seasonNumber: number; episodeNumber: number },
): StreamOption | undefined {
  if (!stream.qualities.includes(GUEST_QUALITY)) return undefined;

  const resolved = resolveFilmixQualityLink(stream.link, GUEST_QUALITY);
  const url = normalizeProviderOutputUrl(resolved);
  if (!url || new URL(url).pathname.toLowerCase().endsWith(".mp4") === false) return undefined;

  const episodeKey = episode ? `:${episode.seasonNumber}:${episode.episodeNumber}` : "";
  return {
    id: `${provider}:${postId}${episodeKey}:${translationIndex}:${GUEST_QUALITY}`,
    provider,
    player: {
      kind: "mp4",
      label: "Filmix",
      providerPlayerId: `${postId}${episodeKey}:${translationIndex}`,
    },
    translation: {
      title: stream.translation,
      type: "unknown",
    },
    quality: { label: `${GUEST_QUALITY}p`, height: GUEST_QUALITY },
    ...(episode ? { episode } : {}),
    access: { url },
    availability: "available",
    expiresAt,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function uniqueOptions(options: StreamOption[]): StreamOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.translation?.title ?? ""}\u0000${option.access.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
