export type OriginalTorrentByteRange =
  | { kind: 'full' }
  | { kind: 'unsatisfiable' }
  | {
      kind: 'partial';
      start: number;
      end: number;
      length: number;
      header: string;
    };

export class OriginalTorrentRangeInputError extends Error {
  override readonly name = 'OriginalTorrentRangeInputError';
}

const MAX_RANGE_HEADER_LENGTH = 128;
const MAX_IF_RANGE_LENGTH = 256;

export function parseOriginalTorrentRange(
  value: string | string[] | undefined,
  fileLength: number,
): OriginalTorrentByteRange {
  if (!Number.isSafeInteger(fileLength) || fileLength < 0) {
    throw new Error('Recorded torrent file length is invalid.');
  }
  if (value === undefined) return { kind: 'full' };
  if (
    Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_RANGE_HEADER_LENGTH ||
    value.includes(',')
  ) {
    throw invalidRange();
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (match === null || (match[1] === '' && match[2] === '')) {
    throw invalidRange();
  }
  if (fileLength === 0) return { kind: 'unsatisfiable' };

  if (match[1] === '') {
    const suffixLength = parseRangeInteger(match[2]);
    if (suffixLength === 0) return { kind: 'unsatisfiable' };
    const length = Math.min(suffixLength, fileLength);
    return createPartial(fileLength - length, fileLength - 1);
  }

  const start = parseRangeInteger(match[1]);
  if (start >= fileLength) return { kind: 'unsatisfiable' };
  const requestedEnd =
    match[2] === '' ? fileLength - 1 : parseRangeInteger(match[2]);
  if (requestedEnd < start) return { kind: 'unsatisfiable' };
  return createPartial(start, Math.min(requestedEnd, fileLength - 1));
}

export function parseOriginalTorrentIfRange(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_IF_RANGE_LENGTH ||
    hasControlCharacters(value)
  ) {
    throw new OriginalTorrentRangeInputError('If-Range header is invalid.');
  }
  if (/^"[\x20-\x21\x23-\x7e]*"$/u.test(value)) return value;
  if (!isOriginalTorrentHttpDate(value)) {
    throw new OriginalTorrentRangeInputError('If-Range header is invalid.');
  }
  return value;
}

export function isOriginalTorrentHttpDate(value: string): boolean {
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
      value,
    )
  ) {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value
  );
}

function createPartial(start: number, end: number): OriginalTorrentByteRange {
  return {
    kind: 'partial',
    start,
    end,
    length: end - start + 1,
    header: `bytes=${start}-${end}`,
  };
}

function parseRangeInteger(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw invalidRange();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidRange();
  return parsed;
}

function invalidRange(): OriginalTorrentRangeInputError {
  return new OriginalTorrentRangeInputError(
    'Range must contain one bounded bytes=start-end, bytes=start-, or bytes=-suffix value.',
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
