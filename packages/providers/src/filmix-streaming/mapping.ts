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

const QUALITY_ORDER = [720, 480] as const;
const BLOCKED_TRANSLATION = /^(?:заблокировано|недоступно)(?:\s|$)/iu;
const RESTRICTION_VIDEO = /\/abuse_(?:\[[0-9,]+\]|%s|\d+)\.mp4$/iu;

export function mapFilmixAvailability(
  provider: string,
  post: FilmixPost,
  query: MediaAvailability["query"],
  sourceUrl: string | undefined,
  now: number,
  linkTtlMs: number,
  maxQuality: 480 | 720 = 480,
): MediaAvailability | null {
  const expiresAt = new Date(now + linkTtlMs).toISOString();
  const options =
    post.type === "movie"
      ? mapMovieOptions(provider, post, sourceUrl, expiresAt, maxQuality)
      : mapEpisodeOptions(provider, post, query, sourceUrl, expiresAt, maxQuality);

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
  maxQuality: 480 | 720,
): StreamOption[] {
  return uniqueOptions(
    post.movies.flatMap((stream, index) => {
      return createOptions(provider, post.id, stream, index, sourceUrl, expiresAt, maxQuality);
    }),
  );
}

function mapEpisodeOptions(
  provider: string,
  post: FilmixPost,
  query: MediaAvailability["query"],
  sourceUrl: string | undefined,
  expiresAt: string,
  maxQuality: 480 | 720,
): StreamOption[] {
  const season = post.seasons.filter((entry) => entry.number === query.seasonNumber);
  if (season.length !== 1) return [];

  return uniqueOptions(
    season[0]!.translations.flatMap((translation, index) => {
      const episodes = translation.episodes.filter(
        (episode) => episode.number === query.episodeNumber,
      );
      if (episodes.length !== 1) return [];
      return createOptions(
        provider,
        post.id,
        episodes[0]!,
        index,
        sourceUrl,
        expiresAt,
        maxQuality,
        {
          seasonNumber: season[0]!.number,
          episodeNumber: episodes[0]!.number,
        },
      );
    }),
  );
}

function createOptions(
  provider: string,
  postId: number,
  stream: FilmixStream | FilmixEpisode,
  translationIndex: number,
  sourceUrl: string | undefined,
  expiresAt: string,
  maxQuality: 480 | 720,
  episode?: { seasonNumber: number; episodeNumber: number },
): StreamOption[] {
  if (isRestrictedStream(stream)) return [];

  const episodeKey = episode ? `:${episode.seasonNumber}:${episode.episodeNumber}` : "";
  return QUALITY_ORDER.flatMap((quality) => {
    if (quality > maxQuality || !stream.qualities.includes(quality)) return [];

    const resolved = resolveFilmixQualityLink(stream.link, quality);
    const url = normalizeProviderOutputUrl(resolved);
    if (!url || new URL(url).pathname.toLowerCase().endsWith(".mp4") === false) return [];

    return [
      {
        id: `${provider}:${postId}${episodeKey}:${translationIndex}:${quality}`,
        provider,
        player: {
          kind: "mp4" as const,
          label: "Filmix",
          providerPlayerId: `${postId}${episodeKey}:${translationIndex}`,
        },
        translation: {
          title: stream.translation,
          type: "unknown" as const,
        },
        quality: { label: `${quality}p`, height: quality },
        ...(episode ? { episode } : {}),
        access: { url },
        availability: "available" as const,
        expiresAt,
        ...(sourceUrl ? { sourceUrl } : {}),
      },
    ];
  });
}

function isRestrictedStream(stream: FilmixStream | FilmixEpisode): boolean {
  if (BLOCKED_TRANSLATION.test(stream.translation.trim())) return true;

  try {
    return RESTRICTION_VIDEO.test(new URL(stream.link).pathname);
  } catch {
    return true;
  }
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
