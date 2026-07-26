import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TorrentMediaWorkerServerConfig } from './media-worker-config';
import { createTorrentMediaWorkerServer } from './media-worker-server';
import type { TorrentMediaRemuxExecutor } from './media-remux';
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
  maxRemuxConcurrency: 1,
  maxStoredBytes: 10_000,
  outputTtlMs: 10_000,
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
      fetch(new URL('probe', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...JSON.parse(validRequest()),
          url: 'http://elsewhere.test',
        }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 415, 400, 400,
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

  it('creates, range-serves, and explicitly deletes a bounded remux output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-worker-test-'));
    const bytes = new TextEncoder().encode('remuxed-media');
    const executor = {
      remux: jest.fn(async (input) => {
        await writeFile(input.outputPath, bytes);
        return {
          path: input.outputPath,
          length: bytes.length,
          container: input.container,
          contentType: 'video/mp4',
        };
      }),
    } satisfies TorrentMediaRemuxExecutor;
    const probe = { probe: jest.fn() } satisfies TorrentMediaProbe;
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(CONFIG, probe, target, {
        executor,
        outputDirectory: directory,
        maxOutputBytes: 1_000,
      }),
      servers,
    );

    try {
      const created = await fetch(new URL('remux', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hash: 'a'.repeat(40),
          fileId: 7,
          file: { id: 7, path: 'Movie.mkv', length: 900 },
          container: 'mp4',
        }),
      });
      expect(created.status).toBe(201);
      const result = (await readJson(created)) as {
        id: string;
        length: number;
        container: string;
      };
      expect(result).toMatchObject({
        id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        length: bytes.length,
        container: 'mp4',
      });
      expect(executor.remux).toHaveBeenCalledWith(
        expect.objectContaining({
          target: target('a'.repeat(40), 7),
          container: 'mp4',
          signal: expect.any(AbortSignal),
        }),
      );

      const outputUrl = new URL(`remux/${result.id}`, baseUrl);
      const ranged = await fetch(outputUrl, {
        headers: { range: 'bytes=2-6' },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe(
        `bytes 2-6/${bytes.length}`,
      );
      expect(await ranged.text()).toBe('muxed');

      const suffix = await fetch(outputUrl, {
        headers: { range: 'bytes=-5' },
      });
      expect(suffix.status).toBe(206);
      expect(await suffix.text()).toBe('media');

      const head = await fetch(outputUrl, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(String(bytes.length));
      expect(await head.text()).toBe('');

      const invalidRange = await fetch(outputUrl, {
        headers: { range: `bytes=${bytes.length}-` },
      });
      expect(invalidRange.status).toBe(416);
      expect(invalidRange.headers.get('content-range')).toBe(
        `bytes */${bytes.length}`,
      );

      expect((await fetch(outputUrl, { method: 'DELETE' })).status).toBe(204);
      expect((await fetch(outputUrl)).status).toBe(404);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds remux concurrency and storage reservation independently from probes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-worker-bounds-'));
    let finish: (() => void) | undefined;
    const executor: TorrentMediaRemuxExecutor = {
      remux: (input) =>
        new Promise((resolve) => {
          finish = () => {
            void writeFile(input.outputPath, 'bounded').then(() =>
              resolve({
                path: input.outputPath,
                length: 7,
                container: input.container,
                contentType: 'video/mp4',
              }),
            );
          };
        }),
    };
    const probe = { probe: jest.fn() } satisfies TorrentMediaProbe;
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(CONFIG, probe, target, {
        executor,
        outputDirectory: directory,
        maxOutputBytes: 1_000,
      }),
      servers,
    );
    const body = JSON.stringify({
      hash: 'a'.repeat(40),
      fileId: 7,
      file: { id: 7, path: 'Movie.mkv', length: 900 },
      container: 'mp4',
    });

    try {
      const first = fetch(new URL('remux', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      await waitFor(() => finish !== undefined);
      const busy = await fetch(new URL('remux', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(busy.status).toBe(503);
      if (finish === undefined) throw new Error('Expected pending remux.');
      finish();
      expect((await first).status).toBe(201);

      const storageLimited = await listen(
        createTorrentMediaWorkerServer(
          { ...CONFIG, maxStoredBytes: 999 },
          probe,
          target,
          { executor, outputDirectory: directory, maxOutputBytes: 1_000 },
        ),
        servers,
      );
      const limited = await fetch(new URL('remux', storageLimited), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(limited.status).toBe(507);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('expires and removes an orphaned remux output on its worker TTL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-worker-expiry-'));
    const executor: TorrentMediaRemuxExecutor = {
      remux: async (input) => {
        await writeFile(input.outputPath, 'expires');
        return {
          path: input.outputPath,
          length: 7,
          container: input.container,
          contentType: 'video/mp4',
        };
      },
    };
    const baseUrl = await listen(
      createTorrentMediaWorkerServer(
        { ...CONFIG, outputTtlMs: 10 },
        { probe: jest.fn() },
        target,
        { executor, outputDirectory: directory, maxOutputBytes: 1_000 },
      ),
      servers,
    );

    try {
      const created = await fetch(new URL('remux', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hash: 'a'.repeat(40),
          fileId: 7,
          file: { id: 7, path: 'Movie.mkv', length: 900 },
          container: 'mp4',
        }),
      });
      const result = (await readJson(created)) as { id: string };
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect((await fetch(new URL(`remux/${result.id}`, baseUrl))).status).toBe(
        404,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
