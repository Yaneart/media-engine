import { readOriginalTorrentRuntimeConfig } from './runtime.config';

describe('original torrent runtime configuration', () => {
  it('is disabled when no internal TorrServer origin is configured', () => {
    expect(readOriginalTorrentRuntimeConfig({})).toBeUndefined();
    expect(
      readOriginalTorrentRuntimeConfig({ MEDIA_ENGINE_TORRSERVER_URL: '  ' }),
    ).toBeUndefined();
  });

  it('parses bounded defaults for the pinned runtime contract', () => {
    const config = readOriginalTorrentRuntimeConfig({
      MEDIA_ENGINE_TORRSERVER_URL: ' http://torrserver:8090 ',
    });

    expect(config).toMatchObject({
      expectedVersion: 'MatriX.141',
      ownerId: 'media-engine-default',
      controlConnectTimeoutMs: 3_000,
      controlRequestTimeoutMs: 10_000,
      metadataTimeoutMs: 60_000,
      metadataPollIntervalMs: 250,
      coldStreamHeaderTimeoutMs: 45_000,
      coldStreamInactivityTimeoutMs: 30_000,
      maxTorrentBytes: 4 * 1024 * 1024,
      maxConcurrency: 4,
      maxQueueSize: 32,
      maxControlRetries: 1,
    });
    expect(config?.baseUrl.href).toBe('http://torrserver:8090/');
  });

  it('accepts exact bounded operational overrides', () => {
    const config = readOriginalTorrentRuntimeConfig({
      MEDIA_ENGINE_TORRSERVER_URL: 'https://runtime.example',
      MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION: 'MatriX.142',
      MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS: '500',
      MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS: '1000',
      MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '2000',
      MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS: '100',
      MEDIA_ENGINE_TORRSERVER_COLD_STREAM_HEADER_TIMEOUT_MS: '3000',
      MEDIA_ENGINE_TORRSERVER_COLD_STREAM_INACTIVITY_TIMEOUT_MS: '4000',
      MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES: '2048',
      MEDIA_ENGINE_TORRSERVER_OWNER_ID: 'deployment_owner-01',
    });

    expect(config).toMatchObject({
      expectedVersion: 'MatriX.142',
      ownerId: 'deployment_owner-01',
      controlConnectTimeoutMs: 500,
      controlRequestTimeoutMs: 1_000,
      metadataTimeoutMs: 2_000,
      metadataPollIntervalMs: 100,
      coldStreamHeaderTimeoutMs: 3_000,
      coldStreamInactivityTimeoutMs: 4_000,
      maxTorrentBytes: 2_048,
    });
  });

  it.each([
    ['ftp://torrserver:8090', /credential-free HTTP\(S\) origin/],
    ['http://user:pass@torrserver:8090', /credential-free/],
    ['http://torrserver:8090/api', /credential-free/],
    ['http://torrserver:8090?debug=1', /credential-free/],
    ['not a url', /valid URL/],
  ])('rejects unsafe runtime URL %s', (url, message) => {
    expect(() =>
      readOriginalTorrentRuntimeConfig({ MEDIA_ENGINE_TORRSERVER_URL: url }),
    ).toThrow(message);
  });

  it('rejects incompatible timeout relationships and malformed values', () => {
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS: '2000',
        MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS: '1000',
      }),
    ).toThrow(/must not exceed the control request timeout/);
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS: '500',
        MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS: '2000',
        MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '1000',
      }),
    ).toThrow(/must not exceed the metadata timeout/);
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_CONTROL_CONNECT_TIMEOUT_MS: '100',
        MEDIA_ENGINE_TORRSERVER_CONTROL_REQUEST_TIMEOUT_MS: '500',
        MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS: '1000',
        MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS: '1000',
      }),
    ).toThrow(/must be smaller/);
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES: '1e6',
      }),
    ).toThrow(/exact base-10 integer/);
  });

  it('rejects unexpected version syntax and oversized values', () => {
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION: 'latest',
      }),
    ).toThrow(/exact MatriX version/);
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_MAX_TORRENT_BYTES: String(17 * 1024 * 1024),
      }),
    ).toThrow(/between 1024 and 16777216/);
    expect(() =>
      readOriginalTorrentRuntimeConfig({
        MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
        MEDIA_ENGINE_TORRSERVER_OWNER_ID: 'bad owner',
      }),
    ).toThrow(/OWNER_ID/u);
  });
});
