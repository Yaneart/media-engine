import type { TorrentDiscoveryQuery } from "@media-engine/core";
import { selectStrictTorrentReleases } from "../shared/torrent-release-matching.js";
import type { MagnetzTorrentRelease } from "./client.js";

export function selectMagnetzTorrentReleases(
  releases: MagnetzTorrentRelease[],
  query: TorrentDiscoveryQuery,
): MagnetzTorrentRelease[] {
  return selectStrictTorrentReleases(releases, query);
}
