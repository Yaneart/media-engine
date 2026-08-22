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

  const episodes: StreamEpisodeAvailability[] | undefined =
    query.type === "series"
      ? [
          {
            seasonNumber: query.seasonNumber,
            episodeNumber: query.episodeNumber,
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
  const episode =
    query.type === "series"
      ? { seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber }
      : undefined;
  const translation = createTranslation(item.voiceStudio, item.voiceType);
  const episodeKey = episode ? `:${episode.seasonNumber}:${episode.episodeNumber}` : "";

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
