import type { TorrentPlaybackSessionService } from './session-service';
import type { TorrServerClientConfig } from './torrserver';
import {
  TorrentPlaybackStreamError,
  TorrentPlaybackStreamGateway,
  type TorrentPlaybackStreamFetch,
} from './stream-gateway';
import type { TorrentPlaybackStreamSource } from './types';

const SESSION_ID = 's'.repeat(43);
const FILE_LENGTH = 1_000;
const SOURCE_CONTROLLER = new AbortController();
const SOURCE: TorrentPlaybackStreamSource = {
  target: {
    url: new URL(`http://torrserver.test/play/${'a'.repeat(40)}/7`),
    kind: 'torrserver',
    hash: 'a'.repeat(40),
    fileId: 7,
  },
  file: {
    id: 7,
    path: 'Movie.mp4',
    length: FILE_LENGTH,
    compatibility: 'direct',
  },
  signal: SOURCE_CONTROLLER.signal,
};
const CLIENT_CONFIG: TorrServerClientConfig = {
  baseUrl: new URL('http://torrserver.test/'),
  username: 'operator',
  password: 'secret',
  connectTimeoutMs: 1_000,
  requestTimeoutMs: 10_000,
  metadataTimeoutMs: 30_000,
  metadataPollIntervalMs: 250,
  maxConcurrency: 4,
  maxResponseBytes: 1024,
  maxFiles: 100,
  maxPathLength: 1024,
  maxFileSizeBytes: 10_000,
};

