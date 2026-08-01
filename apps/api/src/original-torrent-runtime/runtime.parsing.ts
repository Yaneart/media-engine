import type { OriginalTorrentRuntimeConfig } from './runtime.config';
import { MAX_ORIGINAL_TORRENT_FILE_ID } from './runtime.constants';
import { OriginalTorrentRuntimeError } from './runtime.errors';
import type {
  OriginalTorrentSource,
  OriginalTorrentStatus,
  TorrServerTorrentState,
} from './runtime.types';

const INFO_HASH_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_TITLE_LENGTH = 1_024;
const MAX_STATE_LABEL_LENGTH = 256;
const MAX_NAME_LENGTH = 1_024;
const MAX_MAGNET_LENGTH = 16_384;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/u;

export function normalizeOriginalTorrentSource(
  source: OriginalTorrentSource,
  config: OriginalTorrentRuntimeConfig,
): OriginalTorrentSource {
  const expectedHash = normalizeInfoHash(source.expectedHash);
  const title = normalizeTitle(source.title);

  if (source.kind === 'magnet') {
    return {
      kind: 'magnet',
      uri: normalizeMagnet(source.uri, expectedHash),
      expectedHash,
      ...(title === undefined ? {} : { title }),
    };
  }

  if (!(source.bytes instanceof Uint8Array)) {
    throw sourceInvalid('Torrent-file source must contain bytes.');
  }
  if (
    source.bytes.byteLength < 1 ||
    source.bytes.byteLength > config.maxTorrentBytes
  ) {
    throw sourceInvalid(
      'Torrent-file source is empty or exceeds the byte limit.',
    );
  }

  return {
    kind: 'torrent_file',
    bytes: new Uint8Array(source.bytes),
    expectedHash,
    ...(title === undefined ? {} : { title }),
  };
}

export function normalizeInfoHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!INFO_HASH_PATTERN.test(normalized)) {
    throw sourceInvalid(
      'Torrent info hash must contain exactly 40 hexadecimal characters.',
    );
  }
  return normalized;
}

export function normalizeFileId(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_ORIGINAL_TORRENT_FILE_ID
  ) {
    throw new OriginalTorrentRuntimeError(
      'file_not_found',
      'The requested TorrServer file ID is outside the accepted range.',
      false,
    );
  }
  return value;
}

export function parseTorrentStatus(
  value: unknown,
  config: OriginalTorrentRuntimeConfig,
): OriginalTorrentStatus {
  const record = requireRecord(value, 'torrent status');
  const hash = requireHash(record.hash);
  const state = requireInteger(record.stat, 'state', 0, 5);
  const stateLabel = requireString(
    record.stat_string,
    'state label',
    MAX_STATE_LABEL_LENGTH,
  );
  const name = optionalString(record.name, 'name', MAX_NAME_LENGTH);
  const loadedSize = optionalInteger(
    record.loaded_size,
    'loaded size',
    Number.MAX_SAFE_INTEGER,
  );
  const torrentSize = optionalInteger(
    record.torrent_size,
    'torrent size',
    Number.MAX_SAFE_INTEGER,
  );
  const files = parseFiles(record.file_stats, config);
  const totalFileSize = files.reduce((total, file) => total + file.length, 0);

  if (!Number.isSafeInteger(totalFileSize)) {
    throw invalidResponse(
      'TorrServer file sizes exceed the safe numeric range.',
    );
  }
  if (torrentSize > 0 && totalFileSize > torrentSize) {
    throw invalidResponse('TorrServer returned inconsistent torrent sizes.');
  }

  return {
    hash,
    state: state as TorrServerTorrentState,
    stateLabel,
    ...(name === undefined ? {} : { name }),
    loadedSize,
    torrentSize,
    files,
  };
}

