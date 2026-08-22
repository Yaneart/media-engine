import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import {
  createFilmixSourceUrl,
  parseFilmixPost,
  parseFilmixSearchResponse,
  resolveFilmixQualityLink,
} from "./client.js";

const LIMITS = { seasonLimit: 10, translationLimit: 10, episodeLimit: 10 };

test("parseFilmixSearchResponse parses bounded movie and series identities", () => {
  const posts = parseFilmixSearchResponse(
    "filmix-streaming",
    [
      {
        id: 10,
        title: "Movie",
        original_title: "Original Movie",
        year: 2024,
        section: 0,
        alt_name: "movie-2024",
      },
      {
        id: 20,
        title: "Series",
        original_title: null,
        year: 2023,
        section: 7,
        alt_name: "series-2023",
      },
    ],
    1,
  );

  assert.deepEqual(posts, [
    {
      id: 10,
      title: "Movie",
      originalTitle: "Original Movie",
      year: 2024,
      section: 0,
      altName: "movie-2024",
      type: "movie",
    },
  ]);
});

test("parseFilmixPost supports movie quality lists and both episode shapes", () => {
  const movie = parseFilmixPost(
    "filmix-streaming",
    {
      id: 10,
      title: "Movie",
      original_title: "Original Movie",
      year: 2024,
      section: 0,
      player_links: {
        movie: [
          {
            translation: "Dub",
            link: "https://cdn.test/movie_[1080,720,480].mp4",
          },
        ],
        playlist: [],
      },
    },
    LIMITS,
  );
  assert.deepEqual(movie.movies[0]?.qualities, [1080, 720, 480]);

  const series = parseFilmixPost(
    "filmix-streaming",
    {
      id: 20,
      title: "Series",
      original_title: "Series",
      year: 2023,
      section: 7,
      player_links: {
        playlist: {
          "1": {
            Dub: [{ link: "https://cdn.test/s01e01_%s.mp4", qualities: [720, 480] }],
            Original: {
              "2": { link: "https://cdn.test/s01e02_%s.mp4", qualities: [480] },
            },
          },
        },
      },
    },
    LIMITS,
  );
  assert.deepEqual(
    series.seasons[0]?.translations.map((translation) => [
      translation.name,
      translation.episodes[0]?.number,
    ]),
    [
      ["Dub", 1],
      ["Original", 2],
    ],
  );
});

test("Filmix parser rejects complete schema drift", () => {
  for (const parse of [
    () => parseFilmixSearchResponse("filmix-streaming", { data: [] }, 10),
    () =>
      parseFilmixSearchResponse(
        "filmix-streaming",
        [{ id: "wrong", title: "Movie", year: 2024, section: 0 }],
        10,
      ),
    () =>
      parseFilmixPost(
        "filmix-streaming",
        {
          id: 20,
          title: "Series",
          year: 2023,
          section: 7,
          player_links: { playlist: ["unexpected"] },
        },
        LIMITS,
      ),
  ]) {
    assert.throws(parse, (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      assert.equal(error.retryable, false);
      return true;
    });
  }
});

test("Filmix quality and source URL helpers accept only known safe forms", () => {
  assert.equal(
    resolveFilmixQualityLink("https://cdn.test/movie_[1080,720,480].mp4", 480),
    "https://cdn.test/movie_480.mp4",
  );
  assert.equal(
    resolveFilmixQualityLink("https://cdn.test/s01e01_%s.mp4?token=x", 480),
    "https://cdn.test/s01e01_480.mp4?token=x",
  );
  assert.equal(resolveFilmixQualityLink("https://cdn.test/already.mp4", 480), undefined);
  assert.equal(
    createFilmixSourceUrl(
      { siteBaseUrl: "https://filmix.test" },
      {
        id: 20,
        title: "Series",
        year: 2023,
        section: 7,
        altName: "series-2023",
        type: "series",
      },
    ),
    "https://filmix.test/seria/20-series-2023.html",
  );
});
