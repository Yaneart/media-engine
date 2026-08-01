import { OriginalTorrentUpstreamStreamError } from './stream.errors';
import type { OriginalTorrentByteRange } from './stream-range';
import { validateUpstreamResponse } from './stream-response';

type SatisfiableRange = Exclude<
  OriginalTorrentByteRange,
  { kind: 'unsatisfiable' }
>;

const FULL_RANGE = { kind: 'full' } as const;
const PARTIAL_RANGE = {
  kind: 'partial',
  start: 10,
  end: 19,
  length: 10,
  header: 'bytes=10-19',
} as const;

describe('original torrent upstream response contract', () => {
  it('accepts exact full, partial, and If-Range fallback responses', () => {
    expect(
      validateUpstreamResponse(
        response(200, {
          'content-length': '100',
          'content-type': 'video/mp4',
          etag: 'W/"fixture"',
          'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
        }),
        100,
        FULL_RANGE,
        false,
      ),
    ).toEqual({
      contentLength: 100,
      contentType: 'video/mp4',
      etag: 'W/"fixture"',
      lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
    });

    expect(
      validateUpstreamResponse(
        response(206, {
          'content-length': '10',
          'content-range': 'bytes 10-19/100',
        }),
        100,
        PARTIAL_RANGE,
        false,
      ),
    ).toEqual({
      contentLength: 10,
      contentRange: 'bytes 10-19/100',
      contentType: 'application/octet-stream',
    });

    expect(
      validateUpstreamResponse(
        response(200, { 'content-length': '100' }),
        100,
        PARTIAL_RANGE,
        true,
      ),
    ).toMatchObject({ contentLength: 100 });
  });

  it.each<[string, Response, SatisfiableRange, boolean, RegExp]>([
    [
      'unexpected status',
      response(201, { 'content-length': '100' }),
      FULL_RANGE,
      false,
      /unexpected HTTP 201/u,
    ],
    [
      'encoded bytes',
      response(200, {
        'content-length': '100',
        'content-encoding': 'gzip',
      }),
      FULL_RANGE,
      false,
      /encoded original-file response/u,
    ],
    [
      'missing length',
      response(200),
      FULL_RANGE,
      false,
      /invalid Content-Length/u,
    ],
    [
      'unsafe length',
      response(200, { 'content-length': '9007199254740992' }),
      FULL_RANGE,
      false,
      /invalid Content-Length/u,
    ],
    [
      'mismatched length',
      response(200, { 'content-length': '99' }),
      FULL_RANGE,
      false,
      /does not match the recorded original file range/u,
    ],
    [
      'mismatched partial range',
      response(206, {
        'content-length': '10',
        'content-range': 'bytes 11-20/100',
      }),
      PARTIAL_RANGE,
      false,
      /does not match the requested original file range/u,
    ],
    [
      'range on a full response',
      response(200, {
        'content-length': '100',
        'content-range': 'bytes 0-99/100',
      }),
      FULL_RANGE,
      false,
      /Content-Range for a full response/u,
    ],
  ])(
    'rejects %s before downstream headers',
    (_, upstream, range, ifRange, message) => {
      expect(() =>
        validateUpstreamResponse(upstream, 100, range, ifRange),
      ).toThrow(message);
    },
  );

  it('falls back from malformed optional content headers without forwarding them', () => {
    const headers = validateUpstreamResponse(
      response(200, {
        'content-length': '100',
        'content-type': 'not-a-media-type',
        etag: 'not-an-etag',
        'last-modified': 'yesterday',
      }),
      100,
      FULL_RANGE,
      false,
    );

    expect(headers).toEqual({
      contentLength: 100,
      contentType: 'application/octet-stream',
    });
  });

  it('classifies contract failures as non-retryable stream failures', () => {
    let failure: unknown;
    try {
      validateUpstreamResponse(
        response(200, { 'content-length': '99' }),
        100,
        FULL_RANGE,
        false,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OriginalTorrentUpstreamStreamError);
    expect(failure).toMatchObject({
      retryableBeforeHeaders: false,
      failure: {
        code: 'torrent_stream_failed',
        transient: false,
      },
    });
  });
});

function response(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}
