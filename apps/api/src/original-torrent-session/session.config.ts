export const DEFAULT_TORRENT_SESSION_TTL_MS = 30 * 60_000;
export const DEFAULT_TORRENT_SESSION_TERMINAL_RETENTION_MS = 5 * 60_000;
export const DEFAULT_TORRENT_SESSION_CLEANUP_INTERVAL_MS = 10_000;
export const DEFAULT_TORRENT_SOURCE_REQUEST_TIMEOUT_MS = 30_000;

const MAX_SESSION_TTL_MS = 24 * 60 * 60_000;
const MAX_TERMINAL_RETENTION_MS = 60 * 60_000;
const MAX_CLEANUP_INTERVAL_MS = 60_000;
const MAX_SOURCE_REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface OriginalTorrentSessionEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_SESSION_TTL_MS?: string;
  MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS?: string;
  MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS?: string;
  MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS?: string;
}

export interface OriginalTorrentSessionConfig {
  sessionTtlMs: number;
  terminalRetentionMs: number;
  cleanupIntervalMs: number;
  sourceRequestTimeoutMs: number;
  maxTorrentBytes: number;
}

export function readOriginalTorrentSessionConfig(
  maxTorrentBytes: number,
  env: OriginalTorrentSessionEnv = process.env,
): OriginalTorrentSessionConfig {
  if (!Number.isSafeInteger(maxTorrentBytes) || maxTorrentBytes < 1_024) {
    throw new Error('Original torrent session maxTorrentBytes is invalid.');
  }

  return {
    sessionTtlMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_SESSION_TTL_MS,
      'MEDIA_ENGINE_TORRENT_SESSION_TTL_MS',
      DEFAULT_TORRENT_SESSION_TTL_MS,
      1_000,
      MAX_SESSION_TTL_MS,
    ),
    terminalRetentionMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS,
      'MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS',
      DEFAULT_TORRENT_SESSION_TERMINAL_RETENTION_MS,
      0,
      MAX_TERMINAL_RETENTION_MS,
    ),
    cleanupIntervalMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS,
      'MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS',
      DEFAULT_TORRENT_SESSION_CLEANUP_INTERVAL_MS,
      100,
      MAX_CLEANUP_INTERVAL_MS,
    ),
    sourceRequestTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS',
      DEFAULT_TORRENT_SOURCE_REQUEST_TIMEOUT_MS,
      100,
      MAX_SOURCE_REQUEST_TIMEOUT_MS,
    ),
    maxTorrentBytes,
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
  if (normalized === undefined || normalized.length === 0) return defaultValue;
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(`${name} must be an exact base-10 integer.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}
