import {
  createConfiguredProviders,
  createMediaEngine,
} from './media-engine.config';

describe('MediaEngine configuration', () => {
  it('creates an engine with the no-secret providers by default', async () => {
    const engine = await createMediaEngine({});

    expect(engine.getProviders().map((provider) => provider.name)).toEqual([
      'shikimori',
    ]);
  });

  it('adds TMDB when a read access token is configured', async () => {
    const providers = await createConfiguredProviders({
      TMDB_API_READ_ACCESS_TOKEN: ' tmdb-token ',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'shikimori',
      'tmdb',
    ]);
  });

  it('falls back to TMDB_API_KEY for local compatibility', async () => {
    const providers = await createConfiguredProviders({
      TMDB_API_KEY: 'tmdb-token',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'shikimori',
      'tmdb',
    ]);
  });
});
