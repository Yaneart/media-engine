import type { Genre } from "../media/index.js";

// Shared genre identities let a localized provider label replace an English catalog label.
const GENRE_ALIASES: Record<string, string> = {
  action: "action",
  боевик: "action",
  боевики: "action",
  adventure: "adventure",
  приключения: "adventure",
  animation: "animation",
  мультфильм: "animation",
  мультфильмы: "animation",
  comedy: "comedy",
  комедия: "comedy",
  комедии: "comedy",
  crime: "crime",
  криминал: "crime",
  documentary: "documentary",
  документальный: "documentary",
  drama: "drama",
  драма: "drama",
  драмы: "drama",
  family: "family",
  семейный: "family",
  семейные: "family",
  fantasy: "fantasy",
  фэнтези: "fantasy",
  history: "history",
  история: "history",
  исторический: "history",
  horror: "horror",
  ужасы: "horror",
  music: "music",
  музыка: "music",
  mystery: "mystery",
  детектив: "mystery",
  romance: "romance",
  мелодрама: "romance",
  романтика: "romance",
  "science fiction": "science fiction",
  фантастика: "science fiction",
  thriller: "thriller",
  триллер: "thriller",
  war: "war",
  военный: "war",
  военные: "war",
  western: "western",
  вестерн: "western",
};

const RUSSIAN_GENRES: Record<string, string> = {
  action: "Боевик",
  adventure: "Приключения",
  animation: "Мультфильмы",
  comedy: "Комедия",
  crime: "Криминал",
  documentary: "Документальный",
  drama: "Драма",
  family: "Семейный",
  fantasy: "Фэнтези",
  history: "История",
  horror: "Ужасы",
  music: "Музыка",
  mystery: "Детектив",
  romance: "Мелодрама",
  "science fiction": "Фантастика",
  thriller: "Триллер",
  war: "Военные",
  western: "Вестерн",
};

export function genreIdentity(genre: Genre | string): string {
  const name = typeof genre === "string" ? genre : genre.name;
  const normalized = name
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]+/gu, " ");
  return GENRE_ALIASES[normalized] ?? normalized;
}

export function selectLocalizedGenres(genres: Genre[], language: string | undefined): Genre[] {
  if (language?.split("-")[0]?.toLowerCase() !== "ru") return genres;
  const selected = new Map<string, Genre>();
  for (const genre of genres) {
    const identity = genreIdentity(genre);
    const existing = selected.get(identity);
    if (!existing || (!/[а-яё]/iu.test(existing.name) && /[а-яё]/iu.test(genre.name))) {
      selected.set(identity, genre);
    }
  }
  return [...selected].map(([identity, genre]) => ({
    ...genre,
    name: /[а-яё]/iu.test(genre.name) ? genre.name : (RUSSIAN_GENRES[identity] ?? genre.name),
  }));
}
