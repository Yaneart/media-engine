import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { TorrentMediaWorkerServerConfig } from './media-worker-config';
import { createTorrentMediaWorkerServer } from './media-worker-server';
import {
  TorrentMediaProbeError,
  type TorrentMediaProbe,
  type TorrentMediaProbeResult,
} from './media-probe';

const CONFIG: TorrentMediaWorkerServerConfig = {
  host: '127.0.0.1',
  port: 8_080,
  maxConcurrency: 1,
  maxRequestBytes: 16_384,
  requestTimeoutMs: 2_000,
};
const RESULT: TorrentMediaProbeResult = {
  formatNames: ['mov', 'mp4'],
  video: { codecName: 'h264', pixelFormat: 'yuv420p' },
  audio: { codecName: 'aac' },
};

describe('torrent media worker server', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it('exposes narrow health and probe endpoints without accepting a URL', async () => {
    const probe = {
      probe: jest.fn().mockResolvedValue(RESULT),
    } satisfies TorrentMediaProbe;
    const createTarget = jest.fn((hash: string, fileId: number) => ({
      url: new URL(`http://torrserver.test/play/${hash}/${fileId}`),
      hash,
      fileId,
    }));
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(CONFIG, probe, createTarget),
      servers,
    );

    await expect(
      fetch(new URL('health', baseUrl)).then(readJson),
    ).resolves.toEqual({
      status: 'ok',
    });
    const response = await fetch(new URL('probe', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: validRequest(),
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual(RESULT);
    expect(createTarget).toHaveBeenCalledWith('a'.repeat(40), 7);
    expect(probe.probe).toHaveBeenCalledWith({
      target: {
        url: new URL(`http://torrserver.test/play/${'a'.repeat(40)}/7`),
        hash: 'a'.repeat(40),
        fileId: 7,
      },
      file: {
        id: 7,
        path: 'Movie.mp4',
        length: 1_000_000,
        compatibility: 'unknown',
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects malformed, oversized, and non-JSON requests before probing', async () => {
    const probe = { probe: jest.fn() } satisfies TorrentMediaProbe;
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(CONFIG, probe, () => {
        throw new Error('must not run');
      }),
      servers,
    );

    const responses = await Promise.all([
      fetch(new URL('probe?url=http://elsewhere.test', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      fetch(new URL('probe', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: validRequest(),
      }),
      fetch(new URL('probe', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(20_000),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 415, 400,
    ]);
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('enforces independent concurrency and maps safe probe failures', async () => {
    let resolveFirst!: (value: TorrentMediaProbeResult) => void;
    const first = new Promise<TorrentMediaProbeResult>((resolve) => {
      resolveFirst = resolve;
    });
    const probe = {
      probe: jest
        .fn()
        .mockReturnValueOnce(first)
        .mockRejectedValueOnce(
          new TorrentMediaProbeError('timeout', 'private detail'),
        ),
    } satisfies TorrentMediaProbe;
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(CONFIG, probe, target),
      servers,
    );
    const firstRequest = postProbe(baseUrl);
    await waitFor(() => probe.probe.mock.calls.length === 1);
    const busy = await postProbe(baseUrl);
    expect(busy.status).toBe(503);
    resolveFirst(RESULT);
    expect((await firstRequest).status).toBe(200);

    const timedOut = await postProbe(baseUrl);
    expect(timedOut.status).toBe(504);
    await expect(readJson(timedOut)).resolves.toEqual({ code: 'timeout' });
  });

  it('enforces an outer request deadline around the probe', async () => {
    const probe: TorrentMediaProbe = {
      probe: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () =>
              reject(new TorrentMediaProbeError('aborted', 'private detail')),
            { once: true },
          );
        }),
    };
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(
        { ...CONFIG, requestTimeoutMs: 10 },
        probe,
        target,
      ),
      servers,
    );

    const response = await postProbe(baseUrl);
    expect(response.status).toBe(504);
    await expect(readJson(response)).resolves.toEqual({ code: 'timeout' });
  });
});

function validRequest(): string {
  return JSON.stringify({
    hash: 'a'.repeat(40),
    fileId: 7,
    file: { id: 7, path: 'Movie.mp4', length: 1_000_000 },
  });
}

function target(hash: string, fileId: number) {
  return {
    url: new URL(`http://torrserver.test/play/${hash}/${fileId}`),
    hash,
    fileId,
  };
}

async function listen(server: Server, servers: Server[]): Promise<URL> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/`);
}

function postProbe(baseUrl: URL): Promise<Response> {
  return fetch(new URL('probe', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: validRequest(),
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}
