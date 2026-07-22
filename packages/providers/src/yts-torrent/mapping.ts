import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentReleaseInfo,
} from "@media-engine/core";
import { normalizeProviderSearchText } from "../shared/mapping.js";
import type { YtsTorrentMovie, YtsTorrentRelease } from "./client.js";

export function selectYtsTorrentMovie(
  movies: YtsTorrentMovie[],
  query: TorrentDiscoveryQuery,
): YtsTorrentMovie | undefined {
  const imdb = query.ids?.imdb ?? query.imdb;

  if (imdb) {
    const matching = movies.filter((movie) => movie.imdb === imdb.toLowerCase());
    return matching.length === 1 ? matching[0] : undefined;
  }

  const title = query.title?.trim();
  if (!title || !Number.isInteger(query.year)) return undefined;

  const normalizedTitle = normalizeProviderSearchText(title);
  const matching = movies.filter(
    (movie) =>
      movie.year === query.year &&
      [movie.title, movie.englishTitle].some(
        (candidate) => candidate && normalizeProviderSearchText(candidate) === normalizedTitle,
      ),
  );

  return matching.length === 1 ? matching[0] : undefined;
}

export function mapYtsTorrentResponse(
  provider: string,
  movie: YtsTorrentMovie,
  query: TorrentDiscoveryQuery,
): TorrentDiscoveryResponse | null {
  const candidates = deduplicateReleases(movie.torrents).map((torrent) =>
    mapCandidate(provider, movie, torrent),
  );

  if (candidates.length === 0) return null;

  return {
    query,
    item: {
      type: "movie",
      title: movie.title,
      ...(movie.englishTitle ? { originalTitle: movie.englishTitle } : {}),
      year: movie.year,
      ids: { imdb: movie.imdb },
    },
    candidates,
    sourceProviders: [
      {
        provider,
        ...(movie.sourceUrl ? { url: movie.sourceUrl } : {}),
        ids: { imdb: movie.imdb },
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

function mapCandidate(
  provider: string,
  movie: YtsTorrentMovie,
  torrent: YtsTorrentRelease,
): TorrentCandidate {
  const title = createCandidateTitle(movie, torrent);

  return {
    id: `${provider}:${torrent.hash.toLowerCase()}`,
    provider,
    title,
    infoHash: torrent.hash,
    ...(torrent.sizeBytes !== undefined ? { sizeBytes: torrent.sizeBytes } : {}),
    ...(torrent.uploadedAt ? { publishedAt: torrent.uploadedAt } : {}),
    release: mapRelease(torrent),
    peers: {
      ...(torrent.seeders !== undefined ? { seeders: torrent.seeders } : {}),
      ...(torrent.leechers !== undefined ? { leechers: torrent.leechers } : {}),
      checkedAt: new Date().toISOString(),
    },
    handoff: {
      kind: "magnet",
      uri: createMagnetUri(torrent.hash, title),
    },
    availability:
      torrent.seeders === undefined ? "unknown" : torrent.seeders > 0 ? "available" : "unseeded",
    ...(movie.sourceUrl ? { sourceUrl: movie.sourceUrl } : {}),
  };
}

function mapRelease(torrent: YtsTorrentRelease): TorrentReleaseInfo {
  const height = parseResolutionHeight(torrent.quality);

  return {
    source: mapSourceType(torrent.sourceType),
    resolution: torrent.quality,
    ...(height ? { height } : {}),
    ...(torrent.videoCodec ? { videoCodec: torrent.videoCodec } : {}),
  };
}

function createCandidateTitle(movie: YtsTorrentMovie, torrent: YtsTorrentRelease): string {
  const source = torrent.sourceType ? ` ${torrent.sourceType.toUpperCase()}` : "";
  return `${movie.title} (${movie.year}) ${torrent.quality}${source} [YTS]`;
}

function createMagnetUri(hash: string, title: string): string {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

function parseResolutionHeight(value: string): number | undefined {
  const match = /(?:^|\D)(\d{3,4})p(?:\D|$)/iu.exec(value);
  const height = match?.[1] ? Number(match[1]) : undefined;
  return height && height >= 240 && height <= 4_320 ? height : undefined;
}

function mapSourceType(value: string | undefined): TorrentReleaseInfo["source"] {
  const normalized = value?.toLowerCase();

  if (normalized?.includes("bluray") || normalized?.includes("blu-ray")) return "bluray";
  if (normalized?.includes("web")) return "web";
  if (normalized?.includes("hdtv")) return "hdtv";
  if (normalized?.includes("dvd")) return "dvd";
  if (normalized?.includes("cam")) return "cam";
  return "unknown";
}

function deduplicateReleases(releases: YtsTorrentRelease[]): YtsTorrentRelease[] {
  const seen = new Set<string>();

  return releases.filter((release) => {
    if (seen.has(release.hash)) return false;
    seen.add(release.hash);
    return true;
  });
}
