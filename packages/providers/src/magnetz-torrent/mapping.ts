import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
} from "@media-engine/core";
import {
  createCanonicalMagnetUri,
  createTorrentEpisodeRef,
  mapTorrentReleaseTitle,
} from "../shared/torrent-release-metadata.js";
import type { MagnetzTorrentRelease } from "./client.js";

export function mapMagnetzTorrentResponse(
  provider: string,
  providerUrl: string,
  releases: MagnetzTorrentRelease[],
  query: TorrentDiscoveryQuery,
): TorrentDiscoveryResponse | null {
  const checkedAt = new Date().toISOString();
  const candidates = deduplicateReleases(releases).map((release) =>
    mapCandidate(provider, release, query, checkedAt),
  );

  if (candidates.length === 0) return null;

  return {
    query,
    item: {
      type: query.type,
      title: query.title,
      year: query.year,
    },
    candidates,
    sourceProviders: [{ provider, url: providerUrl }],
    checkedAt,
  };
}

function mapCandidate(
  provider: string,
  release: MagnetzTorrentRelease,
  query: TorrentDiscoveryQuery,
  checkedAt: string,
): TorrentCandidate {
  const episode = createTorrentEpisodeRef(query);

  return {
    id: `${provider}:${release.infoHash.toLowerCase()}`,
    provider,
    title: release.title,
    infoHash: release.infoHash,
    sizeBytes: release.sizeBytes,
    publishedAt: release.createdAt,
    ...(episode ? { episode } : {}),
    release: mapTorrentReleaseTitle(release.title),
    peers: {
      seeders: release.seeders,
      leechers: release.leechers,
      checkedAt,
    },
    handoff: {
      kind: "magnet",
      uri: createCanonicalMagnetUri(release.infoHash, release.title),
    },
    availability: release.seeders > 0 ? "available" : "unseeded",
    sourceUrl: release.sourceUrl,
  };
}

function deduplicateReleases(releases: MagnetzTorrentRelease[]): MagnetzTorrentRelease[] {
  const seen = new Set<string>();

  return releases.filter((release) => {
    if (seen.has(release.infoHash)) return false;
    seen.add(release.infoHash);
    return true;
  });
}
