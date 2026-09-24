import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentityResolver } from "@media-engine/core";
import type { ProviderFetch } from "../shared/index.js";
import { aniListIdentitySource, shikimoriIdentitySource } from "./anime.js";
import { aderomIdentitySource } from "./aderom.js";
import { kinobdIdentitySource } from "./kinobd.js";
import { wikidataIdentitySource } from "./wikidata.js";

const movie = {
  q: "Q13417189",
  instance: "Q11424",
  imdb: "tt0816692",
  tmdb: "157336",
  kp: "258687",
};
const series = { q: "Q23572", instance: "Q5398426", imdb: "tt0944947", tmdb: "1399", kp: "464963" };

function wikidataFetch(
  record: typeof movie,
  extra: { duplicate?: boolean; wrongType?: boolean; ambiguous?: boolean } = {},
): ProviderFetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("action") === "query") {
      const property = record.instance === "Q11424" ? "P4947" : "P4983";
      const terms = [`P345=${record.imdb}`, `${property}=${record.tmdb}`, `P2603=${record.kp}`];
      assert.ok(terms.some((term) => url.searchParams.get("srsearch")?.endsWith(term)));
      return Response.json({
        query: {
          searchinfo: { totalhits: extra.duplicate ? 2 : 1 },
          search: [{ title: record.q }],
        },
      });
    }
    assert.equal(url.searchParams.get("ids"), record.q);
    const statement = (value: unknown) => [{ mainsnak: { datavalue: { value } } }];
    return Response.json({
      entities: {
        [record.q]: {
          id: record.q,
          claims: {
            P31: statement({ id: extra.wrongType ? "Q5398426" : record.instance }),
            P345: statement(record.imdb),
            [record.instance === "Q11424" ? "P4947" : "P4983"]: statement(record.tmdb),
            P2603: extra.ambiguous
              ? [...statement(record.kp), ...statement("999999")]
              : statement(record.kp),
          },
        },
      },
    });
  };
}

test("Wikidata confirms IMDb, TMDB and Kinopoisk in both directions for movies and series", async () => {
  for (const [type, record] of [
    ["movie", movie],
    ["series", series],
  ] as const) {
    const source = wikidataIdentitySource({ fetch: wikidataFetch(record) });
    const resolver = new IdentityResolver([source]);
    for (const initial of [
      { imdb: record.imdb },
      { tmdb: record.tmdb },
      { kinopoisk: record.kp },
      { wikidata: record.q },
    ]) {
      const result = await resolver.resolve(type, initial);
      assert.deepEqual(result.ids, {
        ...initial,
        imdb: record.imdb,
        tmdb: record.tmdb,
        kinopoisk: record.kp,
        wikidata: record.q,
      });
    }
  }
});

test("Wikidata refuses duplicate entities and wrong types; ambiguous claims stay absent", async () => {
  assert.deepEqual(
    (
      await new IdentityResolver([
        wikidataIdentitySource({ fetch: wikidataFetch(movie, { duplicate: true }) }),
      ]).resolve("movie", { imdb: movie.imdb })
    ).ids,
    { imdb: movie.imdb },
  );
  assert.deepEqual(
    (
      await new IdentityResolver([
        wikidataIdentitySource({ fetch: wikidataFetch(movie, { wrongType: true }) }),
      ]).resolve("movie", { imdb: movie.imdb })
    ).ids,
    { imdb: movie.imdb },
  );
  const ambiguous = await new IdentityResolver([
    wikidataIdentitySource({ fetch: wikidataFetch(movie, { ambiguous: true }) }),
  ]).resolve("movie", { imdb: movie.imdb });
  assert.equal(ambiguous.ids.kinopoisk, undefined);
  assert.equal(ambiguous.ids.tmdb, movie.tmdb);
});

