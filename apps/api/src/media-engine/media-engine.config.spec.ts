import {
  DEFAULT_MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS,
  DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS,
  createConfiguredProviders,
  createConfiguredStreamingProviders,
  createMediaEngine,
  readEnrichmentProviderTimeoutMs,
  readProviderTimeoutMs,
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

  it('creates no-token streaming providers by default', async () => {
    const providers = await createConfiguredStreamingProviders({});

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd-streaming',
    ]);
    expect(providers[0]?.kind).toBe('streaming');
  });

  it('uses a finite provider timeout by default', () => {
    expect(readProviderTimeoutMs({})).toBe(
      DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS,
    );
  });

  it('allows provider timeout override from environment', () => {
    expect(
      readProviderTimeoutMs({
        MEDIA_ENGINE_PROVIDER_TIMEOUT_MS: ' 2500 ',
      }),
    ).toBe(2500);
  });

  it('rejects invalid provider timeout override values', () => {
    expect(() =>
      readProviderTimeoutMs({
        MEDIA_ENGINE_PROVIDER_TIMEOUT_MS: '0',
      }),
    ).toThrow(/positive integer/);
  });

  it('uses a shorter enrichment provider timeout by default', () => {
    expect(readEnrichmentProviderTimeoutMs({})).toBe(
      DEFAULT_MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS,
    );
  });

  it('allows enrichment provider timeout override from environment', () => {
    expect(
      readEnrichmentProviderTimeoutMs({
        MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS: ' 1800 ',
      }),
    ).toBe(1800);
  });

  it('rejects invalid enrichment provider timeout override values', () => {
    expect(() =>
      readEnrichmentProviderTimeoutMs({
        MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS: 'not-a-number',
      }),
    ).toThrow(/positive integer/);
  });
});
