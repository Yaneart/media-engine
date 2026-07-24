/* eslint-disable @typescript-eslint/require-await */

import type { TorrServerClientConfig } from './config';
import { TorrServerClient } from './client';
import { TorrServerClientError } from './errors';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=fixture`;

type TestFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

describe('TorServer client', () => {
  it('checks health through the configured base path and bounded Basic auth', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createClient(
      {
        username: 'operator',
        password: 'secret',
      },
      async (input, init) => {
        requests.push({ url: requestUrl(input), init });
        return new Response('MatriX.141.1', {
          headers: { 'content-type': 'text/plain' },
        });
      },
    );

    await expect(client.health()).resolves.toEqual({
      version: 'MatriX.141.1',
    });
    expect(requests[0]?.url).toBe('http://torrserver:8090/base/echo');
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('operator:secret').toString('base64')}`,
    );
    expect(requests[0]?.init?.redirect).toBe('error');
  });

  it('adds, gets, polls, drops, and creates play targets from controlled values', async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    let getCalls = 0;
    const client = createClient({}, async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requests.push({ url: requestUrl(input), body });

      if (requestUrl(input).endsWith('/echo')) {
        return new Response('MatriX.141.1');
      }

      const action = JSON.parse(body ?? '{}') as { action?: string };

      if (action.action === 'drop') {
        return new Response(null, { status: 200 });
      }

      if (action.action === 'get') {
        getCalls += 1;
      }

      return jsonResponse(
        torrentStatus(
          action.action === 'get' && getCalls >= 3
            ? [{ id: 1, path: 'video/fixture.mp4', length: 100 }]
            : [],
        ),
      );
    });

    await expect(
      client.add(MAGNET, { title: ' Fixture ' }),
    ).resolves.toMatchObject({ hash: HASH, files: [] });
    await expect(client.get(HASH.toUpperCase())).resolves.toMatchObject({
      hash: HASH,
      files: [],
    });
    await expect(client.waitForMetadata(HASH)).resolves.toMatchObject({
      files: [{ id: 1, path: 'video/fixture.mp4', length: 100 }],
    });
    await expect(client.drop(HASH)).resolves.toBeUndefined();

    const target = client.createPlayTarget(HASH.toUpperCase(), 1);
    expect(target).toEqual({
      url: new URL(`http://torrserver:8090/base/play/${HASH}/1`),
      hash: HASH,
      fileId: 1,
    });

    expect(requests.every((request) => request.url.includes('/base/'))).toBe(
      true,
    );
    expect(
      requests.some((request) => request.body?.includes('"save_to_db":false')),
    ).toBe(true);
    expect(
      requests.some((request) => request.body?.includes('"title":"Fixture"')),
    ).toBe(true);
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'not_found'],
    [400, 'rejected'],
    [503, 'unavailable'],
  ] as const)(
    'maps HTTP %s to %s without exposing response data',
    async (status, code) => {
      const client = createClient(
        {},
        async () =>
          new Response(`secret upstream detail ${MAGNET}`, { status }),
      );

      const error = await captureError(client.get(HASH));
      expect(error).toBeInstanceOf(TorrServerClientError);
      expect(error).toMatchObject({ code, status });
      expect(String(error)).not.toContain(MAGNET);
      expect(String(error)).not.toContain('secret upstream detail');
    },
  );

  it('suppresses sensitive fetch failures', async () => {
    const client = createClient({}, async () => {
      throw new Error(`failed URL with ${MAGNET}`);
    });

    const error = await captureError(client.add(MAGNET));
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(String(error)).not.toContain(MAGNET);
  });

  it('cancels pre-aborted and active requests', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<TestFetch>>(
      async () => new Promise(() => {}),
    );
    const client = createClient({}, fetchMock);
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(
      client.health({ signal: preAborted.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();

    const active = new AbortController();
    const request = client.health({ signal: active.signal });
    await Promise.resolve();
    active.abort();

    await expect(request).rejects.toMatchObject({ code: 'aborted' });
  });

  it('distinguishes connection and full-request timeouts', async () => {
    const connectClient = createClient(
      { connectTimeoutMs: 10, requestTimeoutMs: 40 },
      async () => new Promise(() => {}),
    );
    await expect(connectClient.health()).rejects.toMatchObject({
      code: 'connect_timeout',
    });

    const body = new ReadableStream<Uint8Array>({ start() {} });
    const requestClient = createClient(
      { connectTimeoutMs: 10, requestTimeoutMs: 25 },
      async () =>
        new Response(body, { headers: { 'content-type': 'text/plain' } }),
    );
    await expect(requestClient.health()).rejects.toMatchObject({
      code: 'request_timeout',
    });
  });

  it('applies one metadata deadline across polling', async () => {
    const client = createClient(
      {
        connectTimeoutMs: 5,
        requestTimeoutMs: 10,
        metadataTimeoutMs: 20,
        metadataPollIntervalMs: 1,
      },
      async () => jsonResponse(torrentStatus()),
      {
        delay: async (_milliseconds, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(abortReason(signal)),
              { once: true },
            );
          }),
      },
    );

    await expect(client.waitForMetadata(HASH)).rejects.toMatchObject({
      code: 'metadata_timeout',
    });
  });

  it('supports metadata cancellation and terminal/error propagation', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const pollingClient = createClient(
      { metadataPollIntervalMs: 100 },
      async () => jsonResponse(torrentStatus()),
    );
    await expect(
      pollingClient.waitForMetadata(HASH, { signal: preAborted.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });

    const active = new AbortController();
    const polling = pollingClient.waitForMetadata(HASH, {
      signal: active.signal,
    });
    setTimeout(() => active.abort(), 5);
    await expect(polling).rejects.toMatchObject({ code: 'aborted' });

    const closedClient = createClient({}, async () =>
      jsonResponse({
        ...torrentStatus(),
        stat: 4,
        stat_string: 'Torrent closed',
      }),
    );
    await expect(closedClient.waitForMetadata(HASH)).rejects.toMatchObject({
      code: 'unavailable',
    });

    const missingClient = createClient(
      {},
      async () => new Response(null, { status: 404 }),
    );
    await expect(missingClient.waitForMetadata(HASH)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('bounds request concurrency and removes an aborted queued request', async () => {
    const responses: Array<(response: Response) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const fetchMock: TestFetch = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);

      return new Promise((resolve) => {
        responses.push((response) => {
          active -= 1;
          resolve(response);
        });
      });
    };
    const client = createClient(
      { maxConcurrency: 2, connectTimeoutMs: 100, requestTimeoutMs: 200 },
      fetchMock,
    );
    const first = client.health();
    const second = client.health();
    const queuedController = new AbortController();
    const queued = client.health({ signal: queuedController.signal });

    await flushPromises();
    expect(responses).toHaveLength(2);
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ code: 'aborted' });

    responses[0]?.(new Response('MatriX.141.1'));
    responses[1]?.(new Response('MatriX.141.1'));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(maximumActive).toBe(2);
  });

  it('starts a non-aborted queued request after a slot is released', async () => {
    const responses: Array<(response: Response) => void> = [];
    const client = createClient(
      { maxConcurrency: 1, connectTimeoutMs: 100, requestTimeoutMs: 200 },
      async () =>
        new Promise((resolve) => {
          responses.push(resolve);
        }),
    );
    const first = client.health();
    const queued = client.health({ signal: new AbortController().signal });

    await flushPromises();
    expect(responses).toHaveLength(1);
    responses[0]?.(new Response('MatriX.141.1'));
    await expect(first).resolves.toEqual({ version: 'MatriX.141.1' });
    await flushPromises();
    expect(responses).toHaveLength(2);
    responses[1]?.(new Response('MatriX.141.1'));
    await expect(queued).resolves.toEqual({ version: 'MatriX.141.1' });
  });
});

