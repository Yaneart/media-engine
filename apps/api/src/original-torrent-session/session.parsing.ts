import type {
  ExternalIds,
  MediaType,
  TorrentDiscoveryQuery,
} from '@media-engine/core';
import { OriginalTorrentSessionInputError } from './session.errors';
import type {
  CreateOriginalTorrentSessionInput,
  TorrentObservationSelection,
} from './session.types';

const MEDIA_TYPES = new Set<MediaType>(['movie', 'series', 'anime']);
const QUERY_KEYS = new Set([
  'type',
  'ids',
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
  'title',
  'alternativeTitles',
  'year',
  'seasonNumber',
  'episodeNumber',
  'absoluteEpisodeNumber',
  'language',
]);
const EXTERNAL_ID_KEYS = [
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
  'worldArt',
] as const satisfies readonly (keyof ExternalIds)[];
const DIRECT_ID_KEYS = [
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
] as const;
const SESSION_ID = /^[A-Za-z0-9_-]{32}$/u;
const MAX_ALTERNATIVE_TITLES = 20;

export function parseCreateOriginalTorrentSessionBody(
  value: unknown,
): CreateOriginalTorrentSessionInput {
  const body = readRecord(value, 'request body');
  rejectUnknownKeys(body, new Set(['query', 'observation']), 'request body');
  const observation = parseObservation(body.observation);

  return {
    query: parseDiscoveryQuery(body.query),
    observation,
  };
}

export function parseOriginalTorrentFileSelectionBody(value: unknown): number {
  const body = readRecord(value, 'file selection body');
  rejectUnknownKeys(body, new Set(['fileId']), 'file selection body');
  return readInteger(body.fileId, 'fileId', 1, 1_000_000, true)!;
}

export function parseOriginalTorrentSessionId(value: string): string {
  if (!SESSION_ID.test(value)) {
    throw new OriginalTorrentSessionInputError('Session ID is invalid.');
  }
  return value;
}

function parseObservation(value: unknown): TorrentObservationSelection {
  const observation = readRecord(value, 'observation');
  rejectUnknownKeys(observation, new Set(['provider', 'id']), 'observation');
  return {
    provider: readString(
      observation.provider,
      'observation.provider',
      100,
      true,
    )!,
    id: readString(observation.id, 'observation.id', 500, true)!,
  };
}

function parseDiscoveryQuery(value: unknown): TorrentDiscoveryQuery {
  const query = readRecord(value, 'query');
  rejectUnknownKeys(query, QUERY_KEYS, 'query');
  const type = readString(query.type, 'query.type', 16, true)!;
  if (!MEDIA_TYPES.has(type as MediaType)) {
    throw new OriginalTorrentSessionInputError(
      'query.type must be movie, series, or anime.',
    );
  }

  const result: TorrentDiscoveryQuery = { type: type as MediaType };
  copyString(query, result, 'title', 300);
  const alternativeTitles = readStringArray(
    query.alternativeTitles,
    'query.alternativeTitles',
    300,
    MAX_ALTERNATIVE_TITLES,
  );
  if (alternativeTitles !== undefined) {
    result.alternativeTitles = alternativeTitles;
  }
  copyString(query, result, 'language', 35);
  copyInteger(query, result, 'year');
  copyInteger(query, result, 'seasonNumber');
  copyInteger(query, result, 'episodeNumber');
  copyInteger(query, result, 'absoluteEpisodeNumber');

  for (const key of DIRECT_ID_KEYS) {
    const direct = readString(query[key], `query.${key}`, 128);
    if (direct !== undefined) result[key] = direct;
  }

  if (query.ids !== undefined) {
    const ids = readRecord(query.ids, 'query.ids');
    rejectUnknownKeys(ids, new Set(EXTERNAL_ID_KEYS), 'query.ids');
    const parsedIds: ExternalIds = {};
    for (const key of EXTERNAL_ID_KEYS) {
      const id = readString(ids[key], `query.ids.${key}`, 128);
      if (id !== undefined) parsedIds[key] = id;
    }
    if (Object.keys(parsedIds).length > 0) result.ids = parsedIds;
  }

  return result;
}

function copyString<K extends 'title' | 'language'>(
  source: Record<string, unknown>,
  target: TorrentDiscoveryQuery,
  key: K,
  maxLength: number,
): void {
  const value = readString(source[key], `query.${key}`, maxLength);
  if (value !== undefined) target[key] = value;
}

function copyInteger<
  K extends 'year' | 'seasonNumber' | 'episodeNumber' | 'absoluteEpisodeNumber',
>(
  source: Record<string, unknown>,
  target: TorrentDiscoveryQuery,
  key: K,
): void {
  const value = readInteger(
    source[key],
    `query.${key}`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (value !== undefined) target[key] = value;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OriginalTorrentSessionInputError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new OriginalTorrentSessionInputError(
      `${field} contains unsupported fields: ${unknown.join(', ')}.`,
    );
  }
}

function readString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new OriginalTorrentSessionInputError(`${field} is required.`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new OriginalTorrentSessionInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    hasControlCharacters(normalized)
  ) {
    throw new OriginalTorrentSessionInputError(
      `${field} must contain between 1 and ${maxLength} safe characters.`,
    );
  }
  return normalized;
}

function readStringArray(
  value: unknown,
  field: string,
  maxLength: number,
  maxItems: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new OriginalTorrentSessionInputError(
      `${field} must contain between 1 and ${maxItems} strings.`,
    );
  }

  return value.map((entry, index) =>
    readString(entry, `${field}[${index}]`, maxLength, true),
  ) as string[];
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function readInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  required = false,
): number | undefined {
  if (value === undefined) {
    if (required) {
      throw new OriginalTorrentSessionInputError(`${field} is required.`);
    }
    return undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new OriginalTorrentSessionInputError(
      `${field} must be an integer between ${min} and ${max}.`,
    );
  }
  return Number(value);
}
