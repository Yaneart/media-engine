import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentReleaseInfo,
} from "@media-engine/core";
import type { BitsearchTorrentRelease } from "./client.js";

export function mapBitsearchTorrentResponse(
  provider: string,
  providerUrl: string,
  releases: BitsearchTorrentRelease[],
  query: TorrentDiscoveryQuery,
): TorrentDiscoveryResponse | null {
  const checkedAt = new Date().toISOString();
  const candidates = deduplicateReleases(releases).map((release) =>
    mapCandidate(provider, providerUrl, release, query, checkedAt),
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
  providerUrl: string,
  release: BitsearchTorrentRelease,
  query: TorrentDiscoveryQuery,
  checkedAt: string,
): TorrentCandidate {
  const sourceUrl = new URL(`/torrent/${release.id}`, `${providerUrl}/`).href;
  const episode = createEpisodeRef(query);

  return {
    id: `${provider}:${release.infoHash.toLowerCase()}`,
    provider,
    title: release.title,
    infoHash: release.infoHash,
    ...(release.sizeBytes !== undefined ? { sizeBytes: release.sizeBytes } : {}),
    ...(release.createdAt ? { publishedAt: release.createdAt } : {}),
    ...(episode ? { episode } : {}),
    release: mapRelease(release.title),
    peers: {
      ...(release.seeders !== undefined ? { seeders: release.seeders } : {}),
      ...(release.leechers !== undefined ? { leechers: release.leechers } : {}),
      checkedAt: release.updatedAt ?? checkedAt,
    },
    handoff: {
      kind: "magnet",
      uri: createMagnetUri(release.infoHash, release.title),
    },
    availability:
      release.seeders === undefined ? "unknown" : release.seeders > 0 ? "available" : "unseeded",
    sourceUrl,
  };
}

function mapRelease(title: string): TorrentReleaseInfo {
  const resolution = parseResolution(title);
  const videoCodec = parseVideoCodec(title);
  const audioCodec = parseAudioCodec(title);
  const container = parseContainer(title);
  const hdr = parseHdr(title);

  return {
    source: mapSourceType(title),
    ...(resolution ? { resolution: resolution.label, height: resolution.height } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    ...(container ? { container } : {}),
    ...(hdr.length > 0 ? { hdr } : {}),
  };
}

function createEpisodeRef(query: TorrentDiscoveryQuery) {
  if (query.absoluteEpisodeNumber !== undefined) {
    return { absoluteEpisodeNumber: query.absoluteEpisodeNumber };
  }
  if (query.seasonNumber === undefined) return undefined;

  return {
    seasonNumber: query.seasonNumber,
    ...(query.episodeNumber !== undefined ? { episodeNumber: query.episodeNumber } : {}),
  };
}

function createMagnetUri(hash: string, title: string): string {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

function parseResolution(title: string): { label: string; height: number } | undefined {
  const height = /(?:^|\D)(2160|1080|720|576|480)p(?:\D|$)/iu.exec(title)?.[1];
  if (height) return { label: `${height}p`, height: Number(height) };
  return /(?:^|[^\p{L}\p{N}])(?:4k|uhd)(?:[^\p{L}\p{N}]|$)/iu.test(title)
    ? { label: "2160p", height: 2160 }
    : undefined;
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

function parseAudioCodec(title: string): string | undefined {
  if (/\btruehd\b/iu.test(title)) return "TrueHD";
  if (/\b(?:e-?ac-?3|ddp)\b/iu.test(title)) return "E-AC-3";
  if (/\b(?:ac-?3|dd)\b/iu.test(title)) return "AC-3";
  if (/\bdts(?:-?hd)?\b/iu.test(title)) return "DTS";
  if (/\bflac\b/iu.test(title)) return "FLAC";
  if (/\baac\b/iu.test(title)) return "AAC";
  return undefined;
}

function parseContainer(title: string): string | undefined {
  const match = /(?:^|[^\p{L}\p{N}])(mkv|mp4|avi)(?:[^\p{L}\p{N}]|$)/iu.exec(title);
  return match?.[1]?.toLowerCase();
}

function parseHdr(title: string): string[] {
  const values: string[] = [];

  if (/dolby[ ._-]?vision|\bdv\b/iu.test(title)) values.push("Dolby Vision");
  if (/\bhdr10\+(?![\p{L}\p{N}])/iu.test(title)) values.push("HDR10+");
  else if (/\bhdr10\b/iu.test(title)) values.push("HDR10");
  else if (/\bhdr\b/iu.test(title)) values.push("HDR");

  return values;
}

function deduplicateReleases(releases: BitsearchTorrentRelease[]): BitsearchTorrentRelease[] {
  const seen = new Set<string>();

  return releases.filter((release) => {
    if (seen.has(release.infoHash)) return false;
    seen.add(release.infoHash);
    return true;
  });
}