export function parseTorrentTimestamp(value: unknown): number {
  const record = requireRecord(value, 'torrent status');
  return requireInteger(
    record.timestamp,
    'timestamp',
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function hasTorrentOwnerMarker(value: unknown, marker: string): boolean {
  const record = requireRecord(value, 'torrent status');
  return record.data === marker;
}

export function parseUploadedTorrent(
  value: unknown,
  expectedHash: string,
  config: OriginalTorrentRuntimeConfig,
): OriginalTorrentStatus {
  if (!Array.isArray(value) || value.length !== 1) {
    throw sourceInvalid(
      'TorrServer did not accept exactly one bounded torrent-file source.',
    );
  }
  return requireExpectedHash(
    parseTorrentStatus(value[0], config),
    expectedHash,
  );
}

export function requireExpectedHash(
  torrent: OriginalTorrentStatus,
  expectedHash: string,
): OriginalTorrentStatus {
  if (torrent.hash !== expectedHash) {
    throw sourceInvalid(
      'TorrServer returned a different torrent identity than the resolved source.',
    );
  }
  return torrent;
}

function normalizeMagnet(value: string, expectedHash: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 20 ||
    normalized.length > MAX_MAGNET_LENGTH ||
    hasControlCharacters(normalized) ||
    !normalized.toLowerCase().startsWith('magnet:?')
  ) {
    throw sourceInvalid('Torrent source is not a valid bounded magnet URI.');
  }

  let magnet: URL;
  try {
    magnet = new URL(normalized);
  } catch {
    throw sourceInvalid('Torrent source is not a valid bounded magnet URI.');
  }

  const hashes = magnet.searchParams.getAll('xt').flatMap((topic) => {
    const match = /^urn:btih:([a-f0-9]{40})$/iu.exec(topic);
    return match?.[1] === undefined ? [] : [match[1].toLowerCase()];
  });
  if (hashes.length !== 1 || hashes[0] !== expectedHash) {
    throw sourceInvalid(
      'Torrent magnet identity does not match the server-resolved candidate.',
    );
  }

  return normalized;
}

function normalizeTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  if (
    normalized.length > MAX_TITLE_LENGTH ||
    hasControlCharacters(normalized)
  ) {
    throw sourceInvalid('Torrent source title is invalid or too long.');
  }
  return normalized;
}

function parseFiles(
  value: unknown,
  config: OriginalTorrentRuntimeConfig,
): OriginalTorrentStatus['files'] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > config.maxFiles) {
    throw invalidResponse(
      'TorrServer returned an invalid or oversized file list.',
    );
  }

  const ids = new Set<number>();
  return value.map((entry) => {
    const record = requireRecord(entry, 'file');
    const id = requireInteger(
      record.id,
      'file ID',
      1,
      MAX_ORIGINAL_TORRENT_FILE_ID,
    );
    const path = requireSafePath(record.path, config.maxPathLength);
    const length = requireInteger(
      record.length,
      'file length',
      0,
      config.maxFileSizeBytes,
    );

    if (ids.has(id)) {
      throw invalidResponse('TorrServer returned duplicate file IDs.');
    }
    ids.add(id);
    return { id, path, length };
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidResponse(`TorrServer returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidResponse('TorrServer returned an invalid torrent identity.');
  }
  const normalized = value.toLowerCase();
  if (!INFO_HASH_PATTERN.test(normalized)) {
    throw invalidResponse('TorrServer returned an invalid torrent identity.');
  }
  return normalized;
}

function requireInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalidResponse(`TorrServer returned an invalid ${label}.`);
  }
  return value;
}

function optionalInteger(value: unknown, label: string, max: number): number {
  return value === undefined ? 0 : requireInteger(value, label, 0, max);
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  return value === undefined || value === ''
    ? undefined
    : requireString(value, label, maxLength);
}

function requireString(
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
    throw invalidResponse(`TorrServer returned an invalid ${label}.`);
  }
  return value;
}

function requireSafePath(value: unknown, maxLength: number): string {
  const path = requireString(value, 'file path', maxLength);
  if (
    path.includes('\\') ||
    path.startsWith('/') ||
    WINDOWS_DRIVE_PREFIX.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw invalidResponse('TorrServer returned an unsafe file path.');
  }
  return path;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function sourceInvalid(message: string): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError('source_invalid', message, false);
}

function invalidResponse(message: string): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError('invalid_response', message, false);
}
