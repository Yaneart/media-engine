/* eslint-disable @typescript-eslint/unbound-method -- Jest mock methods are inspected, not detached and invoked. */
import { OriginalTorrentRuntimeError } from '../original-torrent-runtime';
import type { OriginalTorrentSessionTelemetryEvent } from '../original-torrent-observability';
import type { OriginalTorrentSessionConfig } from './session.config';
import {
  OriginalTorrentSessionConflictError,
  OriginalTorrentSessionCapacityError,
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
  maxConcurrentCreations: 4,
  maxConcurrentStreams: 8,
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
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, ownership: 'application' }),
    );
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
    add.resolve(acquiredStatus([{ id: 1, path: 'original.bin', length: 100 }]));
    await waitForState(service, first.id, 'ready');
    await waitForState(service, second.id, 'ready');
    expect(adapter.add).toHaveBeenCalledTimes(1);

    await service.stop(first.id);
    expect(adapter.release).not.toHaveBeenCalled();
    await service.stop(second.id);
    expect(adapter.release).toHaveBeenCalledTimes(1);
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, ownership: 'application' }),
    );
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
    expect(adapter.release).not.toHaveBeenCalled();
  });

  it('bounds concurrent creation and releases capacity after cancellation', async () => {
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
    const service = createService(createAdapter(), resolver, undefined, {
      ...config,
      maxConcurrentCreations: 1,
    });
    const first = service.create(input);

    expect(() => service.create(input)).toThrow(
      OriginalTorrentSessionCapacityError,
    );
    await expect(service.get(first.id)).resolves.toMatchObject({
      state: 'adding',
    });
    await service.stop(first.id);
    await waitUntil(() => {
      try {
        const next = service.create(input);
        void service.stop(next.id);
        return true;
      } catch (error) {
        if (error instanceof OriginalTorrentSessionCapacityError) return false;
        throw error;
      }
    });
  });

  it('does not re-add a hash when stopped while waiting for its prior drop', async () => {
    const dropping = deferred<void>();
    const adapter = createAdapter();
    adapter.release.mockReturnValue(dropping.promise);
    const resolver = createResolver();
    const service = createService(adapter, resolver);
    const first = service.create(input);
    await waitForState(service, first.id, 'ready');

    const firstStop = service.stop(first.id);
    await waitUntil(() => adapter.release.mock.calls.length === 1);
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
    await waitUntil(() => adapter.release.mock.calls.length === 1);
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
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, ownership: 'application' }),
    );
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
    await waitUntil(() => adapter.release.mock.calls.length === 1);
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
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, ownership: 'application' }),
    );
  });

  it('invalidates a stale capability after TorrServer replaces its lease', async () => {
    const adapter = createAdapter();
    adapter.validateLease
      .mockResolvedValueOnce(
        status([{ id: 1, path: 'original.bin', length: 100 }]),
      )
      .mockRejectedValueOnce(
        new OriginalTorrentRuntimeError(
          'runtime_restarted',
          'TorrServer restarted.',
          true,
        ),
      );
    const service = createService(adapter);
    const created = service.create(input);
    const ready = await waitForState(service, created.id, 'ready');
    const capability = ready.streamUrl!.split('/').at(-1)!;

    await expect(
      service.resolveStreamCapability(capability),
    ).rejects.toMatchObject({
      code: 'torrserver_restarted',
      transient: true,
    });
    await expect(service.get(created.id)).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'torrserver_restarted', transient: true },
    });
    await expect(
      service.resolveStreamCapability(capability),
    ).rejects.toMatchObject({ code: 'torrserver_restarted' });
  });

  it('runs startup recovery before resolving a new observation', async () => {
    const adapter = createAdapter();
    const recovery = deferred<void>();
    adapter.recoverOwned.mockReturnValue(recovery.promise);
    const resolver = createResolver();
    const service = createService(adapter, resolver);
    const created = service.create(input);

    await settle();
    expect(adapter.recoverOwned).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).not.toHaveBeenCalled();
    recovery.resolve();
    await waitForState(service, created.id, 'ready');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('rejects API startup when the pinned TorrServer version is incompatible', async () => {
    const adapter = createAdapter();
    adapter.recoverOwned.mockRejectedValue(
      new OriginalTorrentRuntimeError(
        'incompatible_version',
        'TorrServer version mismatch.',
        false,
      ),
    );
    const service = createService(adapter);

    await expect(service.onModuleInit()).rejects.toMatchObject({
      code: 'incompatible_version',
      transient: false,
    });
  });

  it.each([
    'recovery',
    'health',
    'add',
    'metadata',
    'validate',
    'target',
  ] as const)(
    'maps a TorrServer outage during %s and releases any acquired lease',
    async (phase) => {
      const adapter = createAdapter(phase === 'metadata' ? [] : undefined);
      const outage = new OriginalTorrentRuntimeError(
        'unavailable',
        `TorrServer ${phase} outage.`,
        true,
      );
      if (phase === 'recovery') adapter.recoverOwned.mockRejectedValue(outage);
      if (phase === 'health') adapter.health.mockRejectedValue(outage);
      if (phase === 'add') adapter.add.mockRejectedValue(outage);
      if (phase === 'metadata') {
        adapter.waitForMetadata.mockRejectedValue(outage);
      }
      if (phase === 'validate') adapter.validateLease.mockRejectedValue(outage);
      if (phase === 'target') {
        adapter.resolveFileTarget.mockRejectedValue(outage);
      }
      const service = createService(adapter);
      const created = service.create(input);
      const failed = await waitForState(service, created.id, 'failed');

      expect(failed.error).toMatchObject({
        code: 'torrent_pieces_unavailable',
        transient: true,
      });
      const acquired = ['metadata', 'validate', 'target'].includes(phase);
      if (acquired) {
        await waitUntil(() => adapter.release.mock.calls.length === 1);
      } else {
        expect(adapter.release).not.toHaveBeenCalled();
      }
    },
  );

  it('reports metadata latency, active references, terminal state, and cleanup without identifiers', async () => {
    const events: OriginalTorrentSessionTelemetryEvent[] = [];
    let now = 100;
    const adapter = createAdapter();
    const service = createService(
      adapter,
      undefined,
      () => (now += 10),
      config,
      (event) => events.push(event),
    );
    const created = service.create(input);
    const ready = await waitForState(service, created.id, 'ready');
    await service.stop(created.id);

    expect(ready.state).toBe('ready');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'metadata_ready',
          outcome: 'success',
          ownership: 'application',
          durationMs: expect.any(Number),
          files: 1,
          resources: 1,
          references: 1,
        }),
        expect.objectContaining({
          event: 'session_state',
          state: 'stopped',
          outcome: 'cancelled',
          activeSessions: 0,
        }),
        expect.objectContaining({
          event: 'cleanup',
          outcome: 'success',
          resources: 0,
          references: 0,
        }),
      ]),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(created.id);
    expect(serialized).not.toContain(HASH);
    expect(serialized).not.toContain('Example release');
    expect(serialized).not.toContain('magnet:');
  });

  it('soaks repeated shared sessions without retained records, references, or torrents', async () => {
    const events: OriginalTorrentSessionTelemetryEvent[] = [];
    let now = Date.parse('2026-07-30T00:00:00.000Z');
    const adapter = createAdapter();
    const service = createService(
      adapter,
      undefined,
      () => now,
      { ...config, terminalRetentionMs: 1 },
      (event) => events.push(event),
    );

    for (let cycle = 0; cycle < 16; cycle += 1) {
      const created = Array.from({ length: 4 }, (_, index) =>
        service.create({
          ...input,
          observation: {
            provider: 'provider-a',
            id: `cycle-${cycle}-session-${index}`,
          },
        }),
      );
      await Promise.all(
        created.map((record) => waitForState(service, record.id, 'ready')),
      );
      await Promise.all(created.map((record) => service.stop(record.id)));
      now += 2;
      await service.sweepExpiredSessions();
      await Promise.all(
        created.map((record) =>
          expect(service.get(record.id)).rejects.toBeInstanceOf(
            OriginalTorrentSessionNotFoundError,
          ),
        ),
      );
    }

    expect(adapter.add).toHaveBeenCalledTimes(16);
    expect(adapter.release).toHaveBeenCalledTimes(16);
    expect(events.filter((event) => event.event === 'cleanup')).toHaveLength(
      16,
    );
    expect(events.at(-1)).toMatchObject({
      resources: 0,
      references: 0,
      activeSessions: 0,
      activeCreations: 0,
    });
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
    expect(adapter.release).toHaveBeenCalledTimes(2);
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, ownership: 'application' }),
    );
    expect(adapter.release).toHaveBeenCalledWith(
      expect.objectContaining({ hash: SECOND_HASH, ownership: 'application' }),
    );
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
    report?: (event: OriginalTorrentSessionTelemetryEvent) => void,
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
        report,
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
    recoverOwned: jest.fn().mockResolvedValue(undefined),
    health: jest
      .fn()
      .mockResolvedValue({ version: 'MatriX.141', compatible: true }),
    add: jest.fn((source) =>
      Promise.resolve({
        ...addedStatus,
        hash: source.expectedHash,
        lease: {
          hash: source.expectedHash,
          timestamp: 1,
          ownership: 'application' as const,
        },
      }),
    ),
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
    validateLease: jest.fn().mockResolvedValue(addedStatus),
    release: jest.fn().mockResolvedValue(undefined),
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

function acquiredStatus(files: { id: number; path: string; length: number }[]) {
  return {
    ...status(files),
    lease: { hash: HASH, timestamp: 1, ownership: 'application' as const },
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
