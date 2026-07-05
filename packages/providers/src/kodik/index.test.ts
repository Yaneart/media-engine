import assert from "node:assert/strict";
import { test } from "node:test";

import { kodikProvider } from "./index.js";

test("kodikProvider exposes safe streaming capabilities", () => {
  const provider = kodikProvider({
    token: "secret-token",
    fetch: async () => Response.json({ results: [] }),
  });

  assert.equal(provider.name, "kodik");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series", "anime"]);
  assert.deepEqual(provider.capabilities.lookup.byExternalIds, ["imdb", "kinopoisk", "shikimori"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
  assert.equal("token" in provider, false);
});

test("kodikProvider searches by Shikimori ID and maps anime episode embeds", async () => {
  let requestedUrl: URL | undefined;
  const provider = kodikProvider({
    token: "secret-token",
    baseUrl: "https://kodik.example",
    fetch: async (input) => {
      requestedUrl = input instanceof URL ? input : new URL(input);

      return Response.json({
        results: [
          {
            id: "kodik-item-1",
            type: "anime-serial",
            title: "Naruto",
            title_orig: "Naruto",
            year: 2002,
            shikimori_id: 20,
            quality: "720p",
            translation: {
              id: 609,
              title: "AniDUB",
              type: "voice",
            },
            seasons: {
              "1": {
                episodes: {
                  "1": "//kodik.example/seria/episode-1",
                  "2": {
                    link: "//kodik.example/seria/episode-2",
                    title: "Episode 2",
                  },
                },
              },
            },
          },
        ],
      });
    },
  });

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

  assert.equal(requestedUrl?.pathname, "/search");
  assert.equal(requestedUrl?.searchParams.get("token"), "secret-token");
  assert.equal(requestedUrl?.searchParams.get("shikimori_id"), "20");
  assert.equal(requestedUrl?.searchParams.get("types"), "anime,anime-serial");
  assert.equal(availability?.item?.title, "Naruto");
  assert.deepEqual(availability?.item?.ids, { shikimori: "20" });
  assert.equal(availability?.episodes?.length, 1);
  assert.equal(availability?.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.provider, "kodik");
  assert.equal(availability?.options[0]?.player.kind, "embed");
  assert.equal(availability?.options[0]?.access.url, "https://kodik.example/seria/episode-1");
  assert.equal(availability?.options[0]?.translation?.title, "AniDUB");
  assert.equal(availability?.options[0]?.translation?.type, "voiceover");
  assert.equal(availability?.options[0]?.quality?.height, 720);
});

test("kodikProvider maps direct movie links into top-level options", async () => {
  const provider = kodikProvider({
    token: "secret-token",
    fetch: async () =>
      Response.json({
        results: [
          {
            id: "movie-1",
            type: "foreign-movie",
            title: "Interstellar",
            title_orig: "Interstellar",
            year: "2014",
            imdb_id: "tt0816692",
            kinopoisk_id: 258687,
            link: "//kodik.example/video/movie-1",
            quality: "1080p",
            translation: {
              title: "Dub",
              type: "voice",
            },
          },
        ],
      }),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      ids: {
        imdb: "tt0816692",
      },
    },
    {},
  );

  assert.equal(availability?.episodes, undefined);
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.access.url, "https://kodik.example/video/movie-1");
  assert.deepEqual(availability?.sourceProviders[0]?.ids, {
    imdb: "tt0816692",
    kinopoisk: "258687",
  });
});

test("kodikProvider respects provider restrictions", async () => {
  const provider = kodikProvider({
    token: "secret-token",
    fetch: async () => Response.json({ results: [] }),
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      title: "Naruto",
      providers: ["other-streaming"],
    },
    {},
  );

  assert.equal(availability, null);
});

test("kodikProvider rejects empty tokens", () => {
  assert.throws(
    () =>
      kodikProvider({
        token: " ",
      }),
    /token is required/,
  );
});
