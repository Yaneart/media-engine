import type {
  MediaEngine,
  TorrentCandidate,
  TorrentDiscoveryResponse,
} from '@media-engine/core';
import type { OriginalTorrentSessionConfig } from './session.config';
import { TorrentSourceResolutionError } from './session.errors';
import { ServerTorrentSourceResolver } from './torrent-source-resolver';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const config: OriginalTorrentSessionConfig = {
  sessionTtlMs: 60_000,
  terminalRetentionMs: 1_000,
  cleanupIntervalMs: 1_000,
  sourceRequestTimeoutMs: 1_000,
  maxConcurrentCreations: 4,
  maxConcurrentStreams: 8,
  maxTorrentBytes: 8,
};
const input = {
  query: { type: 'movie' as const, title: 'Example', year: 2026 },
  observation: { provider: 'provider-a', id: 'provider-a:opaque' },
};

describe('server torrent source resolver', () => {
  it('resolves an exact server-known magnet and forces one provider', async () => {
    const mediaEngine = engineWith(candidate());
    const fetch = jest.fn();
    const resolver = new ServerTorrentSourceResolver(
      mediaEngine,
      config,
      fetch,
    );

    await expect(
      resolver.resolve(input, new AbortController().signal),
    ).resolves.toEqual({
      candidate: candidate(),
      source: {
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH}`,
        expectedHash: HASH,
        title: 'Example unusual release',
      },
    });
    expect(mediaEngine.discoverTorrents).toHaveBeenCalledWith(
      { ...input.query, providers: ['provider-a'], limit: 100 },
      { signal: expect.any(AbortSignal) },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing, ambiguous, external, and hashless observations', async () => {
    await expect(
      new ServerTorrentSourceResolver(engineWith(), config).resolve(
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/missing, ambiguous, or expired/u);

    const duplicate = candidate();
    await expect(
      new ServerTorrentSourceResolver(
        engineWith(duplicate, { ...duplicate }),
        config,
      ).resolve(input, new AbortController().signal),
    ).rejects.toThrow(/ambiguous/u);

    await expect(
      new ServerTorrentSourceResolver(
        engineWith(
          candidate({
            handoff: { kind: 'external', uri: 'https://example.com' },
          }),
        ),
        config,
      ).resolve(input, new AbortController().signal),
    ).rejects.toThrow(/supported server-owned handoff/u);

    await expect(
      new ServerTorrentSourceResolver(
        engineWith(candidate({ infoHash: undefined })),
        config,
      ).resolve(input, new AbortController().signal),
    ).rejects.toThrow(/expected info hash/u);
  });

  it('downloads a bounded public torrent file without forwarding browser data', async () => {
    const torrentCandidate = candidate({
      handoff: {
        kind: 'torrent_file',
        uri: 'https://downloads.example/file.torrent',
      },
    });
    const fetch = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      }),
    );
    const resolver = new ServerTorrentSourceResolver(
      engineWith(torrentCandidate),
      config,
      fetch,
    );

    const result = await resolver.resolve(input, new AbortController().signal);
    expect(result.source).toEqual({
      kind: 'torrent_file',
      bytes: new Uint8Array([1, 2, 3]),
      expectedHash: HASH,
      title: torrentCandidate.title,
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://downloads.example/file.torrent'),
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it.each([
    'http://127.0.0.1/file.torrent',
    'http://10.0.0.1/file.torrent',
    'http://[::1]/file.torrent',
    'file:///tmp/file.torrent',
    'https://user:secret@example.com/file.torrent',
  ])('rejects unsafe torrent-file target %s', async (uri) => {
    const fetch = jest.fn();
    const resolver = new ServerTorrentSourceResolver(
      engineWith(candidate({ handoff: { kind: 'torrent_file', uri } })),
      config,
      fetch,
    );
    await expect(
      resolver.resolve(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(TorrentSourceResolutionError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized and unsuccessful torrent-file responses', async () => {
    const source = candidate({
      handoff: {
        kind: 'torrent_file',
        uri: 'https://example.com/file.torrent',
      },
    });
    const oversized = new ServerTorrentSourceResolver(
      engineWith(source),
      config,
      jest
        .fn()
        .mockResolvedValue(new Response(new Uint8Array(9), { status: 200 })),
    );
    await expect(
      oversized.resolve(input, new AbortController().signal),
    ).rejects.toThrow(/size limit/u);

    const unavailable = new ServerTorrentSourceResolver(
      engineWith(source),
      config,
      jest.fn().mockResolvedValue(new Response('no', { status: 503 })),
    );
    await expect(
      unavailable.resolve(input, new AbortController().signal),
    ).rejects.toMatchObject({ transient: true });
  });

  it('preserves caller cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const mediaEngine = {
      discoverTorrents: jest.fn((_query, options) => {
        return new Promise<TorrentDiscoveryResponse>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(reason));
        });
      }),
    } as Pick<MediaEngine, 'discoverTorrents'>;
    const resolver = new ServerTorrentSourceResolver(mediaEngine, config);
    const pending = resolver.resolve(input, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

function candidate(
  overrides: Partial<TorrentCandidate> = {},
): TorrentCandidate {
  return {
    id: input.observation.id,
    provider: input.observation.provider,
    title: 'Example unusual release',
    infoHash: HASH,
    handoff: { kind: 'magnet', uri: `magnet:?xt=urn:btih:${HASH}` },
    availability: 'available',
    ...overrides,
  };
}

function engineWith(...candidates: TorrentCandidate[]) {
  const response: TorrentDiscoveryResponse = {
    query: input.query,
    candidates,
    sourceProviders: [],
    checkedAt: '2026-07-29T00:00:00.000Z',
  };
  return {
    discoverTorrents: jest.fn().mockResolvedValue(response),
  } as jest.Mocked<Pick<MediaEngine, 'discoverTorrents'>>;
}
