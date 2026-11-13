import { createConfiguredKeyedEmbedProviders } from './keyed-embed.config';
import { createConfiguredStreamingProviders } from './media-engine.config';

describe('Direct keyed embed configuration', () => {
  it('enables each provider only with its own server credential', async () => {
    expect(await createConfiguredKeyedEmbedProviders({})).toEqual([]);
    const providers = await createConfiguredKeyedEmbedProviders({
      VIBIX_API_KEY: 'private-vibix',
      COLLAPS_API_KEY: 'private-collaps',
      ALOHA_API_KEY: 'private-alloha',
      VIDEOSEED_API_KEY: 'private-videoseed',
      MIRAGE_API_KEY: 'private-mirage',
      HDVB_API_KEY: 'private-hdvb',
    });
    expect(providers.map((p) => p.name)).toEqual([
      'vibix-streaming',
      'collaps-streaming',
      'alloha-streaming',
      'videoseed-streaming',
      'mirage-streaming',
      'hdvb-streaming',
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
  it('can remove DDBB independently of direct providers while preserving defaults', async () => {
    const providers = await createConfiguredStreamingProviders({
      COLLAPS_API_KEY: 'private-collaps',
      MEDIA_ENGINE_DDBB_STREAMING_ENABLED: 'false',
    });
    expect(providers.some((p) => p.name === 'collaps-streaming')).toBe(true);
    expect(providers.some((p) => p.name === 'ddbb-streaming')).toBe(false);
    expect(
      (await createConfiguredStreamingProviders({})).some(
        (p) => p.name === 'ddbb-streaming',
      ),
    ).toBe(true);
  });
});
