import type {
  TorrentDiscoveryQuery,
  TorrentEpisodeRef,
  TorrentReleaseInfo,
} from "@media-engine/core";

export function mapTorrentReleaseTitle(title: string): TorrentReleaseInfo {
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

export function createTorrentEpisodeRef(
  query: TorrentDiscoveryQuery,
): TorrentEpisodeRef | undefined {
  if (query.absoluteEpisodeNumber !== undefined) {
    return { absoluteEpisodeNumber: query.absoluteEpisodeNumber };
  }
  if (query.seasonNumber === undefined) return undefined;

  return {
    seasonNumber: query.seasonNumber,
    ...(query.episodeNumber !== undefined ? { episodeNumber: query.episodeNumber } : {}),
  };
}

export function createCanonicalMagnetUri(hash: string, title: string): string {
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