describe('TorrentPlaybackStreamGateway', () => {
  it('streams a complete representation without forwarding unsafe headers', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >((_input, init) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(headers.get('accept-encoding')).toBe('identity');
      expect(headers.get('authorization')).toBe(
        `Basic ${Buffer.from('operator:secret').toString('base64')}`,
      );
      return Promise.resolve(
        new Response(new Uint8Array(FILE_LENGTH), {
          status: 200,
          headers: {
            'content-length': String(FILE_LENGTH),
            'content-type': 'video/mp4',
            etag: '"safe-tag"',
            'set-cookie': 'not-forwarded=1',
          },
        }),
      );
    });
    const gateway = createGateway(fetchMock);
    const opened = await gateway.open(SESSION_ID, { method: 'GET' });

    expect(opened.status).toBe(200);
    expect(opened.headers.get('accept-ranges')).toBe('bytes');
    expect(opened.headers.get('cache-control')).toBe('private, no-store');
    expect(opened.headers.get('content-type')).toBe('video/mp4');
    expect(opened.headers.has('set-cookie')).toBe(false);
    expect(await readBody(opened.body)).toHaveLength(FILE_LENGTH);
    opened.close();
  });

  it('never forwards TorServer credentials to a private media-worker output', async () => {
    const workerSource: TorrentPlaybackStreamSource = {
      ...SOURCE,
      target: {
        url: new URL(`http://media-worker.test/remux/${'r'.repeat(43)}`),
        kind: 'media_worker',
      },
    };
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >((_input, init) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(FILE_LENGTH),
            'content-type': 'video/mp4',
          },
        }),
      );
    });
    const sessions = {
      getStreamSource: jest.fn().mockReturnValue(workerSource),
    } as unknown as TorrentPlaybackSessionService;
    const gateway = new TorrentPlaybackStreamGateway(
      sessions,
      CLIENT_CONFIG,
      { maxStreams: 1, headerTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
      fetchMock,
    );

    const opened = await gateway.open(SESSION_ID, { method: 'HEAD' });
    expect(opened.status).toBe(200);
    opened.close();
  });

  it.each([
    ['bytes=0-99', 'bytes=0-99', 'bytes 0-99/1000', 100],
    ['bytes=400-499', 'bytes=400-499', 'bytes 400-499/1000', 100],
    ['bytes=900-', 'bytes=900-999', 'bytes 900-999/1000', 100],
    ['bytes=-100', 'bytes=900-999', 'bytes 900-999/1000', 100],
  ])(
    'normalizes and validates range %s',
    async (requested, forwarded, contentRange, length) => {
      const fetchMock = jest.fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >((_input, init) => {
        expect(new Headers(init?.headers).get('range')).toBe(forwarded);
        return Promise.resolve(
          new Response(new Uint8Array(length), {
            status: 206,
            headers: {
              'content-range': contentRange,
              'content-length': String(length),
              'content-type': 'video/mp4',
            },
          }),
        );
      });
      const opened = await createGateway(fetchMock).open(SESSION_ID, {
        method: 'GET',
        range: requested,
      });

      expect(opened.status).toBe(206);
      expect(opened.headers.get('content-range')).toBe(contentRange);
      expect(await readBody(opened.body)).toHaveLength(length);
      opened.close();
    },
  );

  it('supports HEAD without consuming a media body', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(async () =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(FILE_LENGTH),
            'content-type': 'video/mp4',
          },
        }),
      ),
    );
    const opened = await createGateway(fetchMock).open(SESSION_ID, {
      method: 'HEAD',
    });

    expect(opened).toMatchObject({ status: 200, body: null });
    opened.close();
  });

  it('forwards bounded validators and accepts valid 304 and 416 responses', async () => {
    const modified = 'Fri, 25 Jul 2026 07:00:00 GMT';
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockImplementationOnce((_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('if-none-match')).toBe('"safe,tag", W/"other"');
        expect(headers.get('if-modified-since')).toBe(modified);
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: '"safe-tag"' },
          }),
        );
      })
      .mockResolvedValueOnce(
        new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${FILE_LENGTH}` },
        }),
      );
    const gateway = createGateway(fetchMock);
    const notModified = await gateway.open(SESSION_ID, {
      method: 'GET',
      ifNoneMatch: '"safe,tag", W/"other"',
      ifModifiedSince: modified,
    });
    expect(notModified).toMatchObject({ status: 304, body: null });
    notModified.close();

    const rejectedRange = await gateway.open(SESSION_ID, {
      method: 'GET',
      range: 'bytes=0-9',
    });
    expect(rejectedRange.status).toBe(416);
    expect(rejectedRange.headers.get('content-range')).toBe(
      `bytes */${FILE_LENGTH}`,
    );
    rejectedRange.close();
  });

  it.each([
    'bytes=0-1,4-5',
    'bytes=1000-',
    'bytes=-0',
    'items=0-1',
    'bytes=bad-1',
  ])(
    'rejects malformed, multiple, or unsatisfiable range %s',
    async (range) => {
      const fetchMock = jest.fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >();
      await expect(
        createGateway(fetchMock).open(SESSION_ID, { method: 'GET', range }),
      ).rejects.toMatchObject({
        code: 'invalid_range',
        fileLength: FILE_LENGTH,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a weak If-Range validator before upstream work', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >();
    await expect(
      createGateway(fetchMock).open(SESSION_ID, {
        method: 'GET',
        range: 'bytes=0-9',
        ifRange: 'W/"weak"',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'bytes=0-9', { 'content-length': '1000' }],
    [200, undefined, {}],
    [
      206,
      undefined,
      { 'content-range': 'bytes 0-9/1000', 'content-length': '10' },
    ],
    [
      206,
      'bytes=0-9',
      { 'content-range': 'bytes 1-10/1000', 'content-length': '10' },
    ],
    [304, undefined, {}],
    [416, 'bytes=0-9', { 'content-range': 'bytes */999' }],
    [302, undefined, { location: 'https://evil.test/' }],
  ])(
    'rejects invalid upstream status/header behavior %#',
    async (status, range, headers) => {
      const fetchMock = jest.fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >(async () =>
        Promise.resolve(
          new Response(
            status === 200 || status === 206 ? new Uint8Array(10) : null,
            {
              status,
              headers,
            },
          ),
        ),
      );
      await expect(
        createGateway(fetchMock).open(SESSION_ID, {
          method: 'GET',
          ...(range === undefined ? {} : { range }),
        }),
      ).rejects.toMatchObject({ code: 'upstream_invalid_response' });
    },
  );

  it('bounds active streams until the current body is closed', async () => {
    const cancel = jest.fn();
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(async () =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 200,
          headers: { 'content-length': String(FILE_LENGTH) },
        }),
      ),
    );
    const gateway = createGateway(fetchMock, 1);
    const first = await gateway.open(SESSION_ID, { method: 'GET' });

    await expect(
      gateway.open(SESSION_ID, { method: 'GET' }),
    ).rejects.toMatchObject({ code: 'capacity_exceeded' });
    first.close();
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('aborts a media body that remains idle', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(async () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({ pull: () => undefined }),
          {
            status: 200,
            headers: { 'content-length': String(FILE_LENGTH) },
          },
        ),
      ),
    );
    const sessions = {
      getStreamSource: jest.fn().mockReturnValue(SOURCE),
    } as unknown as TorrentPlaybackSessionService;
    const gateway = new TorrentPlaybackStreamGateway(
      sessions,
      CLIENT_CONFIG,
      { maxStreams: 1, headerTimeoutMs: 1_000, idleTimeoutMs: 10 },
      fetchMock,
    );
    const opened = await gateway.open(SESSION_ID, { method: 'GET' });
    const reader = opened.body!.getReader();

    await expect(reader.read()).rejects.toMatchObject({
      code: 'upstream_timeout',
      message: 'TorServer media delivery exceeded the idle timeout.',
    });
    opened.close();
  });

  it.each([
    [999, 'ended the media body'],
    [1_001, 'exceeded the declared media body'],
  ])('rejects an actual body length of %i', async (length, message) => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(async () =>
      Promise.resolve(
        new Response(new Uint8Array(length), {
          status: 200,
          headers: { 'content-length': String(FILE_LENGTH) },
        }),
      ),
    );
    const opened = await createGateway(fetchMock).open(SESSION_ID, {
      method: 'GET',
    });

    await expect(readBody(opened.body)).rejects.toThrow(message);
    opened.close();
  });

  it('aborts TorServer header work when the browser disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          upstreamSignal = init?.signal ?? undefined;
          const rejectAbort = () => reject(new Error('aborted upstream'));

          if (upstreamSignal?.aborted) rejectAbort();
          else
            upstreamSignal?.addEventListener('abort', rejectAbort, {
              once: true,
            });
        }),
    );
    const browser = new AbortController();
    const pending = createGateway(fetchMock).open(SESSION_ID, {
      method: 'GET',
      signal: browser.signal,
    });
    browser.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the media-header budget instead of the shorter control connect timeout', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(
      async () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(null, {
                  status: 200,
                  headers: { 'content-length': String(FILE_LENGTH) },
                }),
              ),
            25,
          );
        }),
    );
    const sessions = {
      getStreamSource: jest.fn().mockReturnValue(SOURCE),
    } as unknown as TorrentPlaybackSessionService;
    const gateway = new TorrentPlaybackStreamGateway(
      sessions,
      { ...CLIENT_CONFIG, connectTimeoutMs: 1 },
      { maxStreams: 1, headerTimeoutMs: 1_000, idleTimeoutMs: 10_000 },
      fetchMock,
    );

    const opened = await gateway.open(SESSION_ID, { method: 'HEAD' });

    expect(opened).toMatchObject({ status: 200, body: null });
    opened.close();
  });

  it('retries one transient response before exposing bytes and preserves Range', async () => {
    const cancel = jest.fn();
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 500,
        }),
      )
      .mockImplementationOnce((_input, init) => {
        expect(new Headers(init?.headers).get('range')).toBe('bytes=400-499');
        return Promise.resolve(
          new Response(new Uint8Array(100), {
            status: 206,
            headers: {
              'content-range': `bytes 400-499/${FILE_LENGTH}`,
              'content-length': '100',
            },
          }),
        );
      });

    const opened = await createGateway(fetchMock).open(SESSION_ID, {
      method: 'GET',
      range: 'bytes=400-499',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(opened.status).toBe(206);
    expect(await readBody(opened.body)).toHaveLength(100);
    opened.close();
  });

  it('retries one transient transport failure before stream headers', async () => {
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockRejectedValueOnce(new Error('transient connection reset'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(FILE_LENGTH) },
        }),
      );

    const opened = await createGateway(fetchMock).open(SESSION_ID, {
      method: 'HEAD',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opened).toMatchObject({ status: 200, body: null });
    opened.close();
  });

  it('never retries a transient failure more than once', async () => {
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockResolvedValue(
        new Response(null, {
          status: 500,
        }),
      );

    await expect(
      createGateway(fetchMock).open(SESSION_ID, { method: 'GET' }),
    ).rejects.toMatchObject({ code: 'upstream_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the retry delay inside the original media-header budget', async () => {
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockRejectedValue(new Error('transient connection reset'));
    const sessions = {
      getStreamSource: jest.fn().mockReturnValue(SOURCE),
    } as unknown as TorrentPlaybackSessionService;
    const gateway = new TorrentPlaybackStreamGateway(
      sessions,
      CLIENT_CONFIG,
      { maxStreams: 1, headerTimeoutMs: 10, idleTimeoutMs: 10_000 },
      fetchMock,
    );

    await expect(
      gateway.open(SESSION_ID, { method: 'GET' }),
    ).rejects.toMatchObject({ code: 'upstream_timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the response-header timeout', async () => {
    const fetchMock = jest.fn<
      ReturnType<TorrentPlaybackStreamFetch>,
      Parameters<TorrentPlaybackStreamFetch>
    >(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('header timeout')),
            { once: true },
          );
        }),
    );
    const sessions = {
      getStreamSource: jest.fn().mockReturnValue(SOURCE),
    } as unknown as TorrentPlaybackSessionService;
    const gateway = new TorrentPlaybackStreamGateway(
      sessions,
      CLIENT_CONFIG,
      { maxStreams: 1, headerTimeoutMs: 10, idleTimeoutMs: 10_000 },
      fetchMock,
    );

    await expect(
      gateway.open(SESSION_ID, { method: 'GET' }),
    ).rejects.toMatchObject({ code: 'upstream_timeout' });
  });

  it('maps TorServer outage without exposing its target', async () => {
    const fetchMock = jest
      .fn<
        ReturnType<TorrentPlaybackStreamFetch>,
        Parameters<TorrentPlaybackStreamFetch>
      >()
      .mockRejectedValue(new Error('connect ECONNREFUSED torrserver.test'));

    await expect(
      createGateway(fetchMock).open(SESSION_ID, { method: 'GET' }),
    ).rejects.toEqual(
      new TorrentPlaybackStreamError(
        'upstream_unavailable',
        'TorServer could not open the selected media stream.',
      ),
    );
  });
});

function createGateway(
  fetchImplementation: jest.MockedFunction<TorrentPlaybackStreamFetch>,
  maxStreams = 4,
): TorrentPlaybackStreamGateway {
  const sessions = {
    getStreamSource: jest.fn().mockReturnValue(SOURCE),
  } as unknown as TorrentPlaybackSessionService;
  return new TorrentPlaybackStreamGateway(
    sessions,
    CLIENT_CONFIG,
    { maxStreams, headerTimeoutMs: 10_000, idleTimeoutMs: 10_000 },
    fetchImplementation,
  );
}

async function readBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array> {
  if (body === null) throw new Error('Expected stream body.');
  return new Uint8Array(await new Response(body).arrayBuffer());
}
