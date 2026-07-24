import type { TorrentDiscoveryQuery, TorrentProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { searchBitsearchTorrents } from "./client.js";
import {
  createBitsearchTorrentCapabilities,
  createBitsearchTorrentConfig,
  type BitsearchTorrentProviderOptions,
} from "./config.js";
import { mapBitsearchTorrentResponse } from "./mapping.js";
import { selectBitsearchTorrentReleases } from "./matching.js";

export type { BitsearchTorrentProviderOptions } from "./config.js";

export function bitsearchTorrentProvider(
  options: BitsearchTorrentProviderOptions = {},
): TorrentProvider {
  const config = createBitsearchTorrentConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "torrent",
    capabilities: createBitsearchTorrentCapabilities(),
    async discoverTorrents(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const releases = await searchBitsearchTorrents(config, query, context);
        const matches = selectBitsearchTorrentReleases(releases, query);
        return mapBitsearchTorrentResponse(config.name, config.baseUrl, matches, query);
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: TorrentDiscoveryQuery): boolean {
  const title = query.title?.trim();
  const numericFields = [query.seasonNumber, query.episodeNumber, query.absoluteEpisodeNumber];

  if (
    !title ||
    title.length < 2 ||
    !Number.isInteger(query.year) ||
    query.year! < 1_800 ||
    query.year! > 3_000 ||
    numericFields.some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 9_999),
    )
  ) {
    return false;
  }

  if (query.type === "movie") {
    return numericFields.every((value) => value === undefined);
  }

  if (query.absoluteEpisodeNumber !== undefined) {
    return query.seasonNumber === undefined && query.episodeNumber === undefined;
  }

  return query.episodeNumber === undefined || query.seasonNumber !== undefined;
}
