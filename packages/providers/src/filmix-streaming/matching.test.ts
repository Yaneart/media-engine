import assert from "node:assert/strict";
import { test } from "node:test";

import type { FilmixPost, FilmixPostSummary } from "./client.js";
import { matchesSelectedFilmixPost, selectFilmixPost } from "./matching.js";

const posts: FilmixPostSummary[] = [
  {
    id: 165638,
    title: "Бункер",
    originalTitle: "Silo",
    year: 2023,
    section: 7,
    altName: "silo-2023",
    type: "series",
  },
  {
    id: 10,
    title: "Silo",
    year: 2019,
    section: 0,
    type: "movie",
  },
];

test("selectFilmixPost prefers exact title and supports one search-scoped identity fallback", () => {
  assert.equal(
    selectFilmixPost(posts, { type: "series", title: " silo ", year: 2023 })?.id,
    165638,
  );
  assert.equal(
    selectFilmixPost(posts, { type: "series", title: "Укрытие", year: 2023 })?.id,
    165638,
  );
  assert.equal(selectFilmixPost(posts, { type: "movie", title: "Silo", year: 2023 }), undefined);
});

test("selectFilmixPost rejects ambiguous exact and fallback identities", () => {
  const duplicate = { ...posts[0]!, id: 165639 };
  assert.equal(
    selectFilmixPost([...posts, duplicate], { type: "series", title: "Silo", year: 2023 }),
    undefined,
  );
  assert.equal(
    selectFilmixPost([...posts, { ...duplicate, originalTitle: "Other" }], {
      type: "series",
      title: "Укрытие",
      year: 2023,
    }),
    undefined,
  );
});

test("matchesSelectedFilmixPost revalidates loaded identity and title", () => {
  const selected = posts[0]!;
  const loaded: FilmixPost = { ...selected, movies: [], seasons: [] };

  assert.equal(matchesSelectedFilmixPost(loaded, selected), true);
  assert.equal(matchesSelectedFilmixPost({ ...loaded, id: 99 }, selected), false);
  assert.equal(
    matchesSelectedFilmixPost({ ...loaded, title: "Other", originalTitle: "Different" }, selected),
    false,
  );
});
