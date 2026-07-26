import { TorrentCandidateCatalog } from './candidate-catalog';
import { TorrentMediaProbeError, type TorrentMediaProbe } from './media-probe';
import {
  TorrentMediaRemuxError,
  type TorrentMediaRemuxResult,
  type TorrentMediaRemuxer,
} from './media-remux';
import { TorrentPlaybackSessionService } from './session-service';
import { TorrServerClientError } from './torrserver';
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
        expectedHash: TEST_HASH,
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

  it('retries one transient TorServer preparation failure', async () => {
    const { service, client } = createService();
    client.add
      .mockRejectedValueOnce(
        new TorrServerClientError(
          'request_timeout',
          'TorServer request timed out.',
        ),
      )
      .mockResolvedValueOnce(torrServerTorrent());

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
      }),
    ).resolves.toMatchObject({ state: 'ready' });
    expect(client.add.mock.calls).toHaveLength(2);
  });

  it('uses exact probed streams instead of release-name heuristics', async () => {
    const mediaProbe = {
      probe: jest.fn().mockResolvedValue({
        formatNames: ['mov', 'mp4'],
        video: { codecName: 'h264', pixelFormat: 'yuv420p' },
        audio: { codecName: 'aac' },
      }),
    } satisfies TorrentMediaProbe;
    const { service } = createService({
      candidate: torrentCandidate({ release: { videoCodec: 'x265' } }),
      mediaProbe,
    });

    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      state: 'ready',
      compatibility: 'direct',
      selectedFile: { compatibility: 'direct' },
    });
    expect(mediaProbe.probe).toHaveBeenCalledWith({
      target: {
        url: new URL(`http://torrserver.test/play/${TEST_HASH}/1`),
        hash: TEST_HASH,
        fileId: 1,
      },
      file: expect.objectContaining({
        id: 1,
        compatibility: 'transcode_required',
      }),
      signal: expect.any(AbortSignal),
    });
    await service.stopSession(session.id);
  });

  it('prepares an exact remux asynchronously and cleans its private output', async () => {
    const mediaProbe = {
      probe: jest.fn().mockResolvedValue({
        formatNames: ['matroska', 'webm'],
        video: { codecName: 'h264', pixelFormat: 'yuv420p' },
        audio: { codecName: 'aac' },
      }),
    } satisfies TorrentMediaProbe;
    let finishRemux!: (result: TorrentMediaRemuxResult) => void;
    const pendingRemux = new Promise<TorrentMediaRemuxResult>((resolve) => {
      finishRemux = resolve;
    });
    const mediaRemuxer = {
      remux: jest.fn().mockReturnValue(pendingRemux),
      release: jest.fn().mockResolvedValue(undefined),
    } satisfies TorrentMediaRemuxer;
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'Example.Movie.2026.mkv', length: 1_000_000 },
      ]),
      mediaProbe,
      mediaRemuxer,
    });
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      state: 'starting',
      compatibility: 'remux_required',
      selectedFile: { id: 1, compatibility: 'remux_required' },
    });
    expectSessionError(
      () => service.getStreamSource(session.id),
      'session_not_streamable',
    );
    expect(mediaRemuxer.remux).toHaveBeenCalledWith({
      target: client.createPlayTarget(TEST_HASH, 1),
      file: expect.objectContaining({
        id: 1,
        path: expect.stringMatching(/\.mkv$/),
      }),
      container: 'mp4',
      signal: expect.any(AbortSignal),
    });

    const result: TorrentMediaRemuxResult = {
      id: 'r'.repeat(43),
      target: {
        url: new URL(`http://media-worker.test/remux/${'r'.repeat(43)}`),
      },
      length: 900_000,
      container: 'mp4',
      contentType: 'video/mp4',
    };
    finishRemux(result);
    await waitFor(() => service.getSession(session.id).state === 'ready');

    expect(service.getSession(session.id)).toMatchObject({
      state: 'ready',
      compatibility: 'remux_required',
      playbackMode: 'remux',
    });
    expect(service.getStreamSource(session.id)).toMatchObject({
      target: { url: result.target.url, kind: 'media_worker' },
      file: {
        id: 1,
        path: 'remux.mp4',
        length: 900_000,
        compatibility: 'direct',
      },
    });

    await service.stopSession(session.id);
    expect(mediaRemuxer.release).toHaveBeenCalledWith(result);
    expect(client.drop.mock.calls).toContainEqual([TEST_HASH]);
  });

  it('keeps transcode-required files unavailable to the stream capability', async () => {
    const mediaProbe = {
      probe: jest.fn().mockResolvedValue({
        formatNames: ['matroska'],
        video: { codecName: 'hevc', pixelFormat: 'yuv420p10le' },
        audio: { codecName: 'aac' },
      }),
    } satisfies TorrentMediaProbe;
    const { service } = createService({ mediaProbe });
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      state: 'conversion_required',
      compatibility: 'transcode_required',
    });
    expectSessionError(
      () => service.getStreamSource(session.id),
      'session_not_streamable',
    );
    await service.stopSession(session.id);
  });

  it('fails an over-limit background remux and releases the torrent', async () => {
    const mediaProbe = {
      probe: jest.fn().mockResolvedValue({
        formatNames: ['matroska'],
        video: { codecName: 'h264', pixelFormat: 'yuv420p' },
        audio: { codecName: 'aac' },
      }),
    } satisfies TorrentMediaProbe;
    const mediaRemuxer = {
      remux: jest
        .fn()
        .mockRejectedValue(
          new TorrentMediaRemuxError('output_limit', 'private detail'),
        ),
      release: jest.fn(),
    } satisfies TorrentMediaRemuxer;
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'Example.Movie.2026.mkv', length: 1_000_000 },
      ]),
      mediaProbe,
      mediaRemuxer,
    });
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });
    await waitFor(() => service.getSession(session.id).state === 'failed');

    expect(service.getSession(session.id)).toMatchObject({
      state: 'failed',
      error: {
        code: 'media_remux_output_limit',
        message: 'The selected media exceeds the configured remux limit.',
      },
    });
    expect(client.drop.mock.calls).toContainEqual([TEST_HASH]);
  });

  it('cancels an in-flight remux when its session is stopped', async () => {
    const mediaProbe = {
      probe: jest.fn().mockResolvedValue({
        formatNames: ['matroska'],
        video: { codecName: 'h264', pixelFormat: 'yuv420p' },
        audio: { codecName: 'aac' },
      }),
    } satisfies TorrentMediaProbe;
    let remuxSignal: AbortSignal | undefined;
    const mediaRemuxer: TorrentMediaRemuxer = {
      remux: ({ signal }) =>
        new Promise((_resolve, reject) => {
          remuxSignal = signal;
          signal?.addEventListener(
            'abort',
            () =>
              reject(new TorrentMediaRemuxError('aborted', 'private detail')),
            { once: true },
          );
        }),
      release: jest.fn(),
    };
    const { service, client } = createService({
      torrent: torrServerTorrent([
        { id: 1, path: 'Example.Movie.2026.mkv', length: 1_000_000 },
      ]),
      mediaProbe,
      mediaRemuxer,
    });
    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    await expect(service.stopSession(session.id)).resolves.toMatchObject({
      state: 'stopped',
    });
    expect(remuxSignal?.aborted).toBe(true);
    expect(client.drop.mock.calls).toContainEqual([TEST_HASH]);
  });

  it('reports bounded media probe failure and cleans the torrent resource', async () => {
    const mediaProbe = {
      probe: jest
        .fn()
        .mockRejectedValue(
          new TorrentMediaProbeError(
            'timeout',
            'Media inspection exceeded its configured time budget.',
          ),
        ),
    } satisfies TorrentMediaProbe;
    const { service, client } = createService({ mediaProbe });

    const session = await service.createSession({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
    });

    expect(session).toMatchObject({
      state: 'failed',
      error: {
        code: 'media_probe_timeout',
        message:
          'Media inspection did not finish within the configured budget.',
      },
    });
    expect(client.drop.mock.calls).toContainEqual([TEST_HASH]);
    expect(mediaProbe.probe).toHaveBeenCalledTimes(2);
  });

  it('retries a timed-out media probe after the torrent stream warms up', async () => {
    const mediaProbe = {
      probe: jest
        .fn()
        .mockRejectedValueOnce(
          new TorrentMediaProbeError(
            'timeout',
            'Media inspection exceeded its configured time budget.',
          ),
        )
        .mockResolvedValueOnce({
          formatNames: ['mov', 'mp4'],
          video: { codecName: 'h264', pixelFormat: 'yuv420p' },
          audio: { codecName: 'aac' },
        }),
    } satisfies TorrentMediaProbe;
    const { service } = createService({ mediaProbe });

    await expect(
      service.createSession({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
      }),
    ).resolves.toMatchObject({ state: 'ready' });
    expect(mediaProbe.probe).toHaveBeenCalledTimes(2);
  });

  it('falls back to direct only for an exact YTS torrent-file x264 MP4', async () => {
    const candidate = torrentCandidate({
      provider: 'yts-torrent',
      id: `yts-torrent:${TEST_HASH}`,
      handoff: {
        kind: 'torrent_file',
        uri: `https://yts.gg/torrent/download/${TEST_HASH}`,
      },
      release: { source: 'bluray', videoCodec: 'x264' },
    });
    const mediaProbe = {
      probe: jest
        .fn()
        .mockRejectedValue(
          new TorrentMediaProbeError(
            'timeout',
            'Media inspection exceeded its configured time budget.',
          ),
        ),
    } satisfies TorrentMediaProbe;
    const { service } = createService({ candidate, mediaProbe });

    await expect(
      service.createSession({
        provider: candidate.provider,
        candidateId: candidate.id,
      }),
    ).resolves.toMatchObject({
      state: 'ready',
      compatibility: 'direct',
      playbackMode: 'direct',
    });
    expect(mediaProbe.probe).toHaveBeenCalledTimes(2);
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
  options: {
    torrent?: ReturnType<typeof torrServerTorrent>;
    candidate?: ReturnType<typeof torrentCandidate>;
    mediaProbe?: TorrentMediaProbe;
    mediaRemuxer?: TorrentMediaRemuxer;
  } = {},
): {
  service: TorrentPlaybackSessionService;
  client: ReturnType<typeof mockTorrServerClient>;
} {
  const catalog = createCatalog();
  catalog.record(torrentResponse([options.candidate ?? torrentCandidate()]));
  const client = mockTorrServerClient(options.torrent);
  return {
    client,
    service: new TorrentPlaybackSessionService(
      catalog,
      client,
      TEST_PLAYBACK_CONFIG,
      {
        mediaProbe: options.mediaProbe,
        mediaRemuxer: options.mediaRemuxer,
      },
    ),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}
