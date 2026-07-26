import {
  DEFAULT_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY,
  DEFAULT_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES,
  DEFAULT_TORRENT_MEDIA_WORKER_PORT,
  DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_TIMEOUT_MS,
  DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_REMUX_TIMEOUT_MS,
  DEFAULT_TORRENT_MEDIA_WORKER_MAX_REMUX_CONCURRENCY,
  DEFAULT_TORRENT_MEDIA_WORKER_MAX_STORED_BYTES,
  DEFAULT_TORRENT_MEDIA_WORKER_OUTPUT_TTL_MS,
  DEFAULT_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS,
  readTorrentMediaWorkerClientConfig,
  readTorrentMediaWorkerServerConfig,
} from './media-worker-config';

describe('torrent media worker configuration', () => {
  it('keeps the client disabled until an exact private URL is configured', () => {
    expect(readTorrentMediaWorkerClientConfig({})).toBeUndefined();
    expect(
      readTorrentMediaWorkerClientConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
          ' http://torrent-media-worker:8080/internal ',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_TIMEOUT_MS: '15000',
      }),
    ).toEqual({
      baseUrl: new URL('http://torrent-media-worker:8080/internal/'),
      timeoutMs: 15_000,
      remuxTimeoutMs: DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_REMUX_TIMEOUT_MS,
      cleanupTimeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
  });

  it.each([
    'file:///tmp/worker',
    'http://user:secret@worker.test',
    'http://worker.test?target=elsewhere',
  ])('rejects unsafe client URL %s', (value) => {
    expect(() =>
      readTorrentMediaWorkerClientConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL: value,
      }),
    ).toThrow('MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL');
  });

  it('provides bounded worker server defaults and overrides', () => {
    expect(readTorrentMediaWorkerServerConfig({})).toEqual({
      host: '127.0.0.1',
      port: DEFAULT_TORRENT_MEDIA_WORKER_PORT,
      maxConcurrency: DEFAULT_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY,
      maxRequestBytes: DEFAULT_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES,
      requestTimeoutMs: DEFAULT_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS,
      maxRemuxConcurrency: DEFAULT_TORRENT_MEDIA_WORKER_MAX_REMUX_CONCURRENCY,
      maxStoredBytes: DEFAULT_TORRENT_MEDIA_WORKER_MAX_STORED_BYTES,
      outputTtlMs: DEFAULT_TORRENT_MEDIA_WORKER_OUTPUT_TTL_MS,
    });
    expect(
      readTorrentMediaWorkerServerConfig({
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_HOST: '0.0.0.0',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_PORT: '8091',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY: '3',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES: '2048',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_REQUEST_TIMEOUT_MS: '30000',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REMUX_CONCURRENCY: '2',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_STORED_BYTES: '1073741824',
        MEDIA_ENGINE_TORRENT_MEDIA_WORKER_OUTPUT_TTL_MS: '60000',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 8_091,
      maxConcurrency: 3,
      maxRequestBytes: 2_048,
      requestTimeoutMs: 30_000,
      maxRemuxConcurrency: 2,
      maxStoredBytes: 1_073_741_824,
      outputTtlMs: 60_000,
    });
  });

  it('uses a client budget outside the worker subprocess budget', () => {
    expect(
      readTorrentMediaWorkerClientConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
          'http://torrent-media-worker:8080',
      }),
    ).toMatchObject({
      timeoutMs: DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_TIMEOUT_MS,
      remuxTimeoutMs: DEFAULT_TORRENT_MEDIA_WORKER_CLIENT_REMUX_TIMEOUT_MS,
    });
  });

  it.each([
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_HOST', 'bad host'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_PORT', '0'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_CONCURRENCY', '17'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REQUEST_BYTES', '999'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_REMUX_CONCURRENCY', '17'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_MAX_STORED_BYTES', '1024'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_WORKER_OUTPUT_TTL_MS', '9999'],
  ] as const)('rejects invalid server value %s', (name, value) => {
    expect(() => readTorrentMediaWorkerServerConfig({ [name]: value })).toThrow(
      name,
    );
  });
});
