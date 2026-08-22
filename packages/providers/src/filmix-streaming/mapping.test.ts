import assert from "node:assert/strict";
import { test } from "node:test";

import type { FilmixPost } from "./client.js";
import { mapFilmixAvailability } from "./mapping.js";

const NOW = Date.parse("2026-08-22T10:00:00.000Z");

test("mapFilmixAvailability exposes only full guest 480p MP4 movie options", () => {
  const post = createMovie();
  post.movies.push({
    translation: "Preview only",
    link: "https://cdn.test/preview_[1080,720].mp4",
    qualities: [1080, 720],
  });
  post.movies.push({
    translation: "Unsafe",
    link: "http://127.0.0.1/movie_[480].mp4",
    qualities: [480],
  });

  const result = mapFilmixAvailability(
    "filmix-streaming",
    post,
    { type: "movie", title: "Movie", year: 2024 },
    "https://filmix.test/film/10-movie.html",
    NOW,
    900_000,
  );

  assert.equal(result?.options.length, 1);
  assert.deepEqual(result?.options[0], {
    id: "filmix-streaming:10:0:480",
    provider: "filmix-streaming",
    player: { kind: "mp4", label: "Filmix", providerPlayerId: "10:0" },
    translation: { title: "Dub", type: "unknown" },
    quality: { label: "480p", height: 480 },
    access: { url: "https://cdn.test/movie_480.mp4" },
    availability: "available",
    expiresAt: "2026-08-22T10:15:00.000Z",
    sourceUrl: "https://filmix.test/film/10-movie.html",
  });
  assert.equal(result?.checkedAt, "2026-08-22T10:00:00.000Z");
});

test("mapFilmixAvailability maps one exact series episode across translations", () => {
  const result = mapFilmixAvailability(
    "filmix-streaming",
    createSeries(),
    { type: "series", title: "Silo", year: 2023, seasonNumber: 3, episodeNumber: 1 },
    undefined,
    NOW,
    900_000,
  );

  assert.deepEqual(
    result?.options.map((option) => [
      option.player.kind,
      option.translation?.title,
      option.quality?.height,
      option.episode,
    ]),
    [
      ["mp4", "Dub", 480, { seasonNumber: 3, episodeNumber: 1 }],
      ["mp4", "Original", 480, { seasonNumber: 3, episodeNumber: 1 }],
    ],
  );
  assert.equal(result?.episodes?.length, 1);
  assert.equal(result?.episodes?.[0]?.options, result?.options);
});

test("mapFilmixAvailability returns null for a missing episode or unconfirmed 480p", () => {
  assert.equal(
    mapFilmixAvailability(
      "filmix-streaming",
      createSeries(),
      { type: "series", title: "Silo", year: 2023, seasonNumber: 3, episodeNumber: 99 },
      undefined,
      NOW,
      900_000,
    ),
    null,
  );

  const movie = createMovie();
  movie.movies[0]!.qualities = [720];
  assert.equal(
    mapFilmixAvailability(
      "filmix-streaming",
      movie,
      { type: "movie", title: "Movie", year: 2024 },
      undefined,
      NOW,
      900_000,
    ),
    null,
  );
});

function createMovie(): FilmixPost {
  return {
    id: 10,
    title: "Movie",
    originalTitle: "Original Movie",
    year: 2024,
    section: 0,
    type: "movie",
    movies: [
      {
        translation: "Dub",
        link: "https://cdn.test/movie_[1080,720,480].mp4",
        qualities: [1080, 720, 480],
      },
    ],
    seasons: [],
  };
}

function createSeries(): FilmixPost {
  return {
    id: 165638,
    title: "Бункер",
    originalTitle: "Silo",
    year: 2023,
    section: 7,
    type: "series",
    movies: [],
    seasons: [
      {
        number: 3,
        translations: [
          {
            name: "Dub",
            episodes: [
              {
                number: 1,
                translation: "Dub",
                link: "https://cdn.test/s03e01_%s.mp4",
                qualities: [720, 480],
              },
            ],
          },
          {
            name: "Original",
            episodes: [
              {
                number: 1,
                translation: "Original",
                link: "https://cdn.test/original/s03e01_%s.mp4",
                qualities: [480],
              },
            ],
          },
        ],
      },
    ],
  };
}
