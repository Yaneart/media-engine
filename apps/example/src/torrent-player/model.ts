import type {
  MediaDetails,
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentProviderInfo,
} from "../api";
import type {
  OriginalTorrentFailure,
  OriginalTorrentSessionSnapshot,
} from "../api/originalTorrent";

export interface TorrentEpisodeSelection {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
}

const MAX_TORRENT_ALTERNATIVE_TITLES = 20;

export type TorrentSourceGroupKey = "russian" | "international" | "other";

export interface TorrentProviderCandidateGroup {
  provider: string;
  displayName: string;
  candidates: TorrentCandidate[];
}

export interface TorrentSourceGroup {
  key: TorrentSourceGroupKey;
  label: string;
  providers: TorrentProviderCandidateGroup[];
}

export function buildTorrentDiscoveryQuery(
  details: MediaDetails,
  language: string,
  episode: TorrentEpisodeSelection = {},
): TorrentDiscoveryQuery {
  const title = details.originalTitle?.trim() || details.title;
  const alternativeTitles = uniqueTitles([details.title, ...(details.alternativeTitles ?? [])])
    .filter((candidate) => candidate.toLocaleLowerCase() !== title.toLocaleLowerCase())
    .slice(0, MAX_TORRENT_ALTERNATIVE_TITLES);

  return {
    type: details.type,
    title,
    ...(alternativeTitles.length > 0 ? { alternativeTitles } : {}),
    year: details.year,
    ids: details.ids,
    language,
    limit: 25,
    ...episode,
  };
}

function uniqueTitles(values: string[]): string[] {
  const titles = new Map<string, string>();

  for (const value of values) {
    const title = value.trim();
    if (title) titles.set(title.toLocaleLowerCase(), title);
  }

  return [...titles.values()];
}

export function formatTorrentCandidateMeta(candidate: TorrentCandidate): string {
  return [
    candidate.catalogSource?.displayName ?? candidate.catalogSource?.id ?? candidate.provider,
    candidate.release?.resolution,
    candidate.release?.source,
    candidate.release?.videoCodec,
    candidate.release?.audioCodec,
    formatBytes(candidate.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatTorrentCandidateSource(
  candidate: TorrentCandidate,
  providerInfo?: TorrentProviderInfo,
): string {
  const providerName = providerInfo?.catalog?.displayName ?? candidate.provider;
  const catalogSource = candidate.catalogSource?.displayName ?? candidate.catalogSource?.id;
  return catalogSource ? `${providerName} · ${catalogSource}` : providerName;
}

export function groupTorrentCandidates(
  candidates: TorrentCandidate[],
  providerInfos: TorrentProviderInfo[],
): TorrentSourceGroup[] {
  const providerInfoByName = new Map(providerInfos.map((provider) => [provider.name, provider]));
  const groups = new Map<TorrentSourceGroupKey, TorrentSourceGroup>();
  const providerGroups = new Map<string, TorrentProviderCandidateGroup>();

  for (const candidate of candidates) {
    const providerInfo = providerInfoByName.get(candidate.provider);
    const groupKey = resolveSourceGroupKey(providerInfo);
    let group = groups.get(groupKey);

    if (!group) {
      group = { key: groupKey, label: SOURCE_GROUP_LABELS[groupKey], providers: [] };
      groups.set(groupKey, group);
    }

    const providerKey = `${groupKey}\u0000${candidate.provider}`;
    let providerGroup = providerGroups.get(providerKey);

    if (!providerGroup) {
      providerGroup = {
        provider: candidate.provider,
        displayName: providerInfo?.catalog?.displayName ?? candidate.provider,
        candidates: [],
      };
      providerGroups.set(providerKey, providerGroup);
      group.providers.push(providerGroup);
    }

    providerGroup.candidates.push(candidate);
  }

  return (["russian", "international", "other"] as const).flatMap((key) => {
    const group = groups.get(key);
    return group ? [group] : [];
  });
}

const SOURCE_GROUP_LABELS: Record<TorrentSourceGroupKey, string> = {
  russian: "Russian-language catalogs",
  international: "International catalogs",
  other: "Other catalogs",
};

function resolveSourceGroupKey(provider: TorrentProviderInfo | undefined): TorrentSourceGroupKey {
  if (provider?.catalog?.scope === "international") return "international";
  if (
    provider?.catalog?.scope === "regional" &&
    provider.catalog.locale?.toLowerCase().split("-")[0] === "ru"
  ) {
    return "russian";
  }
  return "other";
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

export function shouldIgnoreNativeMediaError(
  eventSessionId: string | undefined,
  currentSessionId: string | undefined,
  stoppingSessionId: string | undefined,
): boolean {
  return (
    eventSessionId === undefined ||
    eventSessionId !== currentSessionId ||
    eventSessionId === stoppingSessionId
  );
}
