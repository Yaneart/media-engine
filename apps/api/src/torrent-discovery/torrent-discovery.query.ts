import { BadRequestException } from '@nestjs/common';
import type {
  ExternalIds,
  MediaType,
  TorrentDiscoveryQuery,
} from '@media-engine/core';
import {
  EXTERNAL_ID_KEYS,
  isMediaType,
  MEDIA_QUERY_BOUNDS,
  NESTED_ONLY_EXTERNAL_ID_KEYS,
  TOP_LEVEL_EXTERNAL_ID_KEYS,
} from '../media-query/media-query.constants';

export type TorrentDiscoveryHttpQuery = Record<string, unknown>;

const SUPPORTED_QUERY_KEYS = new Set([
  'type',
  'title',
  'alternativeTitles',
  'year',
  'seasonNumber',
  'episodeNumber',
  'absoluteEpisodeNumber',
  'providers',
  'language',
  'limit',
  ...TOP_LEVEL_EXTERNAL_ID_KEYS,
  ...EXTERNAL_ID_KEYS.map((key) => `ids.${key}`),
]);

// Convert the bounded public HTTP shape into the package-owned discovery query.
// Преобразует ограниченную публичную HTTP-форму в package-owned discovery query.
export function parseTorrentDiscoveryQuery(
  query: TorrentDiscoveryHttpQuery,
): TorrentDiscoveryQuery {
  rejectUnknownParameters(query);

  const type = readMediaType(query.type);
  const parsed: TorrentDiscoveryQuery = { type };
  const title = readString(
    query.title,
    'title',
    MEDIA_QUERY_BOUNDS.titleLength,
  );
  const alternativeTitles = readRepeatedStringList(
    query.alternativeTitles,
    'alternativeTitles',
    MEDIA_QUERY_BOUNDS.titleLength,
    MEDIA_QUERY_BOUNDS.alternativeTitles,
  );
  const language = readString(
    query.language,
    'language',
    MEDIA_QUERY_BOUNDS.languageLength,
  );
  const providers = readStringList(query.providers);

  if (title !== undefined) parsed.title = title;
  if (alternativeTitles.length > 0) {
    parsed.alternativeTitles = alternativeTitles;
  }
  if (language !== undefined) parsed.language = language;
  if (providers.length > 0) parsed.providers = providers;

  copyInteger(query, parsed, 'year');
  copyInteger(query, parsed, 'seasonNumber');
  copyInteger(query, parsed, 'episodeNumber');
  copyInteger(query, parsed, 'absoluteEpisodeNumber');

  const limit = readInteger(
    query.limit,
    'limit',
    MEDIA_QUERY_BOUNDS.torrentLimit,
  );
  if (limit !== undefined) parsed.limit = limit;

  for (const key of TOP_LEVEL_EXTERNAL_ID_KEYS) {
    const value =
      readString(query[key], key, MEDIA_QUERY_BOUNDS.externalIdLength) ??
      readString(
        query[`ids.${key}`],
        `ids.${key}`,
        MEDIA_QUERY_BOUNDS.externalIdLength,
      );

    if (value !== undefined) parsed[key] = value;
  }

  const nestedIds: ExternalIds = {};
  for (const key of NESTED_ONLY_EXTERNAL_ID_KEYS) {
    const value = readString(
      query[`ids.${key}`],
      `ids.${key}`,
      MEDIA_QUERY_BOUNDS.externalIdLength,
    );
    if (value !== undefined) nestedIds[key] = value;
  }
  if (Object.keys(nestedIds).length > 0) parsed.ids = nestedIds;

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
  const type = readString(value, 'type', MEDIA_QUERY_BOUNDS.mediaTypeLength);

  if (type === undefined) {
    throw new BadRequestException('type is required.');
  }

  if (!isMediaType(type)) {
    throw new BadRequestException('type must be movie, series, or anime.');
  }

  return type;
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

  if (providers.length > MEDIA_QUERY_BOUNDS.providers) {
    throw new BadRequestException(
      `providers must contain at most ${MEDIA_QUERY_BOUNDS.providers} names.`,
    );
  }
  if (
    providers.some(
      (provider) => provider.length > MEDIA_QUERY_BOUNDS.providerNameLength,
    )
  ) {
    throw new BadRequestException(
      `provider names must contain at most ${MEDIA_QUERY_BOUNDS.providerNameLength} characters.`,
    );
  }

  return [...new Set(providers)];
}

function readRepeatedStringList(
  value: unknown,
  field: string,
  maxLength: number,
  maxItems: number,
): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];

  if (rawValues.length > maxItems) {
    throw new BadRequestException(
      `${field} must contain at most ${maxItems} values.`,
    );
  }

  const values = rawValues.map((entry, index) =>
    readString(entry, `${field}[${index}]`, maxLength),
  );
  const unique = new Map<string, string>();

  for (const entry of values) {
    if (entry !== undefined) unique.set(entry.toLocaleLowerCase(), entry);
  }

  return [...unique.values()];
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
