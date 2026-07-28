const DEFAULT_EXPECTED_VERSION = 'MatriX.141';
const DEFAULT_CONTROL_CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_CONTROL_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_METADATA_TIMEOUT_MS = 60_000;
const DEFAULT_METADATA_POLL_INTERVAL_MS = 250;
const DEFAULT_COLD_STREAM_HEADER_TIMEOUT_MS = 45_000;
const DEFAULT_COLD_STREAM_INACTIVITY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TORRENT_BYTES = 4 * 1024 * 1024;

const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_VERSION_LENGTH = 128;

export interface OriginalTorrentRuntimeEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRSERVER_URL?: string;
  MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION?: string;
  MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS?: string;
  MEDIA_ENGINE_TORRSERVER_COLD_STREAM_HEADER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_COLD_STREAM_INACTIVITY_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES?: string;
}

export interface OriginalTorrentRuntimeConfig {
  baseUrl: URL;
  expectedVersion: string;
  controlConnectTimeoutMs: number;
  controlRequestTimeoutMs: number;
  metadataTimeoutMs: number;
  metadataPollIntervalMs: number;
  coldStreamHeaderTimeoutMs: number;
  coldStreamInactivityTimeoutMs: number;
  maxTorrentBytes: number;
  maxResponseBytes: number;
  maxFiles: number;
  maxPathLength: number;
  maxFileSizeBytes: number;
  maxConcurrency: number;
  maxQueueSize: number;
  maxControlRetries: number;
  retryDelayMs: number;
}

// A missing URL disables only the app-specific runtime; discovery remains available.
// Отсутствующий URL выключает только app-specific runtime; discovery остается доступным.
export function readOriginalTorrentRuntimeConfig(
  env: OriginalTorrentRuntimeEnv = process.env,
): OriginalTorrentRuntimeConfig | undefined {
  const rawUrl = readOptional(env.MEDIA_ENGINE_TORRSERVER_URL);
  if (rawUrl === undefined) return undefined;

  const connectTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS',
    DEFAULT_CONTROL_CONNECT_TIMEOUT_MS,
    100,
    MAX_TIMEOUT_MS,
  );
  const requestTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS',
    DEFAULT_CONTROL_REQUEST_TIMEOUT_MS,
    100,
    MAX_TIMEOUT_MS,
  );
  const metadataTimeoutMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS',
    DEFAULT_METADATA_TIMEOUT_MS,
    500,
    MAX_TIMEOUT_MS,
  );
  const metadataPollIntervalMs = readInteger(
    env.MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS,
    'MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS',
    DEFAULT_METADATA_POLL_INTERVAL_MS,
    25,
    10_000,
  );

  if (connectTimeoutMs > requestTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS must not exceed the control request timeout.',
    );
  }
  if (requestTimeoutMs > metadataTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS must not exceed the metadata timeout.',
    );
  }
  if (metadataPollIntervalMs >= metadataTimeoutMs) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS must be smaller than the metadata timeout.',
    );
  }

  return {
    baseUrl: readBaseUrl(rawUrl),
    expectedVersion: readExpectedVersion(
      env.MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION,
    ),
    controlConnectTimeoutMs: connectTimeoutMs,
    controlRequestTimeoutMs: requestTimeoutMs,
    metadataTimeoutMs,
    metadataPollIntervalMs,
    coldStreamHeaderTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_COLD_STREAM_HEADER_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRSERVER_COLD_STREAM_HEADER_TIMEOUT_MS',
      DEFAULT_COLD_STREAM_HEADER_TIMEOUT_MS,
      1_000,
      MAX_TIMEOUT_MS,
    ),
    coldStreamInactivityTimeoutMs: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_COLD_STREAM_INACTIVITY_TIMEOUT_MS,
      'MEDIA_ENGINE_TORRSERVER_COLD_STREAM_INACTIVITY_TIMEOUT_MS',
      DEFAULT_COLD_STREAM_INACTIVITY_TIMEOUT_MS,
      1_000,
      MAX_TIMEOUT_MS,
    ),
    maxTorrentBytes: readInteger(
      env.MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES,
      'MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES',
      DEFAULT_MAX_TORRENT_BYTES,
      1_024,
      MAX_TORRENT_BYTES,
    ),
    maxResponseBytes: 2 * 1024 * 1024,
    maxFiles: 2_000,
    maxPathLength: 2_048,
    maxFileSizeBytes: Number.MAX_SAFE_INTEGER,
    maxConcurrency: 4,
    maxQueueSize: 32,
    maxControlRetries: 1,
    retryDelayMs: 100,
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
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_URL must be an exact credential-free HTTP(S) origin.',
    );
  }

  url.pathname = '/';
  return url;
}

function readExpectedVersion(value: string | undefined): string {
  const version = readOptional(value) ?? DEFAULT_EXPECTED_VERSION;
  if (
    version.length > MAX_VERSION_LENGTH ||
    !/^MatriX\.\d+(?:\.\d+)?$/u.test(version)
  ) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION must be an exact MatriX version.',
    );
  }
  return version;
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
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(`${name} must be an exact base-10 integer.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function readOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
