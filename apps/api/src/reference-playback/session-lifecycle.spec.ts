import { TorrentCandidateCatalog } from './candidate-catalog';
import { TorrentPlaybackSessionService } from './session-service';
import {
  mockTorrServerClient,
  TEST_HASH,
  TEST_MAGNET,
  TEST_PLAYBACK_CONFIG,
  torrentCandidate,
  torrentResponse,
  torrServerTorrent,
} from './test-helpers';

describe('TorrentPlaybackSessionService lifecycle', () => {
  it('stays disabled without an operator-configured TorServer client', async () => {
    const catalog = createCatalog();
    catalog.record(torrentResponse([torrentCandidate()]));
    const service = new TorrentPlaybackSessionService(
      catalog,
      undefined,
      TEST_PLAYBACK_CONFIG,
    );

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
      }),
    ).rejects.toMatchObject({ code: 'disabled' });
  });

  it('creates a high-entropy ready session without exposing the magnet', async () => {
    const { service, client } = createService();
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      streamUrl: expect.stringMatching(
        /^\/reference\/torrent-playback\/sessions\/[A-Za-z0-9_-]{43}\/stream$/,
      ),
      state: 'ready',
      infoHash: TEST_HASH,
      compatibility: 'direct',
      selectedFile: { id: 1, path: 'Example.Movie.2026.mp4' },
    });
    expect(JSON.stringify(session)).not.toContain('magnet:');
    expect(client.add.mock.calls).toContainEqual([
      TEST_MAGNET,
      {
        title: 'Example Movie 2026',
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(service.getSession(session.id)).toEqual(session);
    expect(service.getStreamSource(session.id)).toMatchObject({
      target: {
        url: new URL(`http://torrserver.test/play/${TEST_HASH}/1`),
        hash: TEST_HASH,
        fileId: 1,
      },
      file: session.selectedFile,
      signal: expect.any(AbortSignal),
    });

    const stopped = await service.stopSession(session.id);
    expect(stopped.state).toBe('stopped');
    expectSessionError(
      () => service.getStreamSource(session.id),
      'session_not_streamable',
    );
    expect((await service.stopSession(session.id)).state).toBe('stopped');
    expect(client.drop.mock.calls).toHaveLength(1);
  });

  it('returns a bounded safe file list for ambiguous metadata', async () => {
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'Movie.1080p.mkv', length: 2_000 },
        { id: 2, path: 'Movie.2160p.mkv', length: 4_000 },
      ]),
    });
    const selection = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(selection.state).toBe('file_selection_required');
    expect(selection.files?.map((file) => file.id)).toEqual([2, 1]);
    expectSessionError(
      () => service.getStreamSource(selection.id),
      'session_not_streamable',
    );

    const selected = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
      fileId: 2,
    });
    expect(selected).toMatchObject({
      state: 'conversion_required',
      compatibility: 'remux_required',
      selectedFile: { id: 2 },
    });
    await service.stopSession(selection.id);
    expect(client.drop.mock.calls).toHaveLength(0);
    await service.stopSession(selected.id);
    expect(client.drop.mock.calls).toHaveLength(1);
  });

  it('rejects missing, unsafe, non-magnet, and mismatched candidates before TorServer work', async () => {
    const cases = [
      torrentCandidate({
        id: 'external',
        handoff: { kind: 'external', uri: 'https://example.com' },
      }),
      torrentCandidate({
        id: 'credentialed',
        handoff: {
          kind: 'magnet',
          uri: TEST_MAGNET,
          headers: { authorization: 'secret' },
        },
      }),
      torrentCandidate({ id: 'mismatch', infoHash: 'b'.repeat(40) }),
    ];
    const catalog = createCatalog();
    catalog.record(torrentResponse(cases));
    const client = mockTorrServerClient();
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
    );

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'candidate_not_found' });
    await expect(
      service.createSession({
        provider: ' test-torrent',
        candidateId: 'external',
      }),
    ).rejects.toMatchObject({ code: 'candidate_not_found' });
    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'external',
      }),
    ).rejects.toMatchObject({ code: 'candidate_not_playable' });
    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'credentialed',
      }),
    ).rejects.toMatchObject({ code: 'candidate_not_playable' });
    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'mismatch',
      }),
    ).rejects.toMatchObject({ code: 'candidate_identity_mismatch' });
    expect(client.add.mock.calls).toHaveLength(0);
  });

  it('rejects invalid or non-video file selections and removes the failed creation', async () => {
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'Movie.mkv', length: 2_000 },
        { id: 2, path: 'subtitle.srt', length: 100 },
      ]),
    });

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
        fileId: 2,
      }),
    ).rejects.toMatchObject({ code: 'invalid_file_selection' });
    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
        fileId: 0,
      }),
    ).rejects.toMatchObject({ code: 'invalid_file_selection' });
    expect(client.drop.mock.calls).toHaveLength(1);
  });

  it('reports failed preparation safely and cleans the TorServer resource', async () => {
    const { service, client } = createService();
    client.add.mockRejectedValueOnce(new Error(`failed ${TEST_MAGNET}`));

    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      state: 'failed',
      error: {
        code: 'torrserver_unavailable',
        message: 'TorServer could not prepare the selected torrent.',
      },
    });
    expect(JSON.stringify(session)).not.toContain(TEST_MAGNET);
    expect(client.drop.mock.calls).toContainEqual([TEST_HASH]);
  });

  it('fails safely when metadata has no video and releases the resource', async () => {
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'readme.txt', length: 500 },
        { id: 2, path: 'subtitle.srt', length: 1_000 },
      ]),
    });

    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });
    expect(session).toMatchObject({
      state: 'failed',
      error: { code: 'no_playable_files' },
    });
    expect(client.drop.mock.calls).toHaveLength(1);
  });

  it('cancels caller-abandoned starts and performs shutdown cleanup', async () => {
    const { service, client } = createService();
    client.add.mockImplementation(
      async (_magnet, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = service.createSession(
      { provider: 'test-torrent', candidateId: 'candidate-1' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(client.drop.mock.calls).toHaveLength(1);
    await service.onApplicationShutdown();
    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
      }),
    ).rejects.toMatchObject({ code: 'disabled' });
  });

  it('turns the bounded start timer into a safe failed session', async () => {
    const catalog = createCatalog();
    catalog.record(torrentResponse([torrentCandidate()]));
    const client = mockTorrServerClient();
    client.add.mockImplementation(
      async (_magnet, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('timed out')),
            { once: true },
          );
        }),
    );
    let startTimeout: (() => void) | undefined;
    const service = new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
      {
        setTimer: (callback, milliseconds) => {
          if (milliseconds === TEST_PLAYBACK_CONFIG.startTimeoutMs) {
            startTimeout = callback;
          }

          return setTimeout(() => undefined, 60_000);
        },
      },
    );
    const pending = service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });
    startTimeout!();

    await expect(pending).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'start_timeout' },
    });
    expect(client.drop.mock.calls).toHaveLength(1);
  });
});

function createCatalog(): TorrentCandidateCatalog {
  return new TorrentCandidateCatalog(TEST_PLAYBACK_CONFIG);
}

function expectSessionError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected playback session operation to fail.');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function createService(
  options: { torrent?: ReturnType<typeof torrServerTorrent> } = {},
): {
  service: TorrentPlaybackSessionService;
  client: ReturnType<typeof mockTorrServerClient>;
} {
  const catalog = createCatalog();
  catalog.record(torrentResponse([torrentCandidate()]));
  const client = mockTorrServerClient(options.torrent);
  return {
    client,
    service: new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
    ),
  };
}
