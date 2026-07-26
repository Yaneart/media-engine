export const DEFAULT_TORRENT_PLAYBACK_MAX_STREAMS = 8;
export const DEFAULT_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS = 30_000;
export const DEFAULT_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS = 30_000;

const MAX_STREAMS = 32;
const MIN_HEADER_TIMEOUT_MS = 1_000;
const MIN_IDLE_TIMEOUT_MS = 1_000;
const MAX_STREAM_TIMEOUT_MS = 5 * 60_000;

export interface TorrentPlaybackStreamEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS?: string;
}

export interface TorrentPlaybackStreamConfig {
  maxStreams: number;
  headerTimeoutMs: number;
  idleTimeoutMs: number;
}

export function readTorrentPlaybackStreamConfig(
  env: TorrentPlaybackStreamEnv = process.env,
): TorrentPlaybackStreamConfig {
  return {
    maxStreams: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS',
      DEFAULT_TORRENT_PLAYBACK_MAX_STREAMS,
      1,
      MAX_STREAMS,
    ),
    headerTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS',
      DEFAULT_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS,
      MIN_HEADER_TIMEOUT_MS,
      MAX_STREAM_TIMEOUT_MS,
    ),
    idleTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS',
      DEFAULT_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS,
      MIN_IDLE_TIMEOUT_MS,
      MAX_STREAM_TIMEOUT_MS,
    ),
  };
}

function readInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return defaultValue;
  }

  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`${name} must be an exact base-10 integer.`);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }

  return parsed;
}
