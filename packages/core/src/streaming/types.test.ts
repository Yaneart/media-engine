import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaAvailability, StreamingProvider } from "./types.js";

test("streaming provider contract supports multiple player options for one episode", async () => {
  const provider: StreamingProvider = {
    name: "mock-streaming",
    kind: "streaming",
    capabilities: {
      mediaTypes: ["anime"],
      lookup: {
        byTitle: false,
        byExternalIds: ["shikimori"],
        byEpisode: true,
      },
      features: ["embed", "translations", "subtitles", "qualities", "episode_mapping"],
    },
    async getAvailability(query) {
      const availability: MediaAvailability = {
        query,
        item: {
          type: "anime",
          title: "Example Anime",
          ids: query.ids,
        },
        episodes: [
          {
            absoluteEpisodeNumber: query.absoluteEpisodeNumber,
            options: [
              {
                id: "mock-streaming:episode-1:dub:720p",
                provider: "mock-streaming",
                player: {
                  kind: "embed",
                  label: "Mock Player",
                },
                translation: {
                  title: "AniDUB",
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
                  url: "https://example.test/embed/episode-1",
                },
                availability: "available",
              },
              {
                id: "mock-streaming:episode-1:sub:1080p",
                provider: "mock-streaming",
                player: {
                  kind: "embed",
                  label: "Mock Player",
                },
                translation: {
                  title: "Subtitles",
                  type: "subtitles",
                  language: "ru",
                },
                quality: {
                  label: "1080p",
                  height: 1080,
                },
                subtitles: [
                  {
                    language: "ru",
                    format: "vtt",
                    url: "https://example.test/subtitles/episode-1.vtt",
                  },
                ],
                episode: {
                  absoluteEpisodeNumber: query.absoluteEpisodeNumber,
                },
                access: {
                  url: "https://example.test/embed/episode-1-sub",
                },
                availability: "available",
              },
            ],
          },
        ],
        options: [],
        sourceProviders: [
          {
            provider: "mock-streaming",
            ids: query.ids,
          },
        ],
        checkedAt: "2026-07-03T00:00:00.000Z",
      };

      return availability;
    },
  };

  const availability = await provider.getAvailability(
    {
      type: "anime",
      ids: {
        shikimori: "20",
      },
      absoluteEpisodeNumber: 1,
    },
    {},
  );

  assert.equal(availability?.episodes?.[0]?.options.length, 2);
  assert.deepEqual(
    availability?.episodes?.[0]?.options.map((option) => option.translation?.type),
    ["dub", "subtitles"],
  );
});
