import type { TorrentProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { searchJacRedTorrents } from "./client.js";
import {
  createJacRedTorrentCapabilities,
  createJacRedTorrentConfig,
  type JacRedTorrentProviderOptions,
} from "./config.js";
import { selectJacRedTorrentReleases } from "./matching.js";
import { mapJacRedTorrentResponse } from "./mapping.js";

export type { JacRedTorrentProviderOptions } from "./config.js";

export function jacRedTorrentProvider(options: JacRedTorrentProviderOptions = {}): TorrentProvider {
  const config = createJacRedTorrentConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "torrent",
    capabilities: createJacRedTorrentCapabilities(),
    async discoverTorrents(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const releases = await searchJacRedTorrents(config, query, context);
        const matches = selectJacRedTorrentReleases(releases, query);
        return mapJacRedTorrentResponse(config.name, config.baseUrl, matches, query);
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<TorrentProvider["discoverTorrents"]>[0]): boolean {
  const title = query.title?.trim();

  return (
    Boolean(title && title.length >= 2) &&
    Number.isInteger(query.year) &&
    query.year! >= 1_800 &&
    query.year! <= 3_000 &&
    query.episodeNumber === undefined &&
    query.absoluteEpisodeNumber === undefined &&
    (query.type !== "movie" || query.seasonNumber === undefined)
  );
}
