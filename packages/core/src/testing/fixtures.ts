import type { AnimeDetails, MovieDetails, SeriesDetails } from "../media/index.js";

// Deterministic movie fixture used by core tests and examples.
// Детерминированная фикстура фильма для core-тестов и примеров.
export const sampleMovie: MovieDetails = {
  id: "sample-movie-interstellar",
  type: "movie",
  title: "Interstellar",
  originalTitle: "Interstellar",
  year: 2014,
  releaseDate: "2014-11-07",
  description: "A team travels through a wormhole in space.",
  ids: {
    imdb: "tt0816692",
    tmdb: "157336",
  },
  genres: [{ name: "Science Fiction" }, { name: "Drama" }],
  ratings: [
    {
      source: "imdb",
      value: 8.7,
      max: 10,
      votes: 2_200_000,
    },
  ],
  poster: {
    url: "https://example.test/images/interstellar-poster.jpg",
    type: "poster",
    width: 1000,
    height: 1500,
  },
  runtimeMinutes: 169,
  status: "released",
};

// Deterministic series fixture used by core tests and examples.
// Детерминированная фикстура сериала для core-тестов и примеров.
export const sampleSeries: SeriesDetails = {
  id: "sample-series-breaking-bad",
  type: "series",
  title: "Breaking Bad",
  originalTitle: "Breaking Bad",
  year: 2008,
  releaseDate: "2008-01-20",
  description: "A chemistry teacher turns to crime.",
  ids: {
    imdb: "tt0903747",
    tmdb: "1396",
  },
  genres: [{ name: "Crime" }, { name: "Drama" }],
  ratings: [
    {
      source: "imdb",
      value: 9.5,
      max: 10,
      votes: 2_300_000,
    },
  ],
  seasonsCount: 5,
  episodesCount: 62,
  seasons: [
    {
      number: 1,
      title: "Season 1",
      episodesCount: 7,
    },
  ],
  status: "ended",
};

// Deterministic anime fixture used by core tests and examples.
// Детерминированная фикстура аниме для core-тестов и примеров.
export const sampleAnime: AnimeDetails = {
  id: "sample-anime-fullmetal-alchemist-brotherhood",
  type: "anime",
  title: "Fullmetal Alchemist: Brotherhood",
  originalTitle: "Hagane no Renkinjutsushi: Fullmetal Alchemist",
  year: 2009,
  airedOn: "2009-04-05",
  releasedOn: "2010-07-04",
  description: "Two brothers search for the Philosopher's Stone.",
  ids: {
    shikimori: "5114",
    myAnimeList: "5114",
  },
  genres: [{ name: "Action" }, { name: "Adventure" }],
  ratings: [
    {
      source: "myAnimeList",
      value: 9.1,
      max: 10,
      votes: 2_000_000,
    },
  ],
  animeKind: "tv",
  episodesCount: 64,
  episodes: [
    {
      episodeNumber: 1,
      title: "Fullmetal Alchemist",
    },
  ],
  status: "ended",
};
