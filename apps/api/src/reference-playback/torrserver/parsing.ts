import type { TorrServerClientConfig } from './config';
import { TorrServerClientError } from './errors';
import {
  TORRSERVER_INFO_HASH_PATTERN,
  type TorrServerFile,
  type TorrServerTorrent,
  type TorrServerTorrentState,
} from './types';
import { hasControlCharacters } from './validation';

const MAX_LABEL_LENGTH = 256;
const MAX_NAME_LENGTH = 1_024;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;

export function parseTorrentResponse(
  value: unknown,
  config: TorrServerClientConfig,
): TorrServerTorrent {
  const record = requireRecord(value, 'torrent status');
  const hash = requireInfoHash(record.hash);
  const state = requireState(record.stat);
  const stateLabel = requireBoundedString(
    record.stat_string,
    'stat_string',
    MAX_LABEL_LENGTH,
  );
  const name = optionalBoundedString(record.name, 'name', MAX_NAME_LENGTH);
  const loadedSize = optionalBoundedInteger(
    record.loaded_size,
    'loaded_size',
    Number.MAX_SAFE_INTEGER,
  );
  const torrentSize = optionalBoundedInteger(
    record.torrent_size,
    'torrent_size',
    Number.MAX_SAFE_INTEGER,
  );
  const files = parseFiles(record.file_stats, config);

  if (files.length > 0) {
    const totalFileSize = files.reduce((total, file) => total + file.length, 0);

    if (!Number.isSafeInteger(totalFileSize)) {
      throw invalidResponse(
        'TorServer file sizes exceed the safe numeric range.',
      );
    }

    if (torrentSize > 0 && totalFileSize > torrentSize) {
      throw invalidResponse(
        'TorServer file sizes are inconsistent with the torrent size.',
      );
    }
  }

  return {
    hash,
    state,
    stateLabel,
    ...(name === undefined ? {} : { name }),
    loadedSize,
    torrentSize,
    files,
  };
}

export function normalizeInfoHash(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!TORRSERVER_INFO_HASH_PATTERN.test(normalized)) {
    throw new TorrServerClientError(
      'rejected',
      'TorServer info hash must contain exactly 40 hexadecimal characters.',
    );
  }

  return normalized;
}

export function normalizeFileId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new TorrServerClientError(
      'rejected',
      'TorServer file ID is outside the accepted range.',
    );
  }

  return value;
}

export function normalizeMagnet(value: string): {
  value: string;
  infoHash: string;
} {
  const normalized = value.trim();

  if (
    normalized.length < 20 ||
    normalized.length > 16_384 ||
    !normalized.toLowerCase().startsWith('magnet:?') ||
    hasControlCharacters(normalized)
  ) {
    throw new TorrServerClientError(
      'rejected',
      'TorServer handoff is not a valid bounded magnet URI.',
    );
  }

  let magnet: URL;

  try {
    magnet = new URL(normalized);
  } catch {
    throw invalidMagnetError();
  }

  const exactTopics = magnet.searchParams.getAll('xt');
  const hashes = exactTopics.flatMap((topic) => {
    const match = /^urn:btih:([a-f0-9]{40})$/i.exec(topic);
    return match?.[1] === undefined ? [] : [match[1].toLowerCase()];
  });

  if (hashes.length !== 1) {
    throw invalidMagnetError();
  }

  return { value: normalized, infoHash: hashes[0] };
}

export function normalizeOptionalTitle(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > MAX_NAME_LENGTH || hasControlCharacters(normalized)) {
    throw new TorrServerClientError(
      'rejected',
      'TorServer title contains invalid characters or is too long.',
    );
  }

  return normalized;
}

function parseFiles(
  value: unknown,
  config: TorrServerClientConfig,
): TorrServerFile[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.length > config.maxFiles) {
    throw invalidResponse(
      'TorServer returned an invalid or oversized file list.',
    );
  }

  const ids = new Set<number>();

  return value.map((entry) => {
    const record = requireRecord(entry, 'file');
    const id = requireBoundedInteger(record.id, 'file id', 1_000_000, 1);
    const path = requireSafePath(record.path, config.maxPathLength);
    const length = requireBoundedInteger(
      record.length,
      'file length',
      config.maxFileSizeBytes,
      1,
    );

    if (ids.has(id)) {
      throw invalidResponse('TorServer returned duplicate file IDs.');
    }

    ids.add(id);
    return { id, path, length };
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidResponse(`TorServer returned an invalid ${label}.`);
  }

  return value as Record<string, unknown>;
}

function requireInfoHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidResponse('TorServer returned an invalid info hash.');
  }

  const normalized = value.toLowerCase();

  if (!TORRSERVER_INFO_HASH_PATTERN.test(normalized)) {
    throw invalidResponse('TorServer returned an invalid info hash.');
  }

  return normalized;
}

function requireState(value: unknown): TorrServerTorrentState {
  const state = requireBoundedInteger(value, 'stat', 5);
  return state as TorrServerTorrentState;
}

function optionalBoundedInteger(
  value: unknown,
  label: string,
  max: number,
): number {
  return value === undefined ? 0 : requireBoundedInteger(value, label, max);
}

function requireBoundedInteger(
  value: unknown,
  label: string,
  max: number,
  min = 0,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalidResponse(`TorServer returned an invalid ${label}.`);
  }

  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  return value === undefined || value === ''
    ? undefined
    : requireBoundedString(value, label, maxLength);
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacters(value)
  ) {
    throw invalidResponse(`TorServer returned an invalid ${label}.`);
  }

  return value;
}

function requireSafePath(value: unknown, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacters(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    WINDOWS_DRIVE_PREFIX.test(value)
  ) {
    throw invalidResponse('TorServer returned an unsafe file path.');
  }

  const parts = value.split('/');

  if (
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw invalidResponse('TorServer returned an unsafe file path.');
  }

  return value;
}

function invalidResponse(message: string): TorrServerClientError {
  return new TorrServerClientError('invalid_response', message);
}

function invalidMagnetError(): TorrServerClientError {
  return new TorrServerClientError(
    'rejected',
    'TorServer handoff is not a valid bounded magnet URI.',
  );
}
