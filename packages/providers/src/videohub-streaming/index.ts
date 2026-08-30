import type { ProviderContext, StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  loadVideoHubPlaylist,
  resolveVideoHubItems,
  resolveVideoHubKinopoiskId,
} from "./client.js";
import {
  createVideoHubCapabilities,
  createVideoHubConfig,
  type VideoHubStreamingProviderOptions,
} from "./config.js";
import { mapVideoHubAvailability } from "./mapping.js";

export type { VideoHubStreamingProviderOptions } from "./config.js";

export function videoHubStreamingProvider(
  options: VideoHubStreamingProviderOptions = {},
): StreamingProvider {
  const config = createVideoHubConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createVideoHubCapabilities(),
    availabilityDependsOnPlaybackUserAgent: true,
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      const kinopoiskId = resolveVideoHubKinopoiskId(query);
      if (!kinopoiskId) return null;
      const playbackUserAgent = resolvePlaybackUserAgent(context, config.userAgent);

      try {
        const { playlist, sourceUrl } = await loadVideoHubPlaylist(
          config,
          kinopoiskId,
          context,
          playbackUserAgent,
        );
        if ((query.type !== "movie") !== playlist.isSerial) return null;
        const items = await resolveVideoHubItems(
          config,
          playlist,
          query,
          context,
          playbackUserAgent,
        );

        return mapVideoHubAvailability(
          config.name,
          kinopoiskId,
          playlist.title,
          items,
          query,
          sourceUrl,
          config.now(),
          config.linkTtlMs,
          playbackUserAgent,
        );
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function resolvePlaybackUserAgent(context: ProviderContext, fallback: string): string {
  const value = context.playbackUserAgent?.trim();
  return value && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fallback;
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  if (query.type === "movie") {
    return (
      query.seasonNumber === undefined &&
      query.episodeNumber === undefined &&
      query.absoluteEpisodeNumber === undefined
    );
  }

  const hasSeason = isPositiveInteger(query.seasonNumber);
  const hasEpisode = isPositiveInteger(query.episodeNumber);
  const hasAbsoluteEpisode = isPositiveInteger(query.absoluteEpisodeNumber);

  if (query.type === "series") {
    return hasSeason && hasEpisode && query.absoluteEpisodeNumber === undefined;
  }

  if (query.type !== "anime" || hasSeason !== hasEpisode) return false;
  return hasAbsoluteEpisode || (hasSeason && hasEpisode);
}

function isPositiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? 0) > 0;
}
