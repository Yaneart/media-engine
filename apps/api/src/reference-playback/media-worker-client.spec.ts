import type { TorrentMediaWorkerClientConfig } from './media-worker-config';
import {
  WorkerTorrentMediaProbe,
  type TorrentMediaWorkerFetch,
} from './media-worker-client';

const CONFIG: TorrentMediaWorkerClientConfig = {
  baseUrl: new URL('http://media-worker.test/internal/'),
  timeoutMs: 2_000,
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
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
