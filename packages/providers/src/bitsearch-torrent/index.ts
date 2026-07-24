import type { TorrentProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { canResolveStrictTorrentQuery } from "../shared/torrent-release-matching.js";
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
      if (!canResolveStrictTorrentQuery(query)) return null;

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
