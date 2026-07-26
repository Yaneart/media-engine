import type { TorrentMediaWorkerClientConfig } from './media-worker-config';
import {
  WorkerTorrentMediaProbe,
  WorkerTorrentMediaRemuxer,
  type TorrentMediaWorkerFetch,
} from './media-worker-client';

const CONFIG: TorrentMediaWorkerClientConfig = {
  baseUrl: new URL('http://media-worker.test/internal/'),
  timeoutMs: 2_000,
  remuxTimeoutMs: 10_000,
  cleanupTimeoutMs: 1_000,
  maxResponseBytes: 65_536,
};
const INPUT = {
  target: {
    url: new URL(`http://torrserver.test/play/${'a'.repeat(40)}/7`),
    hash: 'a'.repeat(40),
    fileId: 7,
  },
  file: {
    id: 7,
    path: 'Movie.mp4',
    length: 1_000_000,
    compatibility: 'unknown' as const,
  },
};

describe('torrent media worker client', () => {
  it('sends only server-owned identifiers and parses a bounded result', async () => {
    const request = jest
      .fn<
        ReturnType<TorrentMediaWorkerFetch>,
        Parameters<TorrentMediaWorkerFetch>
      >()
      .mockResolvedValue(
        jsonResponse({
          formatNames: ['mov', 'mp4'],
          video: {
            codecName: 'h264',
            profile: 'High',
            pixelFormat: 'yuv420p',
            width: 1920,
            height: 1080,
          },
          audio: { codecName: 'aac', profile: 'LC' },
        }),
      );

    await expect(
      new WorkerTorrentMediaProbe(CONFIG, request).probe(INPUT),
    ).resolves.toMatchObject({
      formatNames: ['mov', 'mp4'],
      video: { codecName: 'h264', pixelFormat: 'yuv420p' },
      audio: { codecName: 'aac' },
    });

    const [url, init] = request.mock.calls[0];
    expect(url).toEqual(new URL('http://media-worker.test/internal/probe'));
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    const body = init?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('Expected a JSON body.');
    expect(JSON.parse(body)).toEqual({
      hash: 'a'.repeat(40),
      fileId: 7,
      file: { id: 7, path: 'Movie.mp4', length: 1_000_000 },
    });
    expect(body).not.toContain('torrserver.test');
  });

  it.each([
    [new Response('{}', { status: 504 }), 'timeout'],
    [new Response('{}', { status: 503 }), 'unavailable'],
    [new Response('{}', { status: 302 }), 'invalid_response'],
    [new Response('{}', { status: 200 }), 'invalid_response'],
    [
      jsonResponse({
        formatNames: ['mov'],
        video: { codecName: '../bad' },
      }),
      'invalid_response',
    ],
  ] as const)('maps worker response %# safely', async (response, code) => {
    const request = jest.fn().mockResolvedValue(response);
    await expect(
      new WorkerTorrentMediaProbe(CONFIG, request).probe(INPUT),
    ).rejects.toMatchObject({ code });
  });

  it('rejects oversized bodies before parsing', async () => {
    const request = jest.fn().mockResolvedValue(
      new Response('x', {
        headers: {
          'content-length': '70000',
          'content-type': 'application/json',
        },
      }),
    );

    await expect(
      new WorkerTorrentMediaProbe(CONFIG, request).probe(INPUT),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('preserves caller cancellation', async () => {
    const controller = new AbortController();
    const request = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const action = new WorkerTorrentMediaProbe(CONFIG, request).probe({
      ...INPUT,
      signal: controller.signal,
    });
    controller.abort();

    await expect(action).rejects.toMatchObject({ code: 'aborted' });
  });

  it('enforces its own worker response timeout', async () => {
    const request = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    await expect(
      new WorkerTorrentMediaProbe({ ...CONFIG, timeoutMs: 10 }, request).probe(
        INPUT,
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('starts and cleans a bounded remux without sending a caller URL', async () => {
    const id = 'r'.repeat(43);
    const request = jest
      .fn<
        ReturnType<TorrentMediaWorkerFetch>,
        Parameters<TorrentMediaWorkerFetch>
      >()
      .mockResolvedValueOnce(
        jsonResponse({ id, length: 900_000, container: 'mp4' }, 201),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const remuxer = new WorkerTorrentMediaRemuxer(CONFIG, request);
    const result = await remuxer.remux({ ...INPUT, container: 'mp4' });

    expect(result).toEqual({
      id,
      target: {
        url: new URL(`http://media-worker.test/internal/remux/${id}`),
      },
      length: 900_000,
      container: 'mp4',
      contentType: 'video/mp4',
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toEqual(new URL('http://media-worker.test/internal/remux'));
    const body = init?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('Expected a JSON body.');
    expect(JSON.parse(body)).toEqual({
      hash: 'a'.repeat(40),
      fileId: 7,
      file: { id: 7, path: 'Movie.mp4', length: 1_000_000 },
      container: 'mp4',
    });
    expect(body).not.toContain('torrserver.test');

    await expect(remuxer.release(result)).resolves.toBeUndefined();
    expect(request.mock.calls[1]).toMatchObject([
      new URL(`http://media-worker.test/internal/remux/${id}`),
      { method: 'DELETE', redirect: 'manual' },
    ]);
  });

  it.each([
    [new Response('{}', { status: 504 }), 'timeout'],
    [new Response('{}', { status: 503 }), 'unavailable'],
    [new Response('{}', { status: 507 }), 'output_limit'],
    [jsonResponse({ id: 'short', length: 1, container: 'mp4' }, 201), 'failed'],
  ] as const)(
    'maps remux worker response %# safely',
    async (response, code) => {
      const request = jest.fn().mockResolvedValue(response);
      await expect(
        new WorkerTorrentMediaRemuxer(CONFIG, request).remux({
          ...INPUT,
          container: 'mp4',
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('preserves remux cancellation and enforces its outer deadline', async () => {
    const request = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const caller = new AbortController();
    const cancelled = new WorkerTorrentMediaRemuxer(CONFIG, request).remux({
      ...INPUT,
      container: 'mp4',
      signal: caller.signal,
    });
    caller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });

    await expect(
      new WorkerTorrentMediaRemuxer(
        { ...CONFIG, remuxTimeoutMs: 10 },
        request,
      ).remux({ ...INPUT, container: 'mp4' }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('bounds cleanup failures and treats an absent output as released', async () => {
    const result = {
      id: 'r'.repeat(43),
      target: {
        url: new URL(`http://media-worker.test/remux/${'r'.repeat(43)}`),
      },
      length: 1,
      container: 'mp4' as const,
      contentType: 'video/mp4',
    };
    await expect(
      new WorkerTorrentMediaRemuxer(
        CONFIG,
        jest.fn().mockResolvedValue(new Response(null, { status: 404 })),
      ).release(result),
    ).resolves.toBeUndefined();
    await expect(
      new WorkerTorrentMediaRemuxer(
        CONFIG,
        jest.fn().mockResolvedValue(new Response(null, { status: 500 })),
      ).release(result),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects an oversized remux response before JSON parsing', async () => {
    const request = jest.fn().mockResolvedValue(
      new Response('x', {
        status: 201,
        headers: {
          'content-length': '70000',
          'content-type': 'application/json',
        },
      }),
    );
    await expect(
      new WorkerTorrentMediaRemuxer(CONFIG, request).remux({
        ...INPUT,
        container: 'mp4',
      }),
    ).rejects.toMatchObject({ code: 'failed' });
  });

  it('cancels cleanup on caller abort and its own deadline', async () => {
    const request = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const result = {
      id: 'r'.repeat(43),
      target: {
        url: new URL(`http://media-worker.test/remux/${'r'.repeat(43)}`),
      },
      length: 1,
      container: 'mp4' as const,
      contentType: 'video/mp4',
    };
    const caller = new AbortController();
    const cancelled = new WorkerTorrentMediaRemuxer(CONFIG, request).release(
      result,
      { signal: caller.signal },
    );
    caller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });

    await expect(
      new WorkerTorrentMediaRemuxer(
        { ...CONFIG, cleanupTimeoutMs: 10 },
        request,
      ).release(result),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
