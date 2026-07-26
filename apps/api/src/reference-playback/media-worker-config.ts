import { hasControlCharacters } from './torrserver/validation';

export const DEFAULT_TORRENT_MEDIA_WORKER_PORT = 8080;
export const DEFAULT_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY = 2;
export const DEFAULT_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES = 16 * 1024;
export const DEFAULT_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS = 22_000;
export const DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_TIMEOUT_MS = 25_000;

const MAX_URL_LENGTH = 2_048;
const MAX_CONCURRENCY = 16;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;

export interface TorrentMediaWorkerClientConfig {
  baseUrl: URL;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface TorrentMediaWorkerServerConfig {
  host: string;
  port: number;
  maxConcurrency: number;
  maxRequestBytes: number;
  requestTimeoutMs: number;
}

export interface TorrentMediaWorkerEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_WORKER_HOST?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_WORKER_PORT?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES?: string;
  MEDIA_ENGINE_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS?: string;
}

export function readTorrentMediaWorkerClientConfig(
  env: TorrentMediaWorkerEnv = process.env,
): TorrentMediaWorkerClientConfig | undefined {
  const value = readOptional(
    env.MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL,
  );

  if (value === undefined) {
    return undefined;
  }

  return {
    baseUrl: readBaseUrl(
      value,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL',
    ),
    timeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_TIMEOUT_MS',
      DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_TIMEOUT_MS,
      1_000,
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: 64 * 1024,
  };
}

export function readTorrentMediaWorkerServerConfig(
  env: TorrentMediaWorkerEnv = process.env,
): TorrentMediaWorkerServerConfig {
  const host =
    readOptional(env.MEDIA_ENGINE_TORRENT_MEDIA_WORKER_HOST) ?? '127.0.0.1';

  if (
    host.length > 255 ||
    hasControlCharacters(host) ||
    !/^(?:[A-Za-z0-9.-]+|::|\d{1,3}(?:\.\d{1,3}){3})$/.test(host)
  ) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_MEDIA_WORKER_HOST must be a bounded host literal.',
    );
  }

  return {
    host,
    port: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_WORKER_PORT,
      'MEDIA_ENGINE_TORRENT_MEDIA_WORKER_PORT',
      DEFAULT_TORRENT_MEDIA_WORKER_PORT,
      1,
      65_535,
    ),
    maxConcurrency: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY,
      'MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY',
      DEFAULT_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY,
      1,
      MAX_CONCURRENCY,
    ),
    maxRequestBytes: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES,
      'MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES',
      DEFAULT_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES,
      1_024,
      MAX_REQUEST_BYTES,
    ),
    requestTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS',
      DEFAULT_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS,
      1_000,
      MAX_TIMEOUT_MS,
    ),
  };
}

function readBaseUrl(value: string, name: string): URL {
  if (value.length > MAX_URL_LENGTH || hasControlCharacters(value)) {
    throw new Error(`${name} is too long or contains control characters.`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      `${name} must be an exact HTTP(S) base URL without credentials, query, or fragment.`,
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
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
