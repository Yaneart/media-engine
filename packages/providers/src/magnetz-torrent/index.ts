import type { TorrentProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { canResolveStrictTorrentQuery } from "../shared/torrent-release-matching.js";
import { searchMagnetzTorrents } from "./client.js";
import {
  createMagnetzTorrentCapabilities,
  createMagnetzTorrentConfig,
  type MagnetzTorrentProviderOptions,
} from "./config.js";
import { mapMagnetzTorrentResponse } from "./mapping.js";
import { selectMagnetzTorrentReleases } from "./matching.js";

export type { MagnetzTorrentProviderOptions } from "./config.js";

export function magnetzTorrentProvider(
  options: MagnetzTorrentProviderOptions = {},
): TorrentProvider {
  const config = createMagnetzTorrentConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "torrent",
    capabilities: createMagnetzTorrentCapabilities(),
    async discoverTorrents(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveStrictTorrentQuery(query)) return null;

      try {
        const releases = await searchMagnetzTorrents(config, query, context);
        const matches = selectMagnetzTorrentReleases(releases, query);
        return mapMagnetzTorrentResponse(config.name, config.baseUrl, matches, query);
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}
