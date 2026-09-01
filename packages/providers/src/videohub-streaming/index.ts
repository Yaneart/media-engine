import type {
  MediaAvailability,
  MediaAvailabilityProgressSnapshot,
  ProviderContext,
  StreamingProvider,
} from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  loadVideoHubPlaylist,
  resolveVideoHubItemsProgressively,
  resolveVideoHubKinopoiskId,
} from "./client.js";
import {
  createVideoHubCapabilities,
  createVideoHubConfig,
  type VideoHubStreamingProviderOptions,
} from "./config.js";
import { mapVideoHubAvailability, mapVideoHubEpisodeCatalog } from "./mapping.js";

export type { VideoHubStreamingProviderOptions } from "./config.js";

export function videoHubStreamingProvider(
  options: VideoHubStreamingProviderOptions = {},
): StreamingProvider {
  const config = createVideoHubConfig(options);
  const getAvailabilityProgressively = (
    query: Parameters<StreamingProvider["getAvailability"]>[0],
    context: ProviderContext,
  ) => streamVideoHubAvailability(config, query, context);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createVideoHubCapabilities(),
    availabilityDependsOnPlaybackUserAgent: true,
    async getAvailability(query, context) {
      let finalAvailability: MediaAvailability | null = null;

      for await (const snapshot of getAvailabilityProgressively(query, context)) {
        finalAvailability = snapshot.availability;
      }

      return finalAvailability;
    },
    getAvailabilityProgressively,
  };
}

async function* streamVideoHubAvailability(
  config: ReturnType<typeof createVideoHubConfig>,
  query: Parameters<StreamingProvider["getAvailability"]>[0],
  context: ProviderContext,
): AsyncGenerator<MediaAvailabilityProgressSnapshot> {
  const controller = new AbortController();
  const abort = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", abort, { once: true });
  if (context.signal?.aborted) abort();
  const progressiveContext = { ...context, signal: controller.signal };

  try {
    if (query.providers && !query.providers.includes(config.name)) {
      yield completeSnapshot(null);
      return;
    }
    if (!canResolveQuery(query)) {
      yield completeSnapshot(null);
      return;
    }

    const kinopoiskId = resolveVideoHubKinopoiskId(query);
    if (!kinopoiskId) {
      yield completeSnapshot(null);
      return;
    }
    const playbackUserAgent = resolvePlaybackUserAgent(context, config.userAgent);

    const { playlist, sourceUrl } = await loadVideoHubPlaylist(
      config,
      kinopoiskId,
      progressiveContext,
      playbackUserAgent,
    );
    if ((query.type !== "movie") !== playlist.isSerial) {
      yield completeSnapshot(null);
      return;
    }
    if (isAnimeCatalogQuery(query)) {
      yield completeSnapshot(
        mapVideoHubEpisodeCatalog(
          config.name,
          kinopoiskId,
          playlist,
          query,
          sourceUrl,
          config.now(),
        ),
      );
      return;
    }

    for await (const resolution of resolveVideoHubItemsProgressively(
      config,
      playlist,
      query,
      progressiveContext,
      playbackUserAgent,
    )) {
      const availability = mapVideoHubAvailability(
        config.name,
        kinopoiskId,
        playlist.title,
        resolution.items,
        query,
        sourceUrl,
        config.now(),
        config.linkTtlMs,
        playbackUserAgent,
      );

      yield resolution.complete
        ? completeSnapshot(availability)
        : {
            availability,
            state: "pending",
            pendingProviders: [config.name],
          };
    }
  } catch (error) {
    rethrowIfProviderAborted(progressiveContext, error);
    throw error;
  } finally {
    context.signal?.removeEventListener("abort", abort);
    if (!controller.signal.aborted) {
      const error = new Error("VideoHUB progressive availability consumer stopped.");
      error.name = "AbortError";
      controller.abort(error);
    }
  }
}

function completeSnapshot(
  availability: MediaAvailability | null,
): MediaAvailabilityProgressSnapshot {
  return { availability, state: "complete", pendingProviders: [] };
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

  const hasSeason = isNonNegativeInteger(query.seasonNumber);
  const hasEpisode = isPositiveInteger(query.episodeNumber);
  const hasAbsoluteEpisode = isPositiveInteger(query.absoluteEpisodeNumber);

  if (query.type === "series") {
    return hasSeason && hasEpisode && query.absoluteEpisodeNumber === undefined;
  }

  if (query.type !== "anime" || hasSeason !== hasEpisode) return false;
  return (
    (query.seasonNumber === undefined &&
      query.episodeNumber === undefined &&
      query.absoluteEpisodeNumber === undefined) ||
    hasAbsoluteEpisode ||
    (hasSeason && hasEpisode)
  );
}

function isPositiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

function isNonNegativeInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? -1) >= 0;
}

function isAnimeCatalogQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  return (
    query.type === "anime" &&
    query.seasonNumber === undefined &&
    query.episodeNumber === undefined &&
    query.absoluteEpisodeNumber === undefined
  );
}
