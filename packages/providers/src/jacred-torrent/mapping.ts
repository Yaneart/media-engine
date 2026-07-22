import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentReleaseInfo,
} from "@media-engine/core";
import type { JacRedTorrentRelease } from "./client.js";

export function mapJacRedTorrentResponse(
  provider: string,
  providerUrl: string,
  releases: JacRedTorrentRelease[],
  query: TorrentDiscoveryQuery,
): TorrentDiscoveryResponse | null {
  const candidates = deduplicateReleases(releases).map((release) =>
    mapCandidate(provider, release, query),
  );

  if (candidates.length === 0) return null;

  const first = releases[0]!;

  return {
    query,
    item: {
      type: query.type,
      title: first.name,
      ...(first.originalName && first.originalName !== first.name
        ? { originalTitle: first.originalName }
        : {}),
      year: first.year,
    },
    candidates,
    sourceProviders: [{ provider, url: providerUrl }],
    checkedAt: new Date().toISOString(),
  };
}

function mapCandidate(
  provider: string,
  release: JacRedTorrentRelease,
  query: TorrentDiscoveryQuery,
): TorrentCandidate {
  return {
    id: `${provider}:${release.infoHash.toLowerCase()}`,
    provider,
    title: release.title,
    infoHash: release.infoHash,
    ...(release.sizeBytes !== undefined ? { sizeBytes: release.sizeBytes } : {}),
    ...(release.createdAt ? { publishedAt: release.createdAt } : {}),
    ...(query.seasonNumber !== undefined ? { episode: { seasonNumber: query.seasonNumber } } : {}),
    release: mapRelease(release),
    peers: {
      ...(release.seeders !== undefined ? { seeders: release.seeders } : {}),
      ...(release.peers !== undefined ? { leechers: release.peers } : {}),
      checkedAt: new Date().toISOString(),
    },
    handoff: {
      kind: "magnet",
      uri: createMagnetUri(release.infoHash, release.title),
    },
    availability:
      release.seeders === undefined ? "unknown" : release.seeders > 0 ? "available" : "unseeded",
    ...(release.sourceUrl ? { sourceUrl: release.sourceUrl } : {}),
  };
}

function mapRelease(release: JacRedTorrentRelease): TorrentReleaseInfo {
  const resolution = release.qualityLabel ?? (release.quality ? `${release.quality}p` : undefined);
  const videoCodec = parseVideoCodec(release.title);
  const container = parseContainer(release.title);
  const hdr = parseHdr(release.videoType, release.title);

  return {
    source: mapSourceType(release.title),
    ...(resolution ? { resolution } : {}),
    ...(release.quality ? { height: release.quality } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(container ? { container } : {}),
    ...(hdr.length > 0 ? { hdr } : {}),
  };
}

function createMagnetUri(hash: string, title: string): string {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

function mapSourceType(title: string): TorrentReleaseInfo["source"] {
  if (/\b(?:blu[ -]?ray|bdremux|bdrip)\b/iu.test(title)) return "bluray";
  if (/\b(?:web[ ._-]?dl|web[ ._-]?rip)\b/iu.test(title)) return "web";
  if (/\bhdtv\b/iu.test(title)) return "hdtv";
  if (/\bdvd(?:rip)?\b/iu.test(title)) return "dvd";
  if (/\b(?:camrip|cam|telesync|telecine|ts)\b/iu.test(title)) return "cam";
  return "unknown";
}

function parseVideoCodec(title: string): string | undefined {
  if (/\bav1\b/iu.test(title)) return "AV1";
  if (/\b(?:h[ .]?265|hevc|x265)\b/iu.test(title)) return "H.265";
  if (/\b(?:h[ .]?264|avc|x264)\b/iu.test(title)) return "H.264";
  if (/\bxvid\b/iu.test(title)) return "Xvid";
  if (/\bmpeg[ -]?2\b/iu.test(title)) return "MPEG-2";
  return undefined;
}

function parseContainer(title: string): string | undefined {
  const match = /(?:^|[^\p{L}\p{N}])(mkv|mp4|avi)(?:[^\p{L}\p{N}]|$)/iu.exec(title);
  return match?.[1]?.toLowerCase();
}

function parseHdr(videoType: string | undefined, title: string): string[] {
  const values: string[] = [];

  if (/dolby[ ._-]?vision|\bdv\b/iu.test(title)) values.push("Dolby Vision");
  if (/\bhdr10\+(?![\p{L}\p{N}])/iu.test(title)) values.push("HDR10+");
  else if (/\bhdr10\b/iu.test(title)) values.push("HDR10");
  else if (videoType?.toLowerCase() === "hdr" || /\bhdr\b/iu.test(title)) values.push("HDR");

  return values;
}

function deduplicateReleases(releases: JacRedTorrentRelease[]): JacRedTorrentRelease[] {
  const seen = new Set<string>();

  return releases.filter((release) => {
    if (seen.has(release.infoHash)) return false;
    seen.add(release.infoHash);
    return true;
  });
}
