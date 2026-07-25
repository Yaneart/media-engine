import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
} from '@media-engine/core';
import type { TorrServerFile } from './torrserver';
import type {
  TorrentPlaybackCompatibility,
  TorrentPlaybackFile,
} from './types';

const VIDEO_EXTENSIONS = new Set([
  '3gp',
  'avi',
  'flv',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'mts',
  'ogv',
  'rmvb',
  'ts',
  'vob',
  'webm',
  'wmv',
]);
const DIRECT_CONTAINERS = new Set(['m4v', 'mp4', 'ogv', 'webm']);
const REMUX_CONTAINERS = new Set(['avi', 'm2ts', 'mkv', 'mov', 'mts', 'ts']);
const TRANSCODE_CONTAINERS = new Set([
  '3gp',
  'flv',
  'mpeg',
  'mpg',
  'rmvb',
  'vob',
  'wmv',
]);
const TRANSCODE_VIDEO_CODECS = [
  'divx',
  'mpeg-2',
  'mpeg2',
  'theora',
  'vc-1',
  'vc1',
  'xvid',
];
const TRANSCODE_AUDIO_CODECS = ['dts', 'truehd', 'wma'];
const AUXILIARY_PATH_PATTERN =
  /(?:^|[/ ._-])(extras?|featurettes?|samples?|trailers?)(?:[/ ._-]|$)/i;

export interface TorrentFileSelectionResult {
  selected?: TorrentPlaybackFile;
  offeredFiles: TorrentPlaybackFile[];
}

export function selectTorrentFile(
  files: TorrServerFile[],
  candidate: TorrentCandidate,
  query: TorrentDiscoveryQuery,
  offeredFileId: number | undefined,
  maxOfferedFiles: number,
): TorrentFileSelectionResult {
  const videoFiles = files.filter((file) => isVideoPath(file.path));
  const mappedVideoFiles = videoFiles.map((file) =>
    toPlaybackFile(file, candidate),
  );
  const offeredFiles = mappedVideoFiles
    .toSorted((left, right) => right.length - left.length || left.id - right.id)
    .slice(0, maxOfferedFiles);

  if (offeredFileId !== undefined) {
    const selected = mappedVideoFiles.find((file) => file.id === offeredFileId);

    return selected === undefined
      ? { offeredFiles }
      : { selected, offeredFiles };
  }

  const primaryFiles = videoFiles.filter(
    (file) => !AUXILIARY_PATH_PATTERN.test(file.path),
  );
  const episodeFiles = primaryFiles.filter((file) =>
    pathMatchesEpisode(file.path, query),
  );

  if (hasEpisodeQuery(query)) {
    if (episodeFiles.length === 1) {
      return {
        selected: toPlaybackFile(episodeFiles[0], candidate),
        offeredFiles,
      };
    }

    if (
      episodeFiles.length === 0 &&
      primaryFiles.length === 1 &&
      candidateMatchesEpisode(candidate, query)
    ) {
      return {
        selected: toPlaybackFile(primaryFiles[0], candidate),
        offeredFiles,
      };
    }

    return { offeredFiles };
  }

  if (query.type === 'movie' && primaryFiles.length === 1) {
    return {
      selected: toPlaybackFile(primaryFiles[0], candidate),
      offeredFiles,
    };
  }

  return { offeredFiles };
}

export function classifyTorrentFile(
  path: string,
  candidate: TorrentCandidate,
): TorrentPlaybackCompatibility {
  const videoCodec = candidate.release?.videoCodec?.toLowerCase();
  const audioCodec = candidate.release?.audioCodec?.toLowerCase();

  if (
    includesAny(videoCodec, TRANSCODE_VIDEO_CODECS) ||
    includesAny(audioCodec, TRANSCODE_AUDIO_CODECS)
  ) {
    return 'transcode_required';
  }

  const extension = fileExtension(path);

  if (DIRECT_CONTAINERS.has(extension)) {
    return 'direct';
  }

  if (REMUX_CONTAINERS.has(extension)) {
    return 'remux_required';
  }

  if (TRANSCODE_CONTAINERS.has(extension)) {
    return 'transcode_required';
  }

  return 'unknown';
}

function toPlaybackFile(
  file: TorrServerFile,
  candidate: TorrentCandidate,
): TorrentPlaybackFile {
  return {
    ...file,
    compatibility: classifyTorrentFile(file.path, candidate),
  };
}

function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(fileExtension(path));
}

function fileExtension(path: string): string {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex < 0 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

function hasEpisodeQuery(query: TorrentDiscoveryQuery): boolean {
  return (
    query.absoluteEpisodeNumber !== undefined ||
    (query.seasonNumber !== undefined && query.episodeNumber !== undefined)
  );
}

function candidateMatchesEpisode(
  candidate: TorrentCandidate,
  query: TorrentDiscoveryQuery,
): boolean {
  if (
    query.absoluteEpisodeNumber !== undefined &&
    candidate.episode?.absoluteEpisodeNumber !== undefined
  ) {
    const end =
      candidate.episode.absoluteEpisodeNumberEnd ??
      candidate.episode.absoluteEpisodeNumber;
    return (
      query.absoluteEpisodeNumber >= candidate.episode.absoluteEpisodeNumber &&
      query.absoluteEpisodeNumber <= end
    );
  }

  if (
    query.seasonNumber !== undefined &&
    query.episodeNumber !== undefined &&
    candidate.episode?.seasonNumber === query.seasonNumber &&
    candidate.episode.episodeNumber !== undefined
  ) {
    const end =
      candidate.episode.episodeNumberEnd ?? candidate.episode.episodeNumber;
    return (
      query.episodeNumber >= candidate.episode.episodeNumber &&
      query.episodeNumber <= end
    );
  }

  return false;
}

function pathMatchesEpisode(
  path: string,
  query: TorrentDiscoveryQuery,
): boolean {
  const normalized = path.toLowerCase();

  if (query.seasonNumber !== undefined && query.episodeNumber !== undefined) {
    const season = String(query.seasonNumber);
    const episode = String(query.episodeNumber);
    const patterns = [
      new RegExp(
        `(?:^|[^a-z0-9])s0*${season}[^a-z0-9]*e0*${episode}(?:[^0-9]|$)`,
        'i',
      ),
      new RegExp(`(?:^|[^0-9])0*${season}x0*${episode}(?:[^0-9]|$)`, 'i'),
    ];

    if (patterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }
  }

  if (query.absoluteEpisodeNumber !== undefined) {
    const episode = String(query.absoluteEpisodeNumber);
    return new RegExp(
      `(?:^|[/ ._\\-])(?:ep(?:isode)?[ ._\\-]*)?0*${episode}(?:[^0-9]|$)`,
      'i',
    ).test(normalized);
  }

  return false;
}

function includesAny(value: string | undefined, expected: string[]): boolean {
  return value !== undefined && expected.some((item) => value.includes(item));
}
