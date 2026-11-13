import { createConfiguredKeyedEmbedProviders } from './keyed-embed.config';
import { createConfiguredStreamingProviders } from './media-engine.config';

describe('Direct keyed embed configuration', () => {
  it('enables each provider only with its own server credential', async () => {
    expect(await createConfiguredKeyedEmbedProviders({})).toEqual([]);
    const retired = {
      VIBIX_API_KEY: 'unused',
      VIDEOSEED_API_KEY: 'unused',
      HDVB_API_KEY: 'unused',
    };
    const providers = await createConfiguredKeyedEmbedProviders({
      ...retired,
      COLLAPS_API_KEY: 'private-collaps',
      ALOHA_API_KEY: 'private-alloha',
      MIRAGE_API_KEY: 'private-mirage',
    });
    expect(providers.map((p) => p.name)).toEqual([
      'collaps-streaming',
      'alloha-streaming',
      'mirage-streaming',
    ]);
    expect(JSON.stringify(providers)).not.toContain('private-');
  });
  it('requires explicit shared-token opt-in and rejects misspelled boolean values', async () => {
    await expect(
      createConfiguredKeyedEmbedProviders({
        ALOHA_API_KEY: 'private-alloha',
        MEDIA_ENGINE_ALOHA_STREAMING_ALLOW_API_KEY_IN_EMBED_URL: 'yes',
      }),
    ).rejects.toThrow('must be either true or false');
    const providers = await createConfiguredKeyedEmbedProviders({
      ALOHA_API_KEY: 'private-alloha',
      ALOHA_PLAYER_TOKEN: 'public-player',
      MEDIA_ENGINE_ALOHA_STREAMING_ALLOW_API_KEY_IN_EMBED_URL: 'false',
    });
    expect(providers).toHaveLength(1);
    expect(JSON.stringify(providers)).not.toContain('public-player');
  });
  it('never registers retired providers, including with stale environment flags', async () => {
    const providers = await createConfiguredStreamingProviders({
      COLLAPS_API_KEY: 'private-collaps',
      ...{ MEDIA_ENGINE_DDBB_STREAMING_ENABLED: 'true' },
    });
    expect(providers.some((p) => p.name === 'collaps-streaming')).toBe(true);
    expect(providers.some((p) => p.name === 'ddbb-streaming')).toBe(false);
    expect(
      (await createConfiguredStreamingProviders({})).some(
        (p) => p.name === 'ddbb-streaming',
      ),
    ).toBe(false);
  });
});
