/* eslint-disable @typescript-eslint/unbound-method -- Jest mock methods are inspected, not detached and invoked. */
import { OriginalTorrentRuntimeError } from '../original-torrent-runtime';
import type { OriginalTorrentSessionConfig } from './session.config';
import {
  OriginalTorrentSessionConflictError,
  OriginalTorrentSessionNotFoundError,
} from './session.errors';
import { OriginalTorrentSessionService } from './session.service';
import type {
  CreateOriginalTorrentSessionInput,
  OriginalTorrentRuntimeAdapter,
  OriginalTorrentSessionSnapshot,
  OriginalTorrentSourceResolver,
  ResolvedTorrentObservation,
} from './session.types';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const SECOND_HASH = 'fedcba9876543210fedcba9876543210fedcba98';
const config: OriginalTorrentSessionConfig = {
  sessionTtlMs: 10_000,
  terminalRetentionMs: 1_000,
  cleanupIntervalMs: 60_000,
  sourceRequestTimeoutMs: 1_000,
  maxTorrentBytes: 4_194_304,
};
const input: CreateOriginalTorrentSessionInput = {
  query: { type: 'movie', title: 'Example', year: 2026 },
  observation: { provider: 'provider-a', id: 'provider-a:opaque' },
};

describe('original torrent session lifecycle', () => {
  const services: OriginalTorrentSessionService[] = [];

  afterEach(async () => {
    await Promise.all(
      services.splice(0).map((service) => service.onApplicationShutdown()),
    );
  });

  it('auto-selects one non-padding file regardless of extension', async () => {
    const adapter = createAdapter([
      { id: 1, path: '.pad/0', length: 10 },
      { id: 2, path: 'movie/content.unknown-container', length: 1_000 },
    ]);
    const service = createService(adapter);
    const created = service.create(input);

    expect(created.state).toBe('adding');
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    const ready = await waitForState(service, created.id, 'ready');
    expect(ready.files).toEqual([
      { id: 2, path: 'movie/content.unknown-container', length: 1_000 },
    ]);
    expect(ready.selectedFile).toEqual(ready.files![0]);
    expect(ready.streamUrl).toMatch(
      /^\/media\/torrent-streams\/[A-Za-z0-9_-]{43}$/u,
    );
    expect(JSON.stringify(ready)).not.toContain('torrserver');
    expect(adapter.resolveFileTarget).toHaveBeenCalledWith(HASH, 2, {
      signal: expect.any(AbortSignal),
    });

    const capability = ready.streamUrl!.split('/').at(-1)!;
    await expect(
      service.resolveStreamCapability(capability),
    ).resolves.toMatchObject({
      sessionId: created.id,
      target: {
        hash: HASH,
        fileId: 2,
        path: 'movie/content.unknown-container',
      },
    });
    const stopped = await service.stop(created.id);
    expect(stopped.streamUrl).toBeUndefined();
    await expect(
      service.resolveStreamCapability(capability),
    ).rejects.toMatchObject({
      code: 'session_stopped',
    });
    expect(adapter.drop).toHaveBeenCalledWith(HASH);
  });

  it('requires a server-offered numeric ID for ambiguous files', async () => {
    const adapter = createAdapter([
      { id: 4, path: 'video.mkv', length: 2_000 },
      { id: 9, path: 'readme.txt', length: 20 },
      { id: 10, path: '_____padding_file_0', length: 100 },
    ]);
    const service = createService(adapter);
    const created = service.create(input);
    const selection = await waitForState(
      service,
      created.id,
      'selection_required',
    );
    expect(selection.files).toEqual([
      { id: 4, path: 'video.mkv', length: 2_000 },
      { id: 9, path: 'readme.txt', length: 20 },
    ]);

    await expect(service.selectFile(created.id, 8)).rejects.toMatchObject({
      code: 'torrent_file_not_found',
    });
    expect(adapter.resolveFileTarget).not.toHaveBeenCalled();

    await expect(service.selectFile(created.id, 9)).resolves.toMatchObject({
      state: 'ready',
      selectedFile: { id: 9, path: 'readme.txt', length: 20 },
    });
  });

  it('coalesces preparation and drops only after the final shared session stops', async () => {
    const add =
      deferred<Awaited<ReturnType<OriginalTorrentRuntimeAdapter['add']>>>();
    const adapter = createAdapter();
    adapter.add.mockReturnValue(add.promise);
    const service = createService(adapter);
    const first = service.create(input);
    const second = service.create(input);

    await waitUntil(() => adapter.add.mock.calls.length === 1);
    expect(adapter.health).toHaveBeenCalledTimes(1);
    add.resolve(status([{ id: 1, path: 'original.bin', length: 100 }]));
    await waitForState(service, first.id, 'ready');
    await waitForState(service, second.id, 'ready');
    expect(adapter.add).toHaveBeenCalledTimes(1);

    await service.stop(first.id);
    expect(adapter.drop).not.toHaveBeenCalled();
    await service.stop(second.id);
    expect(adapter.drop).toHaveBeenCalledTimes(1);
    expect(adapter.drop).toHaveBeenCalledWith(HASH);
  });

  it('cancels source resolution when creation is stopped', async () => {
    const resolver: OriginalTorrentSourceResolver = {
      resolve: jest.fn(
        (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('cancelled'),
                ),
              { once: true },
            );
          }),
      ),
    };
    const adapter = createAdapter();
    const service = createService(adapter, resolver);
    const created = service.create(input);
    const stopped = await service.stop(created.id);

    expect(stopped).toMatchObject({
      state: 'stopped',
      error: { code: 'session_stopped' },
    });
    await settle();
    expect(adapter.health).not.toHaveBeenCalled();
    expect(adapter.add).not.toHaveBeenCalled();
    expect(adapter.drop).not.toHaveBeenCalled();
  });

  it('does not re-add a hash when stopped while waiting for its prior drop', async () => {
    const dropping = deferred<void>();
    const adapter = createAdapter();
    adapter.drop.mockReturnValue(dropping.promise);
    const resolver = createResolver();
    const service = createService(adapter, resolver);
    const first = service.create(input);
    await waitForState(service, first.id, 'ready');

    const firstStop = service.stop(first.id);
    await waitUntil(() => adapter.drop.mock.calls.length === 1);
    const second = service.create(input);
    await waitUntil(() => resolver.resolve.mock.calls.length === 2);
    await settle();
    await service.stop(second.id);
    dropping.resolve();
    await firstStop;
    await settle();

    expect(adapter.add).toHaveBeenCalledTimes(1);
    await expect(service.get(second.id)).resolves.toMatchObject({
      state: 'stopped',
    });
  });

  it('maps metadata timeout honestly and cleans an added torrent', async () => {
    const adapter = createAdapter([]);
    adapter.waitForMetadata.mockRejectedValue(
      new OriginalTorrentRuntimeError(
        'metadata_timeout',
        'Metadata timed out.',
        true,
      ),
    );
    const service = createService(adapter);
    const created = service.create(input);
    const failed = await waitForState(service, created.id, 'failed');

    expect(failed.error).toEqual({
      code: 'torrent_metadata_timeout',
      message: 'Metadata timed out.',
      transient: true,
    });
    await waitUntil(() => adapter.drop.mock.calls.length === 1);
    await expect(service.stop(created.id)).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'torrent_metadata_timeout' },
    });
  });

  it('expires active sessions, releases TorrServer, and evicts retained records', async () => {
    let now = Date.parse('2026-07-29T00:00:00.000Z');
    const adapter = createAdapter();
    const service = createService(adapter, undefined, () => now, {
      ...config,
      sessionTtlMs: 1_000,
      terminalRetentionMs: 500,
    });
    const created = service.create(input);
    const ready = await waitForState(service, created.id, 'ready');
    const capability = ready.streamUrl!.split('/').at(-1)!;

    now += 1_000;
    await service.sweepExpiredSessions();
    await expect(service.get(created.id)).resolves.toMatchObject({
      state: 'expired',
      error: { code: 'session_expired' },
    });
    expect(adapter.drop).toHaveBeenCalledWith(HASH);
    await expect(
      service.resolveStreamCapability(capability),
    ).rejects.toMatchObject({
      code: 'session_expired',
    });

    now += 500;
    await service.sweepExpiredSessions();
    await expect(service.get(created.id)).rejects.toBeInstanceOf(
      OriginalTorrentSessionNotFoundError,
    );
  });

  it('fails and cleans up when a selected file changes after metadata', async () => {
    const adapter = createAdapter();
    adapter.resolveFileTarget.mockResolvedValue({
      url: new URL(`http://torrserver:8090/play/${HASH}/1`),
      hash: HASH,
      fileId: 1,
      path: 'changed.bin',
      length: 100,
      headerTimeoutMs: 1_000,
      inactivityTimeoutMs: 1_000,
    });
    const service = createService(adapter);
    const created = service.create(input);
    const failed = await waitForState(service, created.id, 'failed');

    expect(failed.error?.code).toBe('torrent_file_not_found');
    await waitUntil(() => adapter.drop.mock.calls.length === 1);
  });

  it('reports disabled TorrServer without resolving or joining a swarm', async () => {
    const resolver = createResolver();
    const service = createService(undefined, resolver);
    const created = service.create(input);
    const failed = await waitForState(service, created.id, 'failed');

    expect(failed.error).toMatchObject({
      code: 'torrserver_unavailable',
      transient: true,
    });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('invalidates the capability and releases TorrServer after a stream failure', async () => {
    const adapter = createAdapter();
    const service = createService(adapter);
    const created = service.create(input);
    const ready = await waitForState(service, created.id, 'ready');
    const capability = ready.streamUrl!.split('/').at(-1)!;

    await service.failStreamCapability(capability, {
      code: 'torrent_pieces_unavailable',
      message: 'Pieces stalled.',
      transient: true,
    });

    const failed = await service.get(created.id);
    expect(failed).toMatchObject({
      state: 'failed',
      error: { code: 'torrent_pieces_unavailable' },
    });
    expect(failed).not.toHaveProperty('streamUrl');
    await expect(
      service.resolveStreamCapability(capability),
    ).rejects.toMatchObject({
      code: 'torrent_pieces_unavailable',
    });
    expect(adapter.drop).toHaveBeenCalledWith(HASH);
  });

  it('shutdown stops sessions and releases different owned torrents', async () => {
    const adapter = createAdapter();
    const resolver = createResolver((call) =>
      resolved(call === 0 ? HASH : SECOND_HASH),
    );
    const service = createService(adapter, resolver);
    const first = service.create(input);
    const second = service.create({
      ...input,
      observation: { provider: 'provider-a', id: 'provider-a:second' },
    });
    await waitForState(service, first.id, 'ready');
    await waitForState(service, second.id, 'ready');

    await service.onApplicationShutdown();
    await expect(service.get(first.id)).resolves.toMatchObject({
      state: 'stopped',
    });
    await expect(service.get(second.id)).resolves.toMatchObject({
      state: 'stopped',
    });
    expect(adapter.drop).toHaveBeenCalledTimes(2);
    expect(adapter.drop).toHaveBeenCalledWith(HASH);
    expect(adapter.drop).toHaveBeenCalledWith(SECOND_HASH);
  });

  it('rejects selection outside selection_required state', async () => {
    const service = createService(createAdapter());
    const created = service.create(input);
    await waitForState(service, created.id, 'ready');
    await expect(service.selectFile(created.id, 1)).rejects.toBeInstanceOf(
      OriginalTorrentSessionConflictError,
    );
  });

  function createService(
    adapter: jest.Mocked<OriginalTorrentRuntimeAdapter> | undefined,
    resolver: OriginalTorrentSourceResolver = createResolver(),
    now?: () => number,
    serviceConfig = config,
  ): OriginalTorrentSessionService {
    let id = 0;
    let capability = 0;
    const service = new OriginalTorrentSessionService(
      adapter,
      resolver,
      serviceConfig,
      {
        now,
        createId: () => String(++id).padStart(32, 'A'),
        createCapability: () => String(++capability).padStart(43, 'C'),
      },
    );
    services.push(service);
    return service;
  }
});