function createClient(
  overrides: Partial<TorrServerClientConfig>,
  fetchImplementation: TestFetch,
  dependencies: {
    delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  } = {},
): TorrServerClient {
  return new TorrServerClient(
    {
      baseUrl: new URL('http://torrserver:8090/base/'),
      connectTimeoutMs: 50,
      requestTimeoutMs: 100,
      metadataTimeoutMs: 200,
      metadataPollIntervalMs: 1,
      maxConcurrency: 4,
      maxResponseBytes: 4_096,
      maxFiles: 10,
      maxPathLength: 256,
      maxFileSizeBytes: 10_000,
      ...overrides,
    },
    { fetch: fetchImplementation, ...dependencies },
  );
}

function torrentStatus(
  files: Array<{ id: number; path: string; length: number }> = [],
): Record<string, unknown> {
  return {
    hash: HASH,
    stat: files.length === 0 ? 1 : 3,
    stat_string:
      files.length === 0 ? 'Torrent getting info' : 'Torrent working',
    name: 'Fixture',
    loaded_size: 0,
    torrent_size: files.reduce((total, file) => total + file.length, 0),
    file_stats: files,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: jsonHeaders() });
}

function jsonHeaders(): Headers {
  return new Headers(jsonHeaderRecord());
}

function jsonHeaderRecord(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject.');
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Test operation aborted.');
}
