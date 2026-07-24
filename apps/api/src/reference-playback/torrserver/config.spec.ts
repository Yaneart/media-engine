import {
  DEFAULT_TORRSERVER_CONNECT_TIMEOUT_MS,
  DEFAULT_TORRSERVER_MAX_CONCURRENCY,
  DEFAULT_TORRSERVER_MAX_FILES,
  DEFAULT_TORRSERVER_MAX_FILE_SIZE_BYTES,
  DEFAULT_TORRSERVER_MAX_PATH_LENGTH,
  DEFAULT_TORRSERVER_MAX_RESPONSE_BYTES,
  DEFAULT_TORRSERVER_METADATA_POLL_INTERVAL_MS,
  DEFAULT_TORRSERVER_METADATA_TIMEOUT_MS,
  DEFAULT_TORRSERVER_REQUEST_TIMEOUT_MS,
  readTorrServerClientConfig,
} from './config';

describe('TorServer client configuration', () => {
  it('stays disabled when no operator-owned URL is configured', () => {
    expect(readTorrServerClientConfig({})).toBeUndefined();
  });

  it('uses bounded defaults and normalizes an exact base path', () => {
    const config = readTorrServerClientConfig({
      MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090/reference',
    });

    expect(config).toEqual({
      baseUrl: new URL('http://torrserver:8090/reference/'),
      connectTimeoutMs: DEFAULT_TORRSERVER_CONNECT_TIMEOUT_MS,
      requestTimeoutMs: DEFAULT_TORRSERVER_REQUEST_TIMEOUT_MS,
      metadataTimeoutMs: DEFAULT_TORRSERVER_METADATA_TIMEOUT_MS,
      metadataPollIntervalMs: DEFAULT_TORRSERVER_METADATA_POLL_INTERVAL_MS,
      maxConcurrency: DEFAULT_TORRSERVER_MAX_CONCURRENCY,
      maxResponseBytes: DEFAULT_TORRSERVER_MAX_RESPONSE_BYTES,
      maxFiles: DEFAULT_TORRSERVER_MAX_FILES,
      maxPathLength: DEFAULT_TORRSERVER_MAX_PATH_LENGTH,
      maxFileSizeBytes: DEFAULT_TORRSERVER_MAX_FILE_SIZE_BYTES,
    });
  });

  it('accepts exact credentials, timeouts, concurrency, and resource limits', () => {
    expect(
      readTorrServerClientConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'https://torrent.internal/base/',
        MEDIA_ENGINE_TORRSERVER_USERNAME: 'operator',
        MEDIA_ENGINE_TORRSERVER_PASSWORD: 'secret',
        MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS: '1000',
        MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS: '5000',
        MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '20000',
        MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS: '100',
        MEDIA_ENGINE_TORRSERVER_MAX_CONCURRENCY: '2',
        MEDIA_ENGINE_TORRSERVER_MAX_RESPONSE_BYTES: '4096',
        MEDIA_ENGINE_TORRSERVER_MAX_FILES: '25',
        MEDIA_ENGINE_TORRSERVER_MAX_PATH_LENGTH: '512',
        MEDIA_ENGINE_TORRSERVER_MAX_FILE_SIZE_BYTES: '1000000000',
      }),
    ).toEqual({
      baseUrl: new URL('https://torrent.internal/base/'),
      username: 'operator',
      password: 'secret',
      connectTimeoutMs: 1_000,
      requestTimeoutMs: 5_000,
      metadataTimeoutMs: 20_000,
      metadataPollIntervalMs: 100,
      maxConcurrency: 2,
      maxResponseBytes: 4_096,
      maxFiles: 25,
      maxPathLength: 512,
      maxFileSizeBytes: 1_000_000_000,
    });
  });

  it.each([
    { MEDIA_ENGINE_TORRSERVER_URL: 'ftp://torrent.internal' },
    { MEDIA_ENGINE_TORRSERVER_URL: 'http://user@torrent.internal' },
    { MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal/?target=other' },
    { MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal/#fragment' },
    { MEDIA_ENGINE_TORRSERVER_URL: 'not a URL' },
  ])('rejects an unsafe base URL: %j', (env) => {
    expect(() => readTorrServerClientConfig(env)).toThrow(
      'MEDIA_ENGINE_TORRSERVER_URL',
    );
  });

  it('rejects an excessively long base URL', () => {
    expect(() =>
      readTorrServerClientConfig({
        MEDIA_ENGINE_TORRSERVER_URL: `http://torrent.internal/${'a'.repeat(2_048)}`,
      }),
    ).toThrow('too long');
  });

  it.each([
    {
      MEDIA_ENGINE_TORRSERVER_USERNAME: 'operator',
      MEDIA_ENGINE_TORRSERVER_PASSWORD: 'secret',
    },
    {
      MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal',
      MEDIA_ENGINE_TORRSERVER_USERNAME: 'operator',
    },
    {
      MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal',
      MEDIA_ENGINE_TORRSERVER_PASSWORD: 'secret',
    },
    {
      MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal',
      MEDIA_ENGINE_TORRSERVER_USERNAME: 'bad\nname',
      MEDIA_ENGINE_TORRSERVER_PASSWORD: 'secret',
    },
  ])('rejects incomplete or unsafe credentials: %j', (env) => {
    expect(() => readTorrServerClientConfig(env)).toThrow(
      'MEDIA_ENGINE_TORRSERVER',
    );
  });

  it.each([
    ['MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS', '0'],
    ['MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS', '1.5'],
    ['MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS', '300001'],
    ['MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS', '-1'],
    ['MEDIA_ENGINE_TORRSERVER_MAX_CONCURRENCY', '33'],
    ['MEDIA_ENGINE_TORRSERVER_MAX_RESPONSE_BYTES', '255'],
    ['MEDIA_ENGINE_TORRSERVER_MAX_FILES', '10001'],
    ['MEDIA_ENGINE_TORRSERVER_MAX_PATH_LENGTH', '15'],
    ['MEDIA_ENGINE_TORRSERVER_MAX_FILE_SIZE_BYTES', 'NaN'],
  ])('rejects invalid integer %s=%s', (name, value) => {
    expect(() =>
      readTorrServerClientConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal',
        [name]: value,
      }),
    ).toThrow(name);
  });

  it.each([
    {
      MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS: '20',
      MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS: '10',
    },
    {
      MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS: '30',
      MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '20',
    },
    {
      MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '20',
      MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS: '20',
    },
  ])('rejects inconsistent timeout budgets: %j', (overrides) => {
    expect(() =>
      readTorrServerClientConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrent.internal',
        ...overrides,
      }),
    ).toThrow('MEDIA_ENGINE_TORRSERVER');
  });
});
