import {
  DEFAULT_MEDIA_ENGINE_CACHE_STALE_TTL_MS,
  DEFAULT_MEDIA_ENGINE_CACHE_TTL_MS,
  DEFAULT_MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS,
  DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS,
  DEFAULT_MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS,
  createConfiguredStreamingProviders,
  createMediaEngine,
  readFlixHqStreamingProviderTimeoutMs,
  readProviderTimeoutMs,
  readStreamingProviderTimeoutMs,
} from './media-engine.config';

describe('MediaEngine configuration', () => {
  it('keeps metadata in a bounded stale window after normal cache expiry', () => {
    expect(DEFAULT_MEDIA_ENGINE_CACHE_STALE_TTL_MS).toBeGreaterThan(0);
    expect(DEFAULT_MEDIA_ENGINE_CACHE_STALE_TTL_MS).toBeGreaterThan(
      DEFAULT_MEDIA_ENGINE_CACHE_TTL_MS,
    );
  });

  it('creates an engine with the no-secret providers by default', async () => {
    const engine = await createMediaEngine({});

    expect(engine.getProviders().map((provider) => provider.name)).toEqual([
      'kinobd',
      'cinemeta',
      'shikimori',
      'anilist',
      'wikidata',
    ]);
    expect(
      engine.getStreamingProviders().map((provider) => provider.name),
    ).toEqual(['kinobd-streaming', 'flixhq-streaming']);
  });

  it('creates no-token streaming providers by default', async () => {
    const providers = await createConfiguredStreamingProviders();

    expect(providers.map((provider) => provider.name)).toEqual([
      'kinobd-streaming',
      'flixhq-streaming',
    ]);
    expect(providers[0]?.kind).toBe('streaming');
    expect(providers[1]?.kind).toBe('streaming');
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

  it('uses a larger timeout for cold streaming lookups by default', () => {
    expect(readStreamingProviderTimeoutMs({})).toBe(
      DEFAULT_MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS,
    );
    expect(readStreamingProviderTimeoutMs({})).toBeGreaterThan(
      readProviderTimeoutMs({}),
    );
  });

  it('allows streaming timeout override from environment', () => {
    expect(
      readStreamingProviderTimeoutMs({
        MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS: ' 12000 ',
      }),
    ).toBe(12000);
  });

  it('rejects invalid streaming timeout override values', () => {
    expect(() =>
      readStreamingProviderTimeoutMs({
        MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS: '-1',
      }),
    ).toThrow(/positive integer/);
  });

  it('uses a separate larger timeout for FlixHQ lookups', () => {
    expect(readFlixHqStreamingProviderTimeoutMs({})).toBe(
      DEFAULT_MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS,
    );
    expect(readFlixHqStreamingProviderTimeoutMs({})).toBeGreaterThan(
      readStreamingProviderTimeoutMs({}),
    );
  });

  it('allows and validates the FlixHQ timeout override', () => {
    expect(
      readFlixHqStreamingProviderTimeoutMs({
        MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS: ' 18000 ',
      }),
    ).toBe(18000);
    expect(() =>
      readFlixHqStreamingProviderTimeoutMs({
        MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS: '0',
      }),
    ).toThrow(/positive integer/);
  });

  it('allows a streaming request to exceed the shorter metadata timeout', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return Response.json({ data: [] });
    }) as typeof fetch;

    try {
      const engine = await createMediaEngine({
        MEDIA_ENGINE_PROVIDER_TIMEOUT_MS: '20',
        MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS: '80',
      });
      const availability = await engine.getAvailability({
        type: 'movie',
        title: 'Interstellar',
      });

      expect(availability.options).toEqual([]);
      expect(availability.meta?.providers.failed).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not cap the configured FlixHQ timeout at the shorter streaming default', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return Response.json({ data: [] });
    }) as typeof fetch;

    try {
      const engine = await createMediaEngine({
        MEDIA_ENGINE_PROVIDER_TIMEOUT_MS: '10',
        MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS: '20',
        MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS: '60',
      });
      const availability = await engine.getAvailability({
        type: 'movie',
        title: 'Interstellar',
      });

      expect(availability.meta?.providers.successful).toContain(
        'flixhq-streaming',
      );
      expect(availability.meta?.providers.failed).toEqual([
        expect.objectContaining({
          provider: 'kinobd-streaming',
          code: 'PROVIDER_TIMEOUT',
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
