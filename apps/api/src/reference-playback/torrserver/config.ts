import { hasControlCharacters } from './validation';

export const DEFAULT_TORRSERVER_CONNECT_TIMEOUT_MS = 3_000;
export const DEFAULT_TORRSERVER_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_TORRSERVER_METADATA_TIMEOUT_MS = 30_000;
export const DEFAULT_TORRSERVER_METADATA_POLL_INTERVAL_MS = 250;
export const DEFAULT_TORRSERVER_MAX_CONCURRENCY = 4;
export const DEFAULT_TORRSERVER_MAX_RESPONSE_BYTES = 1024 * 1024;
export const DEFAULT_TORRSERVER_MAX_FILES = 1_000;
export const DEFAULT_TORRSERVER_MAX_PATH_LENGTH = 1_024;
export const DEFAULT_TORRSERVER_MAX_FILE_SIZE_BYTES = 16 * 1024 ** 4;

const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_CONCURRENCY = 32;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_PATH_LENGTH = 4_096;
const MAX_FILE_SIZE_BYTES = Number.MAX_SAFE_INTEGER;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 512;

export interface TorrServerClientEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRSERVER_URL?: string;
  MEDIA_ENGINE_TORRSERVER_USERNAME?: string;
  MEDIA_ENGINE_TORRSERVER_PASSWORD?: string;
  MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_CONCURRENCY?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_RESPONSE_BYTES?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_FILES?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_PATH_LENGTH?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_FILE_SIZE_BYTES?: string;
}

export interface TorrServerClientConfig {
  baseUrl: URL;
  username?: string;
  password?: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  metadataTimeoutMs: number;
  metadataPollIntervalMs: number;
  maxConcurrency: number;
  maxResponseBytes: number;
  maxFiles: number;
  maxPathLength: number;
  maxFileSizeBytes: number;
}

// A missing URL keeps reference playback disabled. Every network target is operator-owned.
export function readTorrServerClientConfig(
  env: TorrServerClientEnv = process.env,
): TorrServerClientConfig | undefined {
  const rawUrl = readOptional(env.MEDIA_ENGINE_TORRSERVER_URL);
  const username = readCredential(
    env.MEDIA_ENGINE_TORRSERVER_USERNAME,
    'MEDIA_ENGINE_TORRSERVER_USERNAME',
    MAX_USERNAME_LENGTH,
  );
  const password = readCredential(
    env.MEDIA_ENGINE_TORRSERVER_PASSWORD,
    'MEDIA_ENGINE_TORRSERVER_PASSWORD',
    MAX_PASSWORD_LENGTH,
  );

  if (rawUrl === undefined) {
    if (username !== undefined || password !== undefined) {
      throw new Error(
        'MEDIA_ENGINE_TORRSERVER_URL is required when TorServer credentials are configured.',
      );
    }

    return undefined;
  }

  if ((username === undefined) !== (password === undefined)) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_USERNAME and MEDIA_ENGINE_TORRSERVER_PASSWORD must be configured together.',
    );
  }

  const connectTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS',
    DEFAULT_TORRSERVER_CONNECT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
  );
  const requestTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS',
    DEFAULT_TORRSERVER_REQUEST_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
  );
  const metadataTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS',
    DEFAULT_TORRSERVER_METADATA_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
  );
  const metadataPollIntervalMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS,
    'MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS',
    DEFAULT_TORRSERVER_METADATA_POLL_INTERVAL_MS,
    1,
    MAX_TIMEOUT_MS,
  );

  if (connectTimeoutMs > requestTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS must not exceed MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS.',
    );
  }

  if (requestTimeoutMs > metadataTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS must not exceed MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS.',
    );
  }

  if (metadataPollIntervalMs >= metadataTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS must be smaller than MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS.',
    );
  }

  return {
    baseUrl: readBaseUrl(rawUrl),
    ...(username === undefined ? {} : { username, password }),
    connectTimeoutMs,
    requestTimeoutMs,
    metadataTimeoutMs,
    metadataPollIntervalMs,
    maxConcurrency: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_CONCURRENCY,
      'MEDIA_ENGINE_TORRSERVER_MAX_CONCURRENCY',
      DEFAULT_TORRSERVER_MAX_CONCURRENCY,
      1,
      MAX_CONCURRENCY,
    ),
    maxResponseBytes: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_RESPONSE_BYTES,
      'MEDIA_ENGINE_TORRSERVER_MAX_RESPONSE_BYTES',
      DEFAULT_TORRSERVER_MAX_RESPONSE_BYTES,
      256,
      MAX_RESPONSE_BYTES,
    ),
    maxFiles: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_FILES,
      'MEDIA_ENGINE_TORRSERVER_MAX_FILES',
      DEFAULT_TORRSERVER_MAX_FILES,
      1,
      MAX_FILES,
    ),
    maxPathLength: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_PATH_LENGTH,
      'MEDIA_ENGINE_TORRSERVER_MAX_PATH_LENGTH',
      DEFAULT_TORRSERVER_MAX_PATH_LENGTH,
      16,
      MAX_PATH_LENGTH,
    ),
    maxFileSizeBytes: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_FILE_SIZE_BYTES,
      'MEDIA_ENGINE_TORRSERVER_MAX_FILE_SIZE_BYTES',
      DEFAULT_TORRSERVER_MAX_FILE_SIZE_BYTES,
      1,
      MAX_FILE_SIZE_BYTES,
    ),
  };
}

function readBaseUrl(value: string): URL {
  if (value.length > MAX_BASE_URL_LENGTH) {
    throw new Error('MEDIA_ENGINE_TORRSERVER_URL is too long.');
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('MEDIA_ENGINE_TORRSERVER_URL must be a valid URL.');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_URL must be an exact HTTP(S) base URL without credentials, query, or fragment.',
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function readCredential(
  value: string | undefined,
  name: string,
  maxLength: number,
): string | undefined {
  const normalized = readOptional(value);

  if (normalized === undefined) {
    return undefined;
  }

  if (normalized.length > maxLength || hasControlCharacters(normalized)) {
    throw new Error(`${name} contains invalid characters or is too long.`);
  }

  return normalized;
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
