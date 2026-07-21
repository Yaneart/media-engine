import { isIP } from 'node:net';

export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 3000;
export const DEFAULT_CORS_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;

const MAX_RATE_LIMIT_WINDOW_MS = 60 * 60_000;
const MAX_RATE_LIMIT_REQUESTS = 10_000;

export interface ApiRuntimeEnv extends NodeJS.ProcessEnv {
  NODE_ENV?: string;
  HOST?: string;
  PORT?: string;
  CORS_ORIGINS?: string;
  MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS?: string;
  MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS?: string;
}

export interface ApiRuntimeConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  corsOrigins: string[];
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

// Parse deployment settings once before Nest starts accepting requests.
// Разбирает настройки deployment один раз до начала приема запросов Nest.
export function readApiRuntimeConfig(
  env: ApiRuntimeEnv = process.env,
): ApiRuntimeConfig {
  const environment = readEnvironment(env.NODE_ENV);

  return {
    environment,
    host: readHost(env.HOST),
    port: readIntegerEnv(env.PORT, {
      name: 'PORT',
      defaultValue: DEFAULT_API_PORT,
      min: 1,
      max: 65_535,
    }),
    corsOrigins: readCorsOrigins(env.CORS_ORIGINS, environment),
    rateLimit: {
      windowMs: readIntegerEnv(env.MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS, {
        name: 'MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS',
        defaultValue: DEFAULT_RATE_LIMIT_WINDOW_MS,
        min: 1_000,
        max: MAX_RATE_LIMIT_WINDOW_MS,
      }),
      maxRequests: readIntegerEnv(env.MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS, {
        name: 'MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS',
        defaultValue: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
        min: 0,
        max: MAX_RATE_LIMIT_REQUESTS,
      }),
    },
  };
}

function readEnvironment(
  value: string | undefined,
): ApiRuntimeConfig['environment'] {
  const normalized = value?.trim() || 'development';

  if (
    normalized !== 'development' &&
    normalized !== 'test' &&
    normalized !== 'production'
  ) {
    throw new Error(
      'NODE_ENV must be exactly development, test, or production.',
    );
  }

  return normalized;
}

function readHost(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_API_HOST;

  if (isIP(normalized) !== 0 || normalized === 'localhost') {
    return normalized;
  }

  if (
    normalized.length <= 253 &&
    normalized.split('.').every(isValidHostnameLabel)
  ) {
    return normalized;
  }

  throw new Error('HOST must be an IP address or a valid hostname.');
}

function isValidHostnameLabel(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function readCorsOrigins(
  value: string | undefined,
  environment: ApiRuntimeConfig['environment'],
): string[] {
  if (value === undefined) {
    if (environment === 'production') {
      throw new Error('CORS_ORIGINS must be set explicitly in production.');
    }

    return [...DEFAULT_CORS_ORIGINS];
  }

  const origins = value.split(',').map((origin) => origin.trim());

  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    throw new Error(
      'CORS_ORIGINS must be a comma-separated list of exact HTTP(S) origins.',
    );
  }

  for (const origin of origins) {
    validateCorsOrigin(origin);
  }

  return [...new Set(origins)];
}

function validateCorsOrigin(origin: string): void {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.origin !== origin
  ) {
    throw new Error(
      `CORS_ORIGINS must contain exact HTTP(S) origins without paths or credentials: ${origin}`,
    );
  }
}

function readIntegerEnv(
  value: string | undefined,
  options: {
    name: string;
    defaultValue: number;
    min: number;
    max: number;
  },
): number {
  if (value === undefined) {
    return options.defaultValue;
  }

  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${options.name} must be an exact base-10 integer.`);
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    throw new Error(
      `${options.name} must be between ${options.min} and ${options.max}.`,
    );
  }

  return parsed;
}
