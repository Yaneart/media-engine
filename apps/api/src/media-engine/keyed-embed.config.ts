import type { StreamingProvider } from '@media-engine/core';

type Balancer = 'COLLAPS' | 'ALOHA' | 'MIRAGE';

export type KeyedEmbedEnv = Partial<
  Record<
    | `${Balancer}_API_KEY`
    | `${Balancer}_PLAYER_TOKEN`
    | `MEDIA_ENGINE_${Balancer}_STREAMING_BASE_URL`
    | `MEDIA_ENGINE_${Balancer}_STREAMING_ALLOW_API_KEY_IN_EMBED_URL`,
    string
  >
>;

export async function createConfiguredKeyedEmbedProviders(
  env: KeyedEmbedEnv,
): Promise<StreamingProvider[]> {
  const {
    collapsStreamingProvider,
    allohaStreamingProvider,
    mirageStreamingProvider,
  } = await import('@media-engine/providers');
  const definitions = [
    ['COLLAPS', collapsStreamingProvider],
    ['ALOHA', allohaStreamingProvider],
    ['MIRAGE', mirageStreamingProvider],
  ] as const;
  return definitions.flatMap(([key, factory]) => {
    const apiKey = env[`${key}_API_KEY`]?.trim();
    if (!apiKey) return [];
    const flag =
      `MEDIA_ENGINE_${key}_STREAMING_ALLOW_API_KEY_IN_EMBED_URL` as const;
    const allow = env[flag]?.trim();
    if (allow && !['true', 'false'].includes(allow))
      throw new Error(`${flag} must be either true or false.`);
    return [
      factory({
        apiKey,
        baseUrl:
          env[`MEDIA_ENGINE_${key}_STREAMING_BASE_URL`]?.trim() || undefined,
        playerToken: env[`${key}_PLAYER_TOKEN`]?.trim() || undefined,
        allowApiKeyInEmbedUrl: allow === 'true',
      }),
    ];
  });
}
