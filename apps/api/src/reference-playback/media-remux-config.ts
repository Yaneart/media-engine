import { isAbsolute, normalize, parse as parsePath } from 'node:path';
import { hasControlCharacters } from './torrserver/validation';

export const DEFAULT_TORRENT_MEDIA_REMUX_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES = 8 * 1024 ** 3;
export const DEFAULT_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY =
  '/var/lib/media-engine/remux';

const MAX_REMUX_TIMEOUT_MS = 30 * 60_000;
const MAX_REMUX_OUTPUT_BYTES = 16 * 1024 ** 3;
const MIN_REMUX_OUTPUT_BYTES = 64 * 1024 ** 2;

export interface TorrentMediaRemuxConfig {
  executablePath: string;
  outputDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface TorrentMediaRemuxEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_REMUX_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES?: string;
}

export function readTorrentMediaRemuxConfig(
  env: TorrentMediaRemuxEnv = process.env,
): TorrentMediaRemuxConfig | undefined {
  const executablePath = readOptional(
    env.MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH,
  );

  if (executablePath === undefined) {
    return undefined;
  }

  const outputDirectory = readAbsolutePath(
    readOptional(env.MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY) ??
      DEFAULT_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY,
    'MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY',
  );

  if (outputDirectory === parsePath(outputDirectory).root) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY must not be a filesystem root.',
    );
  }

  return {
    executablePath: readAbsolutePath(
      executablePath,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH',
    ),
    outputDirectory,
    timeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_REMUX_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_MEDIA_REMUX_TIMEOUT_MS',
      DEFAULT_TORRENT_MEDIA_REMUX_TIMEOUT_MS,
      10_000,
      MAX_REMUX_TIMEOUT_MS,
    ),
    maxOutputBytes: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES,
      'MEDIA_ENGINE_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES',
      DEFAULT_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES,
      MIN_REMUX_OUTPUT_BYTES,
      MAX_REMUX_OUTPUT_BYTES,
    ),
  };
}

function readAbsolutePath(value: string, name: string): string {
  if (
    value.length > 1_024 ||
    hasControlCharacters(value) ||
    !isAbsolute(value)
  ) {
    throw new Error(`${name} must be a bounded absolute path.`);
  }

  return normalize(value);
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

  if (normalized === undefined) return defaultValue;

  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`${name} must be an exact base-10 integer.`);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }

  return parsed;
}
