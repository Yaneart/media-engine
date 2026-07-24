import type { TorrentDiscoveryQuery } from "@media-engine/core";
import { selectStrictTorrentReleases } from "../shared/torrent-release-matching.js";
import type { BitsearchTorrentRelease } from "./client.js";

export function selectBitsearchTorrentReleases(
  releases: BitsearchTorrentRelease[],
  query: TorrentDiscoveryQuery,
): BitsearchTorrentRelease[] {
  const category = mapQueryCategory(query.type);
  return selectStrictTorrentReleases(releases, query).filter(
    (release) => release.category === category,
  );
}

function mapQueryCategory(type: TorrentDiscoveryQuery["type"]): number {
  if (type === "movie") return 2;
  if (type === "series") return 3;
  return 4;
}
