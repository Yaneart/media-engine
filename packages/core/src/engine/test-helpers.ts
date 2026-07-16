import type {
  MediaProvider,
  ProviderDetailsResult,
  ProviderSearchResult,
} from "../providers/index.js";
import type { MediaAvailability, StreamQuery, StreamingProvider } from "../streaming/index.js";

export function createProvider(
  overrides: Partial<MediaProvider> & { apiKey?: string } = {},
): MediaProvider & { apiKey?: string } {
  return {
    name: "test-provider",
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
    },
    async search(): Promise<ProviderSearchResult[]> {
      return [];
    },
    async getDetails(): Promise<ProviderDetailsResult | null> {
      return null;
    },
    ...overrides,
  };
}

export function createStreamingProvider(
  overrides: Partial<StreamingProvider> & { secret?: string } = {},
): StreamingProvider & { secret?: string } {
  return {
    name: "test-streaming-provider",
    kind: "streaming",
    capabilities: {
      mediaTypes: ["anime"],
      lookup: {
        byTitle: true,
        byExternalIds: ["shikimori"],
        byEpisode: true,
      },
      features: ["embed", "translations", "qualities", "episode_mapping"],
    },
    async getAvailability(query): Promise<MediaAvailability | null> {
      return createAvailability(query, overrides.name ?? "test-streaming-provider");
    },
    ...overrides,
  };
}

export function createAvailability(query: StreamQuery, provider: string): MediaAvailability {
  return {
    query,
    item: {
      type: "anime",
      title: query.title ?? "Naruto",
      ids: query.ids,
    },
    episodes: [
      {
        absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        options: [
          {
            id: `${provider}:episode-1:embed`,
            provider,
            player: {
              kind: "embed",
              label: "Embedded Player",
            },
            translation: {
              title: "Russian dub",
              type: "dub",
              language: "ru",
            },
            quality: {
              label: "720p",
              height: 720,
            },
            episode: {
              absoluteEpisodeNumber: query.absoluteEpisodeNumber,
            },
            access: {
              url: `https://example.test/${provider}/episode-1`,
            },
            availability: "available",
          },
        ],
      },
    ],
    options: [
      {
        id: `${provider}:episode-1:embed`,
        provider,
        player: {
          kind: "embed",
          label: "Embedded Player",
        },
        translation: {
          title: "Russian dub",
          type: "dub",
          language: "ru",
        },
        quality: {
          label: "720p",
          height: 720,
        },
        episode: {
          absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        },
        access: {
          url: `https://example.test/${provider}/episode-1`,
        },
        availability: "available",
      },
    ],
    sourceProviders: [
      {
        provider,
        ids: query.ids,
      },
    ],
    checkedAt: "2026-07-05T00:00:00.000Z",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
