import { BadRequestException } from '@nestjs/common';
import type { MediaType, TorrentDiscoveryQuery } from '@media-engine/core';

export type TorrentDiscoveryHttpQuery = Record<string, unknown>;

const MEDIA_TYPES = new Set<MediaType>(['movie', 'series', 'anime']);
const EXTERNAL_ID_KEYS = [
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
] as const satisfies readonly (keyof TorrentDiscoveryQuery)[];
const NESTED_ONLY_EXTERNAL_ID_KEYS = ['worldArt'] as const;
const SUPPORTED_QUERY_KEYS = new Set([
  'type',
  'title',
  'year',
  'seasonNumber',
  'episodeNumber',
  'absoluteEpisodeNumber',
  'providers',
  'language',
  'limit',
  ...EXTERNAL_ID_KEYS,
  ...EXTERNAL_ID_KEYS.map((key) => `ids.${key}`),
  ...NESTED_ONLY_EXTERNAL_ID_KEYS.map((key) => `ids.${key}`),
]);

const MAX_TITLE_LENGTH = 300;
const MAX_LANGUAGE_LENGTH = 35;
const MAX_EXTERNAL_ID_LENGTH = 128;
const MAX_PROVIDER_FILTER_LENGTH = 100;
const MAX_PROVIDER_FILTERS = 100;
const MAX_TORRENT_LIMIT = 100;

// Convert the bounded public HTTP shape into the package-owned discovery query.
// Преобразует ограниченную публичную HTTP-форму в package-owned discovery query.
export function parseTorrentDiscoveryQuery(
  query: TorrentDiscoveryHttpQuery,
): TorrentDiscoveryQuery {
  rejectUnknownParameters(query);

  const type = readMediaType(query.type);
  const parsed: TorrentDiscoveryQuery = { type };
  const title = readString(query.title, 'title', MAX_TITLE_LENGTH);
  const language = readString(query.language, 'language', MAX_LANGUAGE_LENGTH);
  const providers = readStringList(query.providers);

  if (title !== undefined) parsed.title = title;
  if (language !== undefined) parsed.language = language;
  if (providers.length > 0) parsed.providers = providers;

  copyInteger(query, parsed, 'year');
  copyInteger(query, parsed, 'seasonNumber');
  copyInteger(query, parsed, 'episodeNumber');
  copyInteger(query, parsed, 'absoluteEpisodeNumber');

  const limit = readInteger(query.limit, 'limit', MAX_TORRENT_LIMIT);
  if (limit !== undefined) parsed.limit = limit;

  for (const key of EXTERNAL_ID_KEYS) {
    const value =
      readString(query[key], key, MAX_EXTERNAL_ID_LENGTH) ??
      readString(query[`ids.${key}`], `ids.${key}`, MAX_EXTERNAL_ID_LENGTH);

    if (value !== undefined) parsed[key] = value;
  }

  const worldArt = readString(
    query['ids.worldArt'],
    'ids.worldArt',
    MAX_EXTERNAL_ID_LENGTH,
  );
  if (worldArt !== undefined) parsed.ids = { worldArt };

  return parsed;
}

function rejectUnknownParameters(query: TorrentDiscoveryHttpQuery): void {
  const unknown = Object.keys(query).filter(
    (key) => !SUPPORTED_QUERY_KEYS.has(key),
  );

  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unsupported torrent discovery query parameters: ${unknown.join(', ')}.`,
    );
  }
}

function readMediaType(value: unknown): MediaType {
  const type = readString(value, 'type', 16);

  if (type === undefined) {
    throw new BadRequestException('type is required.');
  }

  if (!MEDIA_TYPES.has(type as MediaType)) {
    throw new BadRequestException('type must be movie, series, or anime.');
  }

  return type as MediaType;
}

function copyInteger<
  K extends 'year' | 'seasonNumber' | 'episodeNumber' | 'absoluteEpisodeNumber',
>(
  source: TorrentDiscoveryHttpQuery,
  target: TorrentDiscoveryQuery,
  key: K,
): void {
  const value = readInteger(source[key], key, Number.MAX_SAFE_INTEGER);
  if (value !== undefined) target[key] = value;
}

function readInteger(
  value: unknown,
  field: string,
  max: number,
): number | undefined {
  const raw = readString(value, field, 32);

  if (raw === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new BadRequestException(
      `${field} must be a non-negative base-10 integer.`,
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new BadRequestException(`${field} must be between 0 and ${max}.`);
  }

  return parsed;
}

function readStringList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];

  if (rawValues.some((entry) => typeof entry !== 'string')) {
    throw new BadRequestException('providers must contain only strings.');
  }

  const providers = (rawValues as string[])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (providers.length > MAX_PROVIDER_FILTERS) {
    throw new BadRequestException(
      `providers must contain at most ${MAX_PROVIDER_FILTERS} names.`,
    );
  }
  if (
    providers.some((provider) => provider.length > MAX_PROVIDER_FILTER_LENGTH)
  ) {
    throw new BadRequestException(
      `provider names must contain at most ${MAX_PROVIDER_FILTER_LENGTH} characters.`,
    );
  }

  return [...new Set(providers)];
}

function readString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a single string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > maxLength) {
    throw new BadRequestException(
      `${field} must contain at most ${maxLength} characters.`,
    );
  }

  return normalized;
}
