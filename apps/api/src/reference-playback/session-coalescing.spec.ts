import { TorrentCandidateCatalog } from './candidate-catalog';
import { TorrentPlaybackSessionService } from './session-service';
import {
  mockTorrServerClient,
  TEST_PLAYBACK_CONFIG,
  torrentCandidate,
  torrentResponse,
  torrServerTorrent,
} from './test-helpers';

describe('TorrentPlaybackSessionService resource bounds', () => {
  it('coalesces identical info hashes and drops only after the final reference stops', async () => {
    const catalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    catalog.record(
      torrentResponse([
        torrentCandidate({ id: 'first' }),
        torrentCandidate({ id: 'second', provider: 'mirror-torrent' }),
      ]),
    );
    const client = mockTorrServerClient();
    const added = deferred<ReturnType<typeof torrServerTorrent>>();
    client.add.mockReturnValue(added.promise);
    const ids = ['A'.repeat(43), 'B'.repeat(43)];
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
      { createId: () => ids.shift()! },
    );

    const firstPending = service.createSession({
      provider: 'test-torrent',
      candidateId: 'first',
    });
    const secondPending = service.createSession({
      provider: 'mirror-torrent',
      candidateId: 'second',
    });
    expect(client.add.mock.calls).toHaveLength(1);

    added.resolve(torrServerTorrent());
    const [first, second] = await Promise.all([firstPending, secondPending]);
    expect(first.state).toBe('ready');
    expect(second.state).toBe('ready');

    await service.stopSession(first.id);
    expect(client.drop.mock.calls).toHaveLength(0);
    await service.stopSession(second.id);
    expect(client.drop.mock.calls).toHaveLength(1);
  });

  it('polls metadata once for a shared torrent that add has not resolved yet', async () => {
    const catalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    catalog.record(torrentResponse([torrentCandidate()]));
    const client = mockTorrServerClient();
    client.add.mockResolvedValueOnce(torrServerTorrent([]));
    client.waitForMetadata.mockResolvedValueOnce(torrServerTorrent());
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
    );

    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });
    expect(session.state).toBe('ready');
    expect(client.waitForMetadata.mock.calls).toHaveLength(1);
    await service.stopSession(session.id);
  });

  it('finishes the prior drop before re-adding the same hash', async () => {
    const catalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    catalog.record(
      torrentResponse([
        torrentCandidate({ id: 'first' }),
        torrentCandidate({ id: 'second' }),
      ]),
    );
    const client = mockTorrServerClient();
    const dropped = deferred<void>();
    client.drop.mockReturnValueOnce(dropped.promise);
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
    );
    const first = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'first',
    });
    const stopping = service.stopSession(first.id);
    const secondPending = service.createSession({
      provider: 'test-torrent',
      candidateId: 'second',
    });

    expect(client.add.mock.calls).toHaveLength(1);
    dropped.resolve(undefined);
    await stopping;
    const second = await secondPending;
    expect(client.add.mock.calls).toHaveLength(2);
    expect(second.state).toBe('ready');
    await service.stopSession(second.id);
  });

  it('enforces total and concurrent-start limits and reuses terminal capacity', async () => {
    const catalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    catalog.record(
      torrentResponse([
        torrentCandidate({ id: 'first' }),
        torrentCandidate({ id: 'second' }),
      ]),
    );
    const client = mockTorrServerClient();
    const config = {
      ...TEST_PLAYBACK_CONFIG,
      maxSessions: 1,
      maxStartingSessions: 1,
    };
    const service = new TorrentPlaybackSessionService(catalog, client, config);
    const first = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'first',
    });

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'second',
      }),
    ).rejects.toMatchObject({ code: 'session_capacity_exceeded' });

    await service.stopSession(first.id);
    const replacement = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'second',
    });
    expect(replacement.state).toBe('ready');

    const startCatalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    startCatalog.record(
      torrentResponse([
        torrentCandidate({ id: 'third' }),
        torrentCandidate({
          id: 'fourth',
          infoHash: 'b'.repeat(40),
          handoff: {
            kind: 'magnet',
            uri: `magnet:?xt=urn:btih:${'b'.repeat(40)}`,
          },
        }),
      ]),
    );
    const startClient = mockTorrServerClient();
    const pendingAdd = deferred<ReturnType<typeof torrServerTorrent>>();
    startClient.add.mockReturnValueOnce(pendingAdd.promise);
    const startService = new TorrentPlaybackSessionService(
      startCatalog,
      startClient,
      { ...TEST_PLAYBACK_CONFIG, maxStartingSessions: 1 },
    );
    const pending = startService.createSession({
      provider: 'test-torrent',
      candidateId: 'third',
    });

    await expect(
      startService.createSession({
        provider: 'test-torrent',
        candidateId: 'fourth',
      }),
    ).rejects.toMatchObject({ code: 'start_capacity_exceeded' });
    pendingAdd.resolve(torrServerTorrent());
    const started = await pending;
    await startService.stopSession(started.id);
    await service.stopSession(replacement.id);
  });

  it('returns not-found after a session expires and drops its resource', async () => {
    let now = Date.parse('2026-07-25T00:00:00.000Z');
    const catalog = new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
    catalog.record(torrentResponse([torrentCandidate()]));
    const client = mockTorrServerClient();
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
      {
        now: () => now,
      },
    );
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });
    now += TEST_PLAYBACK_CONFIG.sessionTtlMs + 1;

    try {
      service.getStreamSource(session.id);
      throw new Error('Expected the expired session lookup to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'session_not_found' });
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.drop.mock.calls).toHaveLength(1);
  });
});

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
