import type {
  MediaProvider,
  ProviderDetailsResult,
  ProviderSearchResult,
} from "../providers/index.js";
import type { MediaAvailability, StreamQuery, StreamingProvider } from "../streaming/index.js";
import type {
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
  TorrentProvider,
} from "../torrent/index.js";

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

export function createTorrentProvider(
  overrides: Partial<TorrentProvider> & { secret?: string } = {},
): TorrentProvider & { secret?: string } {
  const name = overrides.name ?? "test-torrent-provider";

  return {
    name,
    kind: "torrent",
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      lookup: {
        byTitle: true,
        byExternalIds: ["imdb", "kinopoisk"],
        byEpisode: true,
      },
      features: ["magnet", "file_list", "peer_stats", "release_metadata"],
    },
    async discoverTorrents(query): Promise<TorrentDiscoveryResponse | null> {
      return createTorrentResponse(query, name);
    },
    ...overrides,
  };
}

export function createTorrentResponse(
  query: TorrentDiscoveryQuery,
  provider: string,
): TorrentDiscoveryResponse {
  return {
    query,
    item: {
      type: query.type,
      title: query.title,
      year: query.year,
      ids: query.ids,
    },
    candidates: [
      {
        id: `${provider}:release-1`,
        provider,
        title: `${query.title ?? "Movie"} 1080p`,
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        sizeBytes: 1_500_000_000,
        episode: {
          seasonNumber: query.seasonNumber,
          episodeNumber: query.episodeNumber,
          absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        },
        files: [
          {
            index: 0,
            path: "Movie.mkv",
            sizeBytes: 1_500_000_000,
            mediaType: "video",
          },
        ],
        release: {
          source: "web",
          resolution: "1080p",
          height: 1080,
          videoCodec: "H.264",
          audioLanguages: ["en"],
        },
        peers: {
          seeders: 12,
          leechers: 3,
          checkedAt: "2026-07-22T00:00:00.000Z",
        },
        handoff: {
          kind: "magnet",
          uri: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        },
        availability: "available",
        sourceUrl: `https://example.test/${provider}/release-1`,
      },
    ],
    sourceProviders: [
      {
        provider,
        ids: query.ids,
      },
    ],
    checkedAt: "2026-07-22T00:00:00.000Z",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
