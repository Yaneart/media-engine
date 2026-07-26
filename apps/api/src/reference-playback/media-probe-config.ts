import { isAbsolute } from 'node:path';
import { hasControlCharacters } from './torrserver/validation';

export const DEFAULT_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS = 20_000;
export const TORRENT_PLAYBACK_MEDIA_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
export const TORRENT_PLAYBACK_MEDIA_PROBE_SIZE_BYTES = 8 * 1024 * 1024;
export const TORRENT_PLAYBACK_MEDIA_ANALYZE_DURATION_US = 5_000_000;

const MIN_PROBE_TIMEOUT_MS = 1_000;
const MAX_PROBE_TIMEOUT_MS = 60_000;
const MAX_EXECUTABLE_PATH_LENGTH = 4_096;

export interface TorrentPlaybackMediaProbeEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS?: string;
}

export interface TorrentPlaybackMediaProbeConfig {
  executablePath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  probeSizeBytes: number;
  analyzeDurationUs: number;
}

export function readTorrentPlaybackMediaProbeConfig(
  env: TorrentPlaybackMediaProbeEnv = process.env,
): TorrentPlaybackMediaProbeConfig | undefined {
  const executablePath = readOptional(
    env.MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH,
  );

  if (executablePath === undefined) {
    return undefined;
  }

  if (
    executablePath.length > MAX_EXECUTABLE_PATH_LENGTH ||
    !isAbsolute(executablePath) ||
    hasControlCharacters(executablePath)
  ) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH must be a bounded absolute path without control characters.',
    );
  }

  return {
    executablePath,
    timeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS',
      DEFAULT_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS,
      MIN_PROBE_TIMEOUT_MS,
      MAX_PROBE_TIMEOUT_MS,
    ),
    maxOutputBytes: TORRENT_PLAYBACK_MEDIA_PROBE_MAX_OUTPUT_BYTES,
    probeSizeBytes: TORRENT_PLAYBACK_MEDIA_PROBE_SIZE_BYTES,
    analyzeDurationUs: TORRENT_PLAYBACK_MEDIA_ANALYZE_DURATION_US,
  };
}

function readOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function readInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const normalized = readOptional(value);

  if (normalized === undefined) {
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
