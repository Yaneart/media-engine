import type { MediaDetails, TorrentCandidate, TorrentDiscoveryQuery } from "../api";
import type {
  OriginalTorrentFailure,
  OriginalTorrentSessionSnapshot,
} from "../api/originalTorrent";

export interface TorrentEpisodeSelection {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
}

export function buildTorrentDiscoveryQuery(
  details: MediaDetails,
  language: string,
  episode: TorrentEpisodeSelection = {},
): TorrentDiscoveryQuery {
  return {
    type: details.type,
    title: details.originalTitle?.trim() || details.title,
    year: details.year,
    ids: details.ids,
    language,
    limit: 25,
    ...episode,
  };
}

export function formatTorrentCandidateMeta(candidate: TorrentCandidate): string {
  return [
    candidate.provider,
    candidate.release?.resolution,
    candidate.release?.source,
    candidate.release?.videoCodec,
    candidate.release?.audioCodec,
    formatBytes(candidate.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatTorrentPeers(candidate: TorrentCandidate): string {
  const seeders = candidate.peers?.seeders;
  const leechers = candidate.peers?.leechers;

  if (seeders === undefined && leechers === undefined) {
    return "Peer availability unknown";
  }

  return `${seeders ?? "?"} seeders · ${leechers ?? "?"} leechers`;
}

export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1_024) return `${bytes} B`;

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1_024;
  let unit = units[0]!;

  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function mapNativeMediaFailure(
  mediaErrorCode: number,
  snapshot?: OriginalTorrentSessionSnapshot,
): OriginalTorrentFailure {
  if (snapshot?.error !== undefined) {
    return snapshot.error;
  }

  if (snapshot?.state === "stopped") {
    return {
      code: "session_stopped",
      message: "The torrent session was stopped.",
      transient: false,
    };
  }

  if (snapshot?.state === "expired") {
    return {
      code: "session_expired",
      message: "The torrent session expired.",
      transient: false,
    };
  }

  if (mediaErrorCode === 3 || mediaErrorCode === 4) {
    return {
      code: "client_format_unsupported",
      message:
        "The original file is available, but this browser cannot decode its container or codecs.",
      transient: false,
    };
  }

  return {
    code: "torrent_stream_failed",
    message: "The browser could not load the original stream. Retry or check the session status.",
    transient: true,
  };
}
