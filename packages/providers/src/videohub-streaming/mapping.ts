import type {
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
  TranslationInfo,
} from "@media-engine/core";
import type { ResolvedVideoHubItem, VideoHubMp4Source } from "./client.js";

export function mapVideoHubAvailability(
  provider: string,
  kinopoiskId: string,
  playlistTitle: string | undefined,
  items: ResolvedVideoHubItem[],
  query: MediaAvailability["query"],
  sourceUrl: string,
  now: number,
  linkTtlMs: number,
  playbackUserAgent: string,
): MediaAvailability | null {
  const expiresAt = new Date(now + linkTtlMs).toISOString();
  const options = uniqueOptions(
    items.flatMap((item) =>
      item.sources.map((source) =>
        createOption(provider, kinopoiskId, item, source, query, expiresAt, playbackUserAgent),
      ),
    ),
  );
  if (options.length === 0) return null;

  const episode = items[0] ? createEpisodeRef(items[0], query) : undefined;
  const episodes: StreamEpisodeAvailability[] | undefined = episode
    ? [
        {
          ...episode,
          options,
        },
      ]
    : undefined;
  const ids = { ...query.ids, kinopoisk: kinopoiskId };

  return {
    query,
    item: {
      type: query.type,
      title: playlistTitle ?? query.title,
      year: query.year,
      ids,
    },
    ...(episodes ? { episodes } : {}),
    options,
    sourceProviders: [{ provider, url: sourceUrl, ids }],
    checkedAt: new Date(now).toISOString(),
  };
}

function createOption(
  provider: string,
  kinopoiskId: string,
  item: ResolvedVideoHubItem,
  source: VideoHubMp4Source,
  query: MediaAvailability["query"],
  expiresAt: string,
  playbackUserAgent: string,
): StreamOption {
  const episode = createEpisodeRef(item, query);
  const translation = createTranslation(item.voiceStudio, item.voiceType);
  const episodeKey = createEpisodeKey(episode, query.type);

  return {
    id: `${provider}:${kinopoiskId}${episodeKey}:${item.vkId}:${source.label}`,
    provider,
    player: {
      kind: "mp4",
      label: "VideoHUB",
      providerPlayerId: `${item.vkId}${episodeKey}`,
    },
    translation,
    quality: {
      label: source.label,
      ...(source.height !== undefined ? { height: source.height } : {}),
    },
    ...(episode ? { episode } : {}),
    access: { url: source.url, headers: { "User-Agent": playbackUserAgent } },
    availability: "available",
    expiresAt,
    sourceUrl: item.sourceUrl,
  };
}

function createEpisodeRef(
  item: ResolvedVideoHubItem,
  query: MediaAvailability["query"],
): StreamOption["episode"] {
  if (query.type === "movie") return undefined;

  return {
    ...(item.seasonNumber !== undefined ? { seasonNumber: item.seasonNumber } : {}),
    ...(item.episodeNumber !== undefined ? { episodeNumber: item.episodeNumber } : {}),
    ...(query.type === "anime" && item.absoluteEpisodeNumber !== undefined
      ? { absoluteEpisodeNumber: item.absoluteEpisodeNumber }
      : {}),
  };
}

function createEpisodeKey(
  episode: StreamOption["episode"],
  type: MediaAvailability["query"]["type"],
): string {
  if (!episode) return "";
  if (type === "series") return `:${episode.seasonNumber}:${episode.episodeNumber}`;
  return `:a:${episode.absoluteEpisodeNumber}:s:${episode.seasonNumber}:e:${episode.episodeNumber}`;
}

function createTranslation(voiceStudio?: string, voiceType?: string): TranslationInfo {
  const title = voiceStudio || voiceType || "VideoHUB";
  const normalizedType = (voiceType ?? title).toLocaleLowerCase();
  const type: TranslationInfo["type"] = normalizedType.includes("субтит")
    ? "subtitles"
    : normalizedType.includes("дубляж")
      ? "dub"
      : normalizedType.includes("голос")
        ? "voiceover"
        : normalizedType.includes("оригинал")
          ? "original"
          : "unknown";

  return {
    title,
    type,
    ...(voiceStudio ? { team: voiceStudio } : {}),
  };
}

function uniqueOptions(options: StreamOption[]): StreamOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.translation?.title ?? ""}\u0000${option.quality?.label ?? ""}\u0000${option.access.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
