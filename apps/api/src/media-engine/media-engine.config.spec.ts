import {
  createConfiguredProviders,
  createConfiguredStreamingProviders,
  createMediaEngine,
} from './media-engine.config';

describe('MediaEngine configuration', () => {
  it('creates an engine with the no-secret providers by default', async () => {
    const engine = await createMediaEngine({});

    expect(engine.getProviders().map((provider) => provider.name)).toEqual([
      'kinobd',
      'cinemeta',
      'shikimori',
      'wikidata',
    ]);
    expect(
      engine.getStreamingProviders().map((provider) => provider.name),
    ).toEqual(['kinobd-streaming']);
  });

  it('adds TMDB when a read access token is configured', async () => {
    const providers = await createConfiguredProviders({
      TMDB_API_READ_ACCESS_TOKEN: ' tmdb-token ',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd',
      'cinemeta',
      'shikimori',
      'wikidata',
      'tmdb',
    ]);
  });

  it('falls back to TMDB_API_KEY for local compatibility', async () => {
    const providers = await createConfiguredProviders({
      TMDB_API_KEY: 'tmdb-token',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd',
      'cinemeta',
      'shikimori',
      'wikidata',
      'tmdb',
    ]);
  });

  it('creates no-token streaming providers by default', async () => {
    const providers = await createConfiguredStreamingProviders({});

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd-streaming',
    ]);
    expect(providers[0]?.kind).toBe('streaming');
  });

  it('adds Kodik streaming provider when a token is configured', async () => {
    const providers = await createConfiguredStreamingProviders({
      KODIK_TOKEN: ' kodik-token ',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd-streaming',
      'kodik',
    ]);
    expect(providers[0]?.kind).toBe('streaming');
    expect(providers[1]?.kind).toBe('streaming');
  });
});
