/* eslint-disable @typescript-eslint/require-await */

import { TorrServerClient } from './client';
import type { TorrServerClientConfig } from './config';
import { TorrServerClientError } from './errors';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=fixture`;

type TestFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

describe('TorServer client response and input validation', () => {
  it.each([
    [
      'malformed JSON',
      new Response('{', { headers: jsonHeaders() }),
      'invalid_response',
    ],
    [
      'wrong content type',
      new Response('{}', { headers: { 'content-type': 'text/html' } }),
      'invalid_response',
    ],
    [
      'declared oversized body',
      new Response('{}', {
        headers: { ...jsonHeaderRecord(), 'content-length': '5000' },
      }),
      'response_too_large',
    ],
    [
      'invalid content length',
      new Response('{}', {
        headers: { ...jsonHeaderRecord(), 'content-length': 'five' },
      }),
      'invalid_response',
    ],
    [
      'streamed oversized body',
      new Response('x'.repeat(5000), { headers: jsonHeaders() }),
      'response_too_large',
    ],
  ] as const)('rejects %s', async (_label, response, code) => {
    const client = createClient({ maxResponseBytes: 1_024 }, async () =>
      response.clone(),
    );
    await expect(client.get(HASH)).rejects.toMatchObject({ code });
  });

  it.each([
    ['invalid hash', { ...torrentStatus(), hash: 'bad' }],
    ['invalid state', { ...torrentStatus(), stat: 6 }],
    ['fractional size', { ...torrentStatus(), torrent_size: 1.5 }],
    [
      'traversal path',
      torrentStatus([{ id: 1, path: '../secret.mp4', length: 100 }]),
    ],
    [
      'absolute path',
      torrentStatus([{ id: 1, path: '/secret.mp4', length: 100 }]),
    ],
    [
      'duplicate file IDs',
      torrentStatus([
        { id: 1, path: 'one.mp4', length: 50 },
        { id: 1, path: 'two.mp4', length: 50 },
      ]),
    ],
    [
      'oversized file',
      torrentStatus([{ id: 1, path: 'video.mp4', length: 2_000 }]),
    ],
  ])('rejects unsafe file/status data: %s', async (_label, value) => {
    const client = createClient({ maxFileSizeBytes: 1_000 }, async () =>
      jsonResponse(value),
    );
    await expect(client.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects oversized file lists and unsafe controlled inputs before fetch', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<TestFetch>>(
      async () =>
        jsonResponse(
          torrentStatus([
            { id: 1, path: 'one.mp4', length: 50 },
            { id: 2, path: 'two.mp4', length: 50 },
          ]),
        ),
    );
    const client = createClient({ maxFiles: 1 }, fetchMock);

    await expect(client.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(() => client.createPlayTarget('../hash', 1)).toThrow(
      TorrServerClientError,
    );
    expect(() => client.createPlayTarget(HASH, 0)).toThrow(
      TorrServerClientError,
    );
    await expect(
      client.add('https://example.com/file.torrent'),
    ).rejects.toMatchObject({ code: 'rejected' });
    await expect(
      client.add('magnet:?xt=urn:btih:not-a-hex-info-hash'),
    ).rejects.toMatchObject({ code: 'rejected' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a valid but different torrent identity from TorServer', async () => {
    const client = createClient({}, async () =>
      jsonResponse({
        ...torrentStatus(),
        hash: 'abcdef0123456789abcdef0123456789abcdef01',
      }),
    );

    await expect(client.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(client.add(MAGNET)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects redirects and invalid health text', async () => {
    const redirected = createClient({}, async () => {
      const response = new Response('MatriX.141.1');
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });
    await expect(redirected.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const invalidHealth = createClient(
      {},
      async () => new Response('bad\u0000version'),
    );
    await expect(invalidHealth.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects invalid UTF-8 without leaking decoder details', async () => {
    const client = createClient(
      {},
      async () =>
        new Response(new Uint8Array([0xc3, 0x28]), {
          headers: jsonHeaders(),
        }),
    );

    await expect(client.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

function createClient(
  overrides: Partial<TorrServerClientConfig>,
  fetchImplementation: TestFetch,
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
    { fetch: fetchImplementation },
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
