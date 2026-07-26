export const DEFAULT_TORRENT_CANDIDATE_TTL_MS = 5 * 60_000;
export const DEFAULT_TORRENT_CANDIDATE_CATALOG_SIZE = 500;
export const DEFAULT_TORRENT_PLAYBACK_SESSION_TTL_MS = 30 * 60_000;
export const DEFAULT_TORRENT_PLAYBACK_START_TIMEOUT_MS = 120_000;
export const DEFAULT_TORRENT_PLAYBACK_MAX_SESSIONS = 8;
export const DEFAULT_TORRENT_PLAYBACK_MAX_STARTING = 2;
export const DEFAULT_TORRENT_PLAYBACK_MAX_OFFERED_FILES = 100;

const MAX_CANDIDATE_TTL_MS = 30 * 60_000;
const MAX_CANDIDATE_CATALOG_SIZE = 10_000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60_000;
const MAX_START_TIMEOUT_MS = 5 * 60_000;
const MAX_SESSIONS = 64;
const MAX_STARTING = 16;
const MAX_OFFERED_FILES = 1_000;

export interface TorrentPlaybackEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_CANDIDATE_TTL_MS?: string;
  MEDIA_ENGINE_TORRENT_CANDIDATE_CATALOG_SIZE?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_SESSION_TTL_MS?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_OFFERED_FILES?: string;
}

export interface TorrentPlaybackConfig {
  candidateTtlMs: number;
  maxCandidates: number;
  sessionTtlMs: number;
  startTimeoutMs: number;
  maxSessions: number;
  maxStartingSessions: number;
  maxOfferedFiles: number;
}

export function readTorrentPlaybackConfig(
  env: TorrentPlaybackEnv = process.env,
): TorrentPlaybackConfig {
  const maxSessions = readInteger(
    env.MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS,
    'MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS',
    DEFAULT_TORRENT_PLAYBACK_MAX_SESSIONS,
    1,
    MAX_SESSIONS,
  );
  const maxStartingSessions = readInteger(
    env.MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING,
    'MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING',
    DEFAULT_TORRENT_PLAYBACK_MAX_STARTING,
    1,
    MAX_STARTING,
  );

  if (maxStartingSessions > maxSessions) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING must not exceed MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS.',
    );
  }

  return {
    candidateTtlMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_CANDIDATE_TTL_MS,
      'MEDIA_ENGINE_TORRENT_CANDIDATE_TTL_MS',
      DEFAULT_TORRENT_CANDIDATE_TTL_MS,
      1_000,
      MAX_CANDIDATE_TTL_MS,
    ),
    maxCandidates: readInteger(
      env.MEDIA_ENGINE_TORRENT_CANDIDATE_CATALOG_SIZE,
      'MEDIA_ENGINE_TORRENT_CANDIDATE_CATALOG_SIZE',
      DEFAULT_TORRENT_CANDIDATE_CATALOG_SIZE,
      1,
      MAX_CANDIDATE_CATALOG_SIZE,
    ),
    sessionTtlMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_SESSION_TTL_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_SESSION_TTL_MS',
      DEFAULT_TORRENT_PLAYBACK_SESSION_TTL_MS,
      10_000,
      MAX_SESSION_TTL_MS,
    ),
    startTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS',
      DEFAULT_TORRENT_PLAYBACK_START_TIMEOUT_MS,
      1_000,
      MAX_START_TIMEOUT_MS,
    ),
    maxSessions,
    maxStartingSessions,
    maxOfferedFiles: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_OFFERED_FILES,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_OFFERED_FILES',
      DEFAULT_TORRENT_PLAYBACK_MAX_OFFERED_FILES,
      1,
      MAX_OFFERED_FILES,
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
