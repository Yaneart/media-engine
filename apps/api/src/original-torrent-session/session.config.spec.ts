import {
  DEFAULT_TORRENT_SESSION_CLEANUP_INTERVAL_MS,
  DEFAULT_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS,
  DEFAULT_TORRENT_SESSION_TERMINAL_RETENTION_MS,
  DEFAULT_TORRENT_SESSION_TTL_MS,
  DEFAULT_TORRENT_SOURCE_REQUEST_TIMEOUT_MS,
  DEFAULT_TORRENT_STREAM_MAX_CONCURRENT,
  readOriginalTorrentSessionConfig,
} from './session.config';

describe('original torrent session config', () => {
  it('uses bounded lifecycle and source defaults', () => {
    expect(readOriginalTorrentSessionConfig(4_194_304, {})).toEqual({
      sessionTtlMs: DEFAULT_TORRENT_SESSION_TTL_MS,
      terminalRetentionMs: DEFAULT_TORRENT_SESSION_TERMINAL_RETENTION_MS,
      cleanupIntervalMs: DEFAULT_TORRENT_SESSION_CLEANUP_INTERVAL_MS,
      sourceRequestTimeoutMs: DEFAULT_TORRENT_SOURCE_REQUEST_TIMEOUT_MS,
      maxConcurrentCreations: DEFAULT_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS,
      maxConcurrentStreams: DEFAULT_TORRENT_STREAM_MAX_CONCURRENT,
      maxTorrentBytes: 4_194_304,
    });
  });

  it('parses exact integer overrides', () => {
    expect(
      readOriginalTorrentSessionConfig(8_192, {
        MEDIA_ENGINE_TORRENT_SESSION_TTL_MS: '60000',
        MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS: '0',
        MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS: '500',
        MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS: '2500',
        MEDIA_ENGINE_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS: '7',
        MEDIA_ENGINE_TORRENT_STREAM_MAX_CONCURRENT: '12',
      }),
    ).toEqual({
      sessionTtlMs: 60_000,
      terminalRetentionMs: 0,
      cleanupIntervalMs: 500,
      sourceRequestTimeoutMs: 2_500,
      maxConcurrentCreations: 7,
      maxConcurrentStreams: 12,
      maxTorrentBytes: 8_192,
    });
  });

  it.each([
    ['MEDIA_ENGINE_TORRENT_SESSION_TTL_MS', '999'],
    ['MEDIA_ENGINE_TORRENT_SESSION_TTL_MS', '86400001'],
    ['MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS', '-1'],
    ['MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS', '99'],
    ['MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS', '1.5'],
    ['MEDIA_ENGINE_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS', '0'],
    ['MEDIA_ENGINE_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS', '65'],
    ['MEDIA_ENGINE_TORRENT_STREAM_MAX_CONCURRENT', '0'],
    ['MEDIA_ENGINE_TORRENT_STREAM_MAX_CONCURRENT', '257'],
  ])('rejects invalid %s=%s', (name, value) => {
    expect(() =>
      readOriginalTorrentSessionConfig(4_194_304, { [name]: value }),
    ).toThrow();
  });

  it('rejects an invalid runtime byte bound', () => {
    expect(() => readOriginalTorrentSessionConfig(1, {})).toThrow(
      /maxTorrentBytes/u,
    );
  });
});