test("KinoBD confirms a unique matching record and rejects type or anchor mismatches", async () => {
  const fetch: ProviderFetch = async () =>
    Response.json({
      data: [
        {
          type: "film",
          imdb_id: movie.imdb,
          tmdb_id: Number(movie.tmdb),
          kinopoisk_id: Number(movie.kp),
        },
      ],
    });
  const resolver = new IdentityResolver([kinobdIdentitySource({ fetch })]);
  assert.deepEqual((await resolver.resolve("movie", { imdb: movie.imdb })).ids, {
    imdb: movie.imdb,
    tmdb: movie.tmdb,
    kinopoisk: movie.kp,
  });
  assert.deepEqual((await resolver.resolve("movie", { kinopoisk: movie.kp })).ids, {
    imdb: movie.imdb,
    tmdb: movie.tmdb,
    kinopoisk: movie.kp,
  });
  assert.deepEqual((await resolver.resolve("series", { imdb: movie.imdb })).ids, {
    imdb: movie.imdb,
  });
  assert.deepEqual((await resolver.resolve("movie", { imdb: series.imdb })).ids, {
    imdb: series.imdb,
  });
});

test("AniList and Shikimori confirm anime IDs from the same record", async () => {
  const aniListFetch: ProviderFetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.query.includes("type: ANIME"), true);
    assert.ok(body.variables.id === 154587 || body.variables.idMal === 52991);
    return Response.json({ data: { Media: { id: 154587, idMal: 52991 } } });
  };
  const shikimoriFetch: ProviderFetch = async (input) => {
    assert.match(String(input), /\/api\/animes\/52991$/u);
    return Response.json({ id: 52991, myanimelist_id: 52991 });
  };
  const resolver = new IdentityResolver([
    aniListIdentitySource({ fetch: aniListFetch }),
    shikimoriIdentitySource({ fetch: shikimoriFetch }),
  ]);
  for (const initial of [{ aniList: "154587" }, { myAnimeList: "52991" }, { shikimori: "52991" }]) {
    const result = await resolver.resolve("anime", initial);
    assert.deepEqual(result.ids, { aniList: "154587", myAnimeList: "52991", shikimori: "52991" });
  }
  assert.deepEqual((await resolver.resolve("series", { aniList: "154587" })).ids, {
    aniList: "154587",
  });
});

test("anime sources refuse upstream records that do not repeat the input ID", async () => {
  const aniList = aniListIdentitySource({
    fetch: async () => Response.json({ data: { Media: { id: 99, idMal: 52991 } } }),
  });
  const shikimori = shikimoriIdentitySource({
    fetch: async () => Response.json({ id: 99, myanimelist_id: 52991 }),
  });
  assert.deepEqual(
    (await new IdentityResolver([aniList]).resolve("anime", { aniList: "154587" })).ids,
    { aniList: "154587" },
  );
  assert.deepEqual(
    (await new IdentityResolver([shikimori]).resolve("anime", { shikimori: "52991" })).ids,
    { shikimori: "52991" },
  );
});

test("Aderom confirms Kinopoisk-linked anime IDs and skips malformed or mismatched records", async () => {
  const anime = aderomIdentitySource({
    fetch: async () =>
      Response.json({
        kinopoisk_id: 5401195,
        imdb_id: "tt22248376",
        myanimelist_id: 52991,
        worldart_id: 11466,
        category: "Аниме",
      }),
  });
  assert.deepEqual(
    (await new IdentityResolver([anime]).resolve("anime", { kinopoisk: "5401195" })).ids,
    { kinopoisk: "5401195", imdb: "tt22248376", myAnimeList: "52991", worldArt: "11466" },
  );

  const series = aderomIdentitySource({
    fetch: async () =>
      Response.json({
        kinopoisk_id: 464963,
        imdb_id: "tt944947",
        category: "Зарубежные сериалы",
      }),
  });
  assert.deepEqual(
    (await new IdentityResolver([series]).resolve("series", { kinopoisk: "464963" })).ids,
    { kinopoisk: "464963" },
  );
  assert.deepEqual(
    (await new IdentityResolver([anime]).resolve("series", { kinopoisk: "5401195" })).ids,
    { kinopoisk: "5401195" },
  );
});
