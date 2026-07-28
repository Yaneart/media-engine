import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  readOriginalTorrentRuntimeConfig,
  type OriginalTorrentRuntimeConfig,
} from './runtime.config';
import { OriginalTorrentRuntimeError } from './runtime.errors';
import type { TorrServerAdapterEvent } from './runtime.types';
import { TorrServerAdapter } from './torrserver-adapter';

const HASH = 'a'.repeat(40);
const OTHER_HASH = 'b'.repeat(40);
const FILE_STATUS = {
  hash: HASH,
  stat: 3,
  stat_string: 'Torrent working',
  name: 'Fixture',
  loaded_size: 0,
  torrent_size: 7,
  file_stats: [{ id: 1, path: 'fixture.bin', length: 7 }],
};

type FakeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

describe('TorrServerAdapter fake-server contract', () => {
  const requests: Array<{ method?: string; url?: string; body: Uint8Array }> =
    [];
  let handler: FakeHandler;
  let baseUrl: string;
  const server = createServer((request, response) => {
    void handler(request, response);
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  beforeEach(() => {
    requests.length = 0;
    handler = createDefaultHandler(requests);
  });

  it('checks the exact pinned runtime version', async () => {
    const adapter = createAdapter(baseUrl);
    await expect(adapter.health()).resolves.toEqual({
      version: 'MatriX.141',
      compatible: true,
    });
    expect(requests).toEqual([
      expect.objectContaining({ method: 'GET', url: '/echo' }),
    ]);
  });

  it('rejects an otherwise healthy incompatible runtime', async () => {
    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('MatriX.142');
    };

    await expect(createAdapter(baseUrl).health()).rejects.toMatchObject({
      code: 'incompatible_version',
      transient: false,
    });
  });

  it('adds a hash-bound magnet without persisting it', async () => {
    const adapter = createAdapter(baseUrl);
    await expect(
      adapter.add({
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH}&dn=Fixture`,
        expectedHash: HASH,
        title: 'Fixture',
      }),
    ).resolves.toMatchObject({ hash: HASH });

    const body = JSON.parse(
      new TextDecoder().decode(requests[0]?.body),
    ) as Record<string, unknown>;
    expect(body).toEqual({
      action: 'add',
      link: `magnet:?xt=urn:btih:${HASH}&dn=Fixture`,
      save_to_db: false,
      title: 'Fixture',
    });
  });

  it('uploads one bounded torrent payload as multipart without a remote URL', async () => {
    const adapter = createAdapter(baseUrl);
    const bytes = new TextEncoder().encode('d4:infod4:name7:fixtureee');

    await expect(
      adapter.add({
        kind: 'torrent_file',
        bytes,
        expectedHash: HASH,
        title: 'Fixture',
      }),
    ).resolves.toMatchObject({ hash: HASH, files: FILE_STATUS.file_stats });

    const request = requests[0];
    expect(request?.url).toBe('/torrent/upload');
    const body = new TextDecoder().decode(request?.body);
    expect(body).toContain('name="file"; filename="source.torrent"');
    expect(body).toContain('application/x-bittorrent');
    expect(body).toContain('d4:infod4:name7:fixtureee');
    expect(body).not.toContain('save');
  });

  it('lists exact metadata, resolves only a recorded file ID, and drops by hash', async () => {
    const adapter = createAdapter(baseUrl);
    await expect(adapter.get(HASH)).resolves.toMatchObject({
      hash: HASH,
      files: [{ id: 1, path: 'fixture.bin', length: 7 }],
    });
    await expect(adapter.waitForMetadata(HASH)).resolves.toMatchObject({
      hash: HASH,
      files: [{ id: 1 }],
    });
    await expect(adapter.resolveFileTarget(HASH, 1)).resolves.toMatchObject({
      url: new URL(`play/${HASH}/1`, `${baseUrl}/`),
      hash: HASH,
      fileId: 1,
      path: 'fixture.bin',
      length: 7,
      headerTimeoutMs: 45_000,
      inactivityTimeoutMs: 30_000,
    });
    await expect(adapter.resolveFileTarget(HASH, 2)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    await expect(adapter.drop(HASH)).resolves.toBeUndefined();

    const actions = requests
      .filter((request) => request.url === '/torrents')
      .map((request) => parseAction(request.body));
    expect(actions).toEqual(['get', 'get', 'get', 'get', 'drop']);
  });

  it('polls boundedly until embedded metadata appears', async () => {
    let getCount = 0;
    handler = async (request, response) => {
      const body = await recordRequest(request, requests);
      const action = parseAction(body);
      if (action !== 'get') throw new Error(`Unexpected action ${action}`);
      getCount += 1;
      json(response, 200, {
        ...FILE_STATUS,
        file_stats: getCount === 1 ? undefined : FILE_STATUS.file_stats,
      });
    };
    const adapter = createAdapter(baseUrl, { metadataPollIntervalMs: 1 });

    await expect(adapter.waitForMetadata(HASH)).resolves.toMatchObject({
      files: [{ id: 1 }],
    });
    expect(getCount).toBe(2);
  });

  it('maps metadata deadline and caller cancellation separately', async () => {
    handler = async (request, response) => {
      await recordRequest(request, requests);
      json(response, 200, { ...FILE_STATUS, stat: 1, file_stats: undefined });
    };
    const adapter = createAdapter(baseUrl, {
      metadataTimeoutMs: 15,
      metadataPollIntervalMs: 1,
    });
    await expect(adapter.waitForMetadata(HASH)).rejects.toMatchObject({
      code: 'metadata_timeout',
      transient: true,
    });

    const controller = new AbortController();
    const cancelled = adapter.waitForMetadata(HASH, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });
  });

  it('fails when TorrServer closes before metadata and preserves unexpected delay errors', async () => {
    handler = async (request, response) => {
      await recordRequest(request, requests);
      json(response, 200, { ...FILE_STATUS, stat: 4, file_stats: undefined });
    };
    await expect(
      createAdapter(baseUrl).waitForMetadata(HASH),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });

    handler = async (request, response) => {
      await recordRequest(request, requests);
      json(response, 200, { ...FILE_STATUS, stat: 1, file_stats: undefined });
    };
    const failure = new Error('delay failed');
    await expect(
      createAdapter(
        baseUrl,
        {},
        { delay: async () => Promise.reject(failure) },
      ).waitForMetadata(HASH),
    ).rejects.toBe(failure);
  });

  it('retries transient health failures once but never retries add', async () => {
    let attempts = 0;
    handler = async (request, response) => {
      await recordRequest(request, requests);
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(503).end();
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('MatriX.141');
      }
    };
    const adapter = createAdapter(baseUrl, { retryDelayMs: 1 });
    await expect(adapter.health()).resolves.toMatchObject({ compatible: true });
    expect(attempts).toBe(2);

    attempts = 0;
    handler = async (request, response) => {
      await recordRequest(request, requests);
      attempts += 1;
      response.writeHead(503).end();
    };
    await expect(
      adapter.add({
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH}`,
        expectedHash: HASH,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(attempts).toBe(1);
  });

  it('maps an add rejection to a source failure', async () => {
    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(400).end();
    };
    await expect(
      createAdapter(baseUrl).add({
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH}`,
        expectedHash: HASH,
      }),
    ).rejects.toMatchObject({ code: 'source_invalid', transient: false });
  });

  it.each([
    [401, 'unauthorized', false],
    [404, 'not_found', false],
    [400, 'rejected', false],
    [429, 'unavailable', true],
  ])('maps HTTP %i to %s', async (status, code, transient) => {
    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(status).end();
    };
    const adapter = createAdapter(baseUrl, { maxControlRetries: 0 });
    await expect(adapter.get(HASH)).rejects.toMatchObject({ code, transient });
  });

  it('rejects redirects, oversized responses, malformed JSON, and wrong content types', async () => {
    const adapter = createAdapter(baseUrl, { maxControlRetries: 0 });

    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(302, { location: 'http://example.com' }).end();
    };
    await expect(adapter.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });

    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(200, { 'content-length': String(3 * 1024 * 1024) });
      response.end();
    };
    await expect(adapter.health()).rejects.toMatchObject({
      code: 'response_too_large',
    });

    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{');
    };
    await expect(adapter.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });

    handler = async (request, response) => {
      await recordRequest(request, requests);
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('{}');
    };
    await expect(adapter.get(HASH)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('distinguishes caller abort from a control connection timeout', async () => {
    handler = async (request) => {
      await recordRequest(request, requests);
    };
    const adapter = createAdapter(baseUrl, {
      controlConnectTimeoutMs: 20,
      controlRequestTimeoutMs: 40,
      maxControlRetries: 0,
    });
    const controller = new AbortController();
    const cancelled = adapter.health({ signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });
    await expect(adapter.health()).rejects.toMatchObject({
      code: 'connect_timeout',
      transient: true,
    });
  });

  it('enforces the total control timeout after response headers arrive', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start() {},
          }),
          { status: 200, headers: { 'content-type': 'text/plain' } },
        ),
      ),
    );
    const adapter = new TorrServerAdapter(
      createConfig(baseUrl, {
        controlConnectTimeoutMs: 100,
        controlRequestTimeoutMs: 20,
        maxControlRetries: 0,
      }),
      { fetch: fetchMock },
    );
    await expect(adapter.health()).rejects.toMatchObject({
      code: 'control_timeout',
    });
  });

  it('rejects chunked overflow, invalid UTF-8, and transport failures', async () => {
    const overflowFetch = jest.fn(() =>
      Promise.resolve(
        Response.json('x'.repeat(100), {
          headers: { 'content-length': 'invalid' },
        }),
      ),
    );
    await expect(
      new TorrServerAdapter(createConfig(baseUrl), {
        fetch: overflowFetch,
      }).health(),
    ).rejects.toMatchObject({ code: 'invalid_response' });

    const chunkedFetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(32));
              controller.close();
            },
          }),
        ),
      ),
    );
    await expect(
      new TorrServerAdapter(createConfig(baseUrl, { maxResponseBytes: 16 }), {
        fetch: chunkedFetch,
      }).health(),
    ).rejects.toMatchObject({ code: 'response_too_large' });

    const invalidUtf8Fetch = jest.fn(() =>
      Promise.resolve(new Response(new Uint8Array([0xff]), { status: 200 })),
    );
    await expect(
      new TorrServerAdapter(createConfig(baseUrl), {
        fetch: invalidUtf8Fetch,
      }).health(),
    ).rejects.toMatchObject({ code: 'invalid_response' });

    const failingFetch = jest.fn(async () =>
      Promise.reject(new Error('network')),
    );
    await expect(
      new TorrServerAdapter(createConfig(baseUrl, { maxControlRetries: 0 }), {
        fetch: failingFetch,
      }).health(),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('emits only redacted structured events', async () => {
    const events: TorrServerAdapterEvent[] = [];
    const adapter = createAdapter(
      baseUrl,
      {},
      { report: (event) => events.push(event) },
    );
    await adapter.health();
    await expect(
      adapter.add({
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH}&dn=Secret`,
        expectedHash: OTHER_HASH,
      }),
    ).rejects.toBeInstanceOf(OriginalTorrentRuntimeError);

    expect(events).toEqual([
      { operation: 'health', outcome: 'success' },
      {
        operation: 'add',
        outcome: 'failure',
        code: 'source_invalid',
        transient: false,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(HASH);
    expect(JSON.stringify(events)).not.toContain('Secret');
    expect(JSON.stringify(events)).not.toContain(baseUrl);
  });

  it('bounds concurrent work and rejects excess queue entries', async () => {
    const pendingControllers: AbortSignal[] = [];
    const fetchMock = jest.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        pendingControllers.push(signal);
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    );
    const config = createConfig(baseUrl, {
      maxConcurrency: 1,
      maxQueueSize: 1,
      maxControlRetries: 0,
    });
    const adapter = new TorrServerAdapter(config, { fetch: fetchMock });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = adapter.health({ signal: firstController.signal });
    const second = adapter.health({ signal: secondController.signal });

    await expect(adapter.health()).rejects.toMatchObject({
      code: 'queue_full',
    });
    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await Promise.resolve();
    secondController.abort();
    await expect(second).rejects.toMatchObject({ code: 'aborted' });
    expect(pendingControllers).toHaveLength(2);
  });

  it('removes a cancelled queued request before it starts', async () => {
    const fetchMock = jest.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    );
    const adapter = new TorrServerAdapter(
      createConfig(baseUrl, {
        maxConcurrency: 1,
        maxQueueSize: 1,
        maxControlRetries: 0,
      }),
      { fetch: fetchMock },
    );
    const activeController = new AbortController();
    const queuedController = new AbortController();
    const active = adapter.health({ signal: activeController.signal });
    const queued = adapter.health({ signal: queuedController.signal });
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ code: 'aborted' });
    activeController.abort();
    await expect(active).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function createAdapter(
  baseUrl: string,
  overrides: Partial<OriginalTorrentRuntimeConfig> = {},
  dependencies: ConstructorParameters<typeof TorrServerAdapter>[1] = {},
): TorrServerAdapter {
  return new TorrServerAdapter(createConfig(baseUrl, overrides), dependencies);
}

function createConfig(
  baseUrl: string,
  overrides: Partial<OriginalTorrentRuntimeConfig> = {},
): OriginalTorrentRuntimeConfig {
  const config = readOriginalTorrentRuntimeConfig({
    MEDIA_ENGINE_TORRSERVER_URL: baseUrl,
  })!;
  return { ...config, ...overrides };
}

function createDefaultHandler(
  requests: Array<{ method?: string; url?: string; body: Uint8Array }>,
): FakeHandler {
  return async (request, response) => {
    const body = await recordRequest(request, requests);
    if (request.method === 'GET' && request.url === '/echo') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('MatriX.141');
      return;
    }
    if (request.method === 'POST' && request.url === '/torrent/upload') {
      json(response, 200, [FILE_STATUS]);
      return;
    }
    if (request.method === 'POST' && request.url === '/torrents') {
      const action = parseAction(body);
      if (action === 'add') json(response, 200, FILE_STATUS);
      else if (action === 'get') json(response, 200, FILE_STATUS);
      else if (action === 'drop') response.writeHead(200).end();
      else response.writeHead(400).end();
      return;
    }
    response.writeHead(404).end();
  };
}

async function recordRequest(
  request: IncomingMessage,
  requests: Array<{ method?: string; url?: string; body: Uint8Array }>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    chunks.push(new Uint8Array(chunk));
  }
  const body = new Uint8Array(Buffer.concat(chunks));
  requests.push({ method: request.method, url: request.url, body });
  return body;
}

function parseAction(body: Uint8Array): string {
  return (JSON.parse(new TextDecoder().decode(body)) as { action: string })
    .action;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
