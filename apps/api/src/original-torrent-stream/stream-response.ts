import type { Response } from 'express';
import { hasAsciiControlCharacters } from '../text-validation';
import { OriginalTorrentUpstreamStreamError } from './stream.errors';
import {
  isOriginalTorrentHttpDate,
  type OriginalTorrentByteRange,
} from './stream-range';

const MAX_SAFE_HEADER_LENGTH = 512;

export interface SafeOriginalTorrentUpstreamHeaders {
  contentLength: number;
  contentRange?: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

// Validates the exact TorrServer response contract before downstream headers are committed.
// Проверяет точный контракт ответа TorrServer до отправки downstream-заголовков.
export function validateUpstreamResponse(
  response: globalThis.Response,
  fileLength: number,
  range: Exclude<OriginalTorrentByteRange, { kind: 'unsatisfiable' }>,
  hasIfRange: boolean,
): SafeOriginalTorrentUpstreamHeaders {
  const expectedStatus = range.kind === 'partial' ? 206 : 200;
  const acceptedFullForIfRange =
    range.kind === 'partial' && hasIfRange && response.status === 200;
  if (response.status !== expectedStatus && !acceptedFullForIfRange) {
    throw invalidUpstream(
      `TorrServer returned unexpected HTTP ${response.status} for the original-file request.`,
    );
  }
  const contentEncoding = response.headers.get('content-encoding');
  if (
    contentEncoding !== null &&
    contentEncoding.toLowerCase() !== 'identity'
  ) {
    throw invalidUpstream(
      'TorrServer returned an encoded original-file response.',
    );
  }
  const contentLength = readExactLength(response.headers.get('content-length'));
  const expectedLength =
    response.status === 206 && range.kind === 'partial'
      ? range.length
      : fileLength;
  if (contentLength !== expectedLength) {
    throw invalidUpstream(
      'TorrServer Content-Length does not match the recorded original file range.',
    );
  }

  let contentRange: string | undefined;
  if (response.status === 206 && range.kind === 'partial') {
    contentRange = response.headers.get('content-range') ?? undefined;
    const expected = `bytes ${range.start}-${range.end}/${fileLength}`;
    if (contentRange !== expected) {
      throw invalidUpstream(
        'TorrServer Content-Range does not match the requested original file range.',
      );
    }
  } else if (response.headers.has('content-range')) {
    throw invalidUpstream(
      'TorrServer returned Content-Range for a full response.',
    );
  }

  return {
    contentLength,
    ...(contentRange === undefined ? {} : { contentRange }),
    contentType: readContentType(response.headers.get('content-type')),
    ...readValidators(response.headers),
  };
}

export function writeResponseHeaders(
  response: Response,
  status: number,
  headers: SafeOriginalTorrentUpstreamHeaders,
): void {
  response.statusCode = status;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Length', String(headers.contentLength));
  response.setHeader('Content-Type', headers.contentType);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (headers.contentRange !== undefined) {
    response.setHeader('Content-Range', headers.contentRange);
  }
  if (headers.etag !== undefined) response.setHeader('ETag', headers.etag);
  if (headers.lastModified !== undefined) {
    response.setHeader('Last-Modified', headers.lastModified);
  }
}

export function writeUnsatisfiable(
  response: Response,
  fileLength: number,
): void {
  response.status(416);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Range', `bytes */${fileLength}`);
  response.setHeader('Content-Length', '0');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.end();
}

function readExactLength(value: string | null): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw invalidUpstream('TorrServer returned an invalid Content-Length.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidUpstream('TorrServer returned an invalid Content-Length.');
  }
  return parsed;
}

function readContentType(value: string | null): string {
  if (
    value === null ||
    value.length === 0 ||
    value.length > 200 ||
    hasAsciiControlCharacters(value) ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+-]+|"[^"]*"))*$/u.test(
      value,
    )
  ) {
    return 'application/octet-stream';
  }
  return value;
}

function readValidators(
  headers: Headers,
): Pick<SafeOriginalTorrentUpstreamHeaders, 'etag' | 'lastModified'> {
  const etag = readSafeHeader(headers.get('etag'));
  const lastModified = readSafeHeader(headers.get('last-modified'));
  return {
    ...(etag !== undefined && /^(?:W\/)?"[\x20-\x21\x23-\x7e]*"$/u.test(etag)
      ? { etag }
      : {}),
    ...(lastModified !== undefined && isOriginalTorrentHttpDate(lastModified)
      ? { lastModified }
      : {}),
  };
}

function readSafeHeader(value: string | null): string | undefined {
  return value !== null &&
    value.length > 0 &&
    value.length <= MAX_SAFE_HEADER_LENGTH &&
    !hasAsciiControlCharacters(value)
    ? value
    : undefined;
}

export function invalidUpstream(
  message: string,
): OriginalTorrentUpstreamStreamError {
  return new OriginalTorrentUpstreamStreamError(
    { code: 'torrent_stream_failed', message, transient: false },
    false,
  );
}
