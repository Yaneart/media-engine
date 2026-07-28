import {
  DEFAULT_MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS,
  createConfiguredTorrentProviders,
  createMediaEngine,
  readTorrentProviderNames,
  readTorrentProviderTimeoutMs,
} from './media-engine.config';

describe('torrent discovery configuration', () => {
  it('keeps repository torrent providers opt-in', async () => {
    expect(readTorrentProviderNames({})).toEqual([]);
    expect(await createConfiguredTorrentProviders({})).toEqual([]);
    expect((await createMediaEngine({})).getTorrentProviders()).toEqual([]);
  });

  it('constructs selected providers in explicit environment order', async () => {
    const providers = await createConfiguredTorrentProviders({
      MEDIA_ENGINE_TORRENT_PROVIDERS:
        ' magnetz-torrent, yts-torrent, jacred-torrent, bitsearch-torrent ',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'magnetz-torrent',
      'yts-torrent',
      'jacred-torrent',
      'bitsearch-torrent',
    ]);
    expect(providers.every((provider) => provider.kind === 'torrent')).toBe(
      true,
    );
  });

  it.each([
    ['yts-torrent,', /without empty names/],
    ['unknown-torrent', /unsupported providers: unknown-torrent/],
    ['yts-torrent,yts-torrent', /duplicate names/],
  ])('rejects invalid provider selection %s', (value, message) => {
    expect(() =>
      readTorrentProviderNames({ MEDIA_ENGINE_TORRENT_PROVIDERS: value }),
    ).toThrow(message);
  });

  it('uses a finite bounded provider timeout', () => {
    expect(readTorrentProviderTimeoutMs({})).toBe(
      DEFAULT_MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS,
    );
    expect(
      readTorrentProviderTimeoutMs({
        MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS: ' 25000 ',
      }),
    ).toBe(25_000);
    expect(() =>
      readTorrentProviderTimeoutMs({
        MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS: '0',
      }),
    ).toThrow(/positive base-10 integer/);
    expect(() =>
      readTorrentProviderTimeoutMs({
        MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS: '120001',
      }),
    ).toThrow(/at most 120000/);
  });
});