function createAdapter(
  addedFiles = [{ id: 1, path: 'original.bin', length: 100 }],
): jest.Mocked<OriginalTorrentRuntimeAdapter> {
  const addedStatus = status(addedFiles);
  return {
    health: jest
      .fn()
      .mockResolvedValue({ version: 'MatriX.141', compatible: true }),
    add: jest.fn().mockResolvedValue(addedStatus),
    waitForMetadata: jest.fn().mockResolvedValue(addedStatus),
    resolveFileTarget: jest.fn((hash, fileId) => {
      const file = addedStatus.files.find((entry) => entry.id === fileId)!;
      return Promise.resolve({
        url: new URL(`http://torrserver:8090/play/${hash}/${fileId}`),
        hash,
        fileId,
        path: file.path,
        length: file.length,
        headerTimeoutMs: 1_000,
        inactivityTimeoutMs: 1_000,
      });
    }),
    drop: jest.fn().mockResolvedValue(undefined),
  };
}

function createResolver(
  value:
    | ResolvedTorrentObservation
    | ((call: number) => ResolvedTorrentObservation) = resolved(),
): jest.Mocked<OriginalTorrentSourceResolver> {
  let calls = 0;
  return {
    resolve: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(typeof value === 'function' ? value(calls++) : value),
      ),
  };
}

function resolved(hash = HASH): ResolvedTorrentObservation {
  return {
    candidate: {
      id: input.observation.id,
      provider: input.observation.provider,
      title: 'Example release',
      infoHash: hash,
      handoff: { kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash}` },
      availability: 'available',
    },
    source: {
      kind: 'magnet',
      uri: `magnet:?xt=urn:btih:${hash}`,
      expectedHash: hash,
      title: 'Example release',
    },
  };
}

function status(files: { id: number; path: string; length: number }[]) {
  return {
    hash: HASH,
    state: 2 as const,
    stateLabel: 'torrent working',
    loadedSize: 0,
    torrentSize: files.reduce((sum, file) => sum + file.length, 0),
    files,
  };
}

async function waitForState(
  service: OriginalTorrentSessionService,
  id: string,
  state: OriginalTorrentSessionSnapshot['state'],
): Promise<OriginalTorrentSessionSnapshot> {
  let last: OriginalTorrentSessionSnapshot | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    last = await service.get(id);
    if (last.state === state) return last;
    await settle();
  }
  throw new Error(
    `Session did not reach ${state}; last state was ${last?.state}.`,
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await settle();
  }
  throw new Error('Condition was not reached.');
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
