import {
  OriginalTorrentRangeInputError,
  isOriginalTorrentHttpDate,
  parseOriginalTorrentIfRange,
  parseOriginalTorrentRange,
} from './stream-range';

describe('original torrent Range parsing', () => {
  it('preserves full requests and canonicalizes closed/open/suffix ranges', () => {
    expect(parseOriginalTorrentRange(undefined, 100)).toEqual({ kind: 'full' });
    expect(parseOriginalTorrentRange('bytes=10-19', 100)).toEqual({
      kind: 'partial',
      start: 10,
      end: 19,
      length: 10,
      header: 'bytes=10-19',
    });
    expect(parseOriginalTorrentRange('bytes=90-', 100)).toMatchObject({
      kind: 'partial',
      start: 90,
      end: 99,
      length: 10,
    });
    expect(parseOriginalTorrentRange('bytes=-20', 100)).toMatchObject({
      kind: 'partial',
      start: 80,
      end: 99,
      length: 20,
    });
    expect(parseOriginalTorrentRange('bytes=-200', 100)).toMatchObject({
      start: 0,
      end: 99,
    });
    expect(parseOriginalTorrentRange('bytes=90-1000', 100)).toMatchObject({
      start: 90,
      end: 99,
    });
  });

  it.each([
    ['bytes=100-', 100],
    ['bytes=20-10', 100],
    ['bytes=-0', 100],
    ['bytes=0-0', 0],
  ])('reports syntactically valid unsatisfiable range %s', (value, length) => {
    expect(parseOriginalTorrentRange(value, length)).toEqual({
      kind: 'unsatisfiable',
    });
  });

  it.each([
    '',
    'items=0-1',
    'bytes=-',
    'bytes=0-1,5-6',
    'bytes= 0-1',
    'bytes=+1-2',
    `bytes=${'1'.repeat(129)}-`,
  ])('rejects malformed or amplified range %s', (value) => {
    expect(() => parseOriginalTorrentRange(value, 100)).toThrow(
      OriginalTorrentRangeInputError,
    );
  });

  it('accepts bounded strong validators and HTTP dates for If-Range', () => {
    expect(parseOriginalTorrentIfRange(undefined)).toBeUndefined();
    expect(parseOriginalTorrentIfRange('"etag-value"')).toBe('"etag-value"');
    expect(parseOriginalTorrentIfRange('Wed, 21 Oct 2015 07:28:00 GMT')).toBe(
      'Wed, 21 Oct 2015 07:28:00 GMT',
    );
    expect(() => parseOriginalTorrentIfRange('W/"weak"')).toThrow(/If-Range/u);
    expect(() => parseOriginalTorrentIfRange('0')).toThrow(/If-Range/u);
    expect(() =>
      parseOriginalTorrentIfRange('Thu, 21 Oct 2015 07:28:00 GMT'),
    ).toThrow(/If-Range/u);
    expect(() => parseOriginalTorrentIfRange(['"a"', '"b"'])).toThrow(
      /If-Range/u,
    );
    expect(isOriginalTorrentHttpDate('Wed, 21 Oct 2015 07:28:00 GMT')).toBe(
      true,
    );
  });
});
